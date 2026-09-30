import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  ImageRun,
  WidthType,
  AlignmentType,
  BorderStyle,
  VerticalAlign,
  Header,
  Footer,
  SimpleField,
  HorizontalPositionRelativeFrom,
  HorizontalPositionAlign,
  VerticalPositionRelativeFrom,
  VerticalPositionAlign,
  ShadingType,
  Textbox,
  BuilderElement,
  XmlComponent,
} from 'docx';
import fileSaver from 'file-saver';
const saveAs = (fileSaver as any).saveAs || fileSaver;
import { Report, Issue, Photo } from '../types';
import { getIssuesForReport, getPhotosForReport, getUserProfile } from '../db/storage';

// Page geometry in TWIPs (1 inch = 1440 twips)
// Standard Letter: 8.5" x 11" = 12,240 x 15,840 twips
// Margins: 720 twips (0.5 inch) -> Printable width = 10,800 twips
const PAGE_WIDTH_TWIPS = 12240;
const PAGE_HEIGHT_TWIPS = 15840;
const MARGIN_TWIPS = 720;
const CONTENT_WIDTH_TWIPS = PAGE_WIDTH_TWIPS - MARGIN_TWIPS * 2; // 10800 twips

// Column widths for 2-column header layout (TWIPs)
// Left col: 7344 twips (~68%), Right col: 3456 twips (~32%) -> sum = 10800
const HEADER_LEFT_WIDTH = 7344;
const HEADER_RIGHT_WIDTH = 3456;

// Two-photo layout with small, deliberate 8 pt (~160 twips) horizontal gap:
// Left photo column: 5320 twips (266 pt)
// Middle gap column: 160 twips (8 pt)
// Right photo column: 5320 twips (266 pt)
// Total sum = 5320 + 160 + 5320 = 10800 twips (exact printable width)
const PHOTO_COL_WIDTH = 5320;
const PHOTO_GAP_WIDTH = 160;

// Photo frame dimensions in DOCX (96 DPI pixels)
// Width: 352px (~264 pt), Height: 216px (~162 pt) to fit inside 266pt column with 8pt gap
const PHOTO_FRAME_WIDTH = 352;
const PHOTO_FRAME_HEIGHT = 216;

// High-DPI canvas render dimensions (704 x 432 = exact 2x supersampling of 352x216)
const TARGET_CANVAS_WIDTH = 704;
const TARGET_CANVAS_HEIGHT = 432;

// Footer columns: Left: 4320, Middle: 3780, Right: 2700 -> sum = 10800
const FOOTER_LEFT_WIDTH = 4320;
const FOOTER_MID_WIDTH = 3780;
const FOOTER_RIGHT_WIDTH = 2700;

// Brand colors matching reference design:
const COLOR_TEAL = '0E7490';   // Primary teal for "Photo Report", labels, and "PHOTO X:"
const COLOR_PURPLE = '581C87'; // Deep purple for Job Reference and "ISSUE X:"
const COLOR_SLATE = '1E293B';  // Dark charcoal slate for content values
const COLOR_MUTED = '64748B';  // Muted slate for caption and footer metadata

/**
 * Converts any image source (base64 data URL, blob url, or remote url)
 * into a clean JPEG Uint8Array formatted with a subtle border for DOCX.
 * Guarantees that every photo completely fills the assigned rectangular frame
 * with zero white/empty space, preserving aspect ratio via symmetrical center cover-crop.
 */
async function imageSourceToJpegBytes(imageSrc: string): Promise<Uint8Array> {
  if (typeof Image === 'undefined' || typeof document === 'undefined') {
    return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  }

  return new Promise((resolve) => {
    if (!imageSrc || !imageSrc.trim()) {
      resolve(createCameraPlaceholderJpeg(TARGET_CANVAS_WIDTH, TARGET_CANVAS_HEIGHT));
      return;
    }

    const img = new Image();
    // Only set crossOrigin for remote http/https requests to avoid tainted data/blob URLs
    if (imageSrc.startsWith('http://') || imageSrc.startsWith('https://')) {
      img.crossOrigin = 'anonymous';
    }

    let resolved = false;
    const fallback = () => {
      if (!resolved) {
        resolved = true;
        resolve(createCameraPlaceholderJpeg(TARGET_CANVAS_WIDTH, TARGET_CANVAS_HEIGHT));
      }
    };

    // Safety timeout prevents export from hanging indefinitely on stalled remote images
    const timeoutId = setTimeout(fallback, 8000);

    const processImage = () => {
      if (resolved) return;
      clearTimeout(timeoutId);
      resolved = true;

      try {
        const naturalW = img.naturalWidth || img.width;
        const naturalH = img.naturalHeight || img.height;

        if (!naturalW || !naturalH) {
          fallback();
          return;
        }

        const canvas = document.createElement('canvas');
        canvas.width = TARGET_CANVAS_WIDTH;
        canvas.height = TARGET_CANVAS_HEIGHT;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          fallback();
          return;
        }

        // Fill background with dark slate tone before drawing
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, TARGET_CANVAS_WIDTH, TARGET_CANVAS_HEIGHT);

        // True center cover-crop:
        // Calculates source crop rectangle (sx, sy, sWidth, sHeight) matching the target aspect ratio
        // Preserves aspect ratio, crops excess symmetrically, never stretches, and leaves zero gaps
        const targetRatio = TARGET_CANVAS_WIDTH / TARGET_CANVAS_HEIGHT; // 1.6
        const srcRatio = naturalW / naturalH;

        let sx = 0;
        let sy = 0;
        let sWidth = naturalW;
        let sHeight = naturalH;

        if (srcRatio > targetRatio) {
          // Wider than target frame: preserve full height, symmetrically crop left/right sides
          sHeight = naturalH;
          sWidth = Math.round(naturalH * targetRatio);
          sx = Math.round((naturalW - sWidth) / 2);
          sy = 0;
        } else if (srcRatio < targetRatio) {
          // Taller than target frame (e.g. portrait): preserve full width, symmetrically crop top/bottom
          sWidth = naturalW;
          sHeight = Math.round(naturalW / targetRatio);
          sx = 0;
          sy = Math.round((naturalH - sHeight) / 2);
        } else {
          sx = 0;
          sy = 0;
          sWidth = naturalW;
          sHeight = naturalH;
        }

        // Boundary safety clamps
        if (sx + sWidth > naturalW) sWidth = naturalW - sx;
        if (sy + sHeight > naturalH) sHeight = naturalH - sy;

        // Draw cropped source image so it occupies 100% of the destination frame area
        ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, TARGET_CANVAS_WIDTH, TARGET_CANVAS_HEIGHT);

        // Draw crisp 2px dark border matching the reference photo frame
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 3;
        ctx.strokeRect(1.5, 1.5, TARGET_CANVAS_WIDTH - 3, TARGET_CANVAS_HEIGHT - 3);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.90);
        const base64 = dataUrl.split(',')[1];
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        resolve(bytes);
      } catch (e) {
        console.warn('Canvas conversion error:', e);
        fallback();
      }
    };

    img.onload = processImage;
    img.onerror = fallback;

    if (img.complete && (img.naturalWidth || img.width)) {
      processImage();
    } else {
      img.src = imageSrc;
    }
  });
}

/**
 * Generates a clean camera placeholder graphic in a bordered box matching the template
 */
function createCameraPlaceholderJpeg(width = TARGET_CANVAS_WIDTH, height = TARGET_CANVAS_HEIGHT): Uint8Array {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Light neutral background
  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(0, 0, width, height);

  // Border matching reference image
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, width - 3, height - 3);

  // Camera line art in center
  const cx = width / 2;
  const cy = height / 2;
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const bw = 150;
  const bh = 105;
  ctx.strokeRect(cx - bw / 2, cy - bh / 2 + 10, bw, bh);

  ctx.beginPath();
  ctx.arc(cx, cy + 10, 32, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx - 32, cy - bh / 2 + 10);
  ctx.lineTo(cx - 16, cy - bh / 2 - 10);
  ctx.lineTo(cx + 16, cy - bh / 2 - 10);
  ctx.lineTo(cx + 32, cy - bh / 2 + 10);
  ctx.stroke();

  const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Creates the photo thumbnail for the top-right corner of the photo report.
 * As requested: "the report image will be the photo thumbnail on the top right corner
 * of the photo report, already indicated in our reference image".
 * If reportImage is present, it renders that image in the bordered box.
 * If reportImage is not present, it renders the camera placeholder graphic.
 */
async function createReportThumbnailJpeg(imageSrc?: string, width = 600, height = 380): Promise<Uint8Array> {
  if (typeof document === 'undefined') {
    return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Neutral background
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, width, height);

  let imageDrawn = false;
  if (imageSrc && imageSrc.trim()) {
    try {
      const img = new Image();
      if (imageSrc.startsWith('http://') || imageSrc.startsWith('https://')) {
        img.crossOrigin = 'anonymous';
      }
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load reportImage'));
        img.src = imageSrc;
      });

      const naturalW = img.naturalWidth || img.width;
      const naturalH = img.naturalHeight || img.height;

      if (naturalW && naturalH) {
        const targetRatio = width / height;
        const srcRatio = naturalW / naturalH;

        let sx = 0;
        let sy = 0;
        let sWidth = naturalW;
        let sHeight = naturalH;

        if (srcRatio > targetRatio) {
          sHeight = naturalH;
          sWidth = Math.round(naturalH * targetRatio);
          sx = Math.round((naturalW - sWidth) / 2);
          sy = 0;
        } else if (srcRatio < targetRatio) {
          sWidth = naturalW;
          sHeight = Math.round(naturalW / targetRatio);
          sx = 0;
          sy = Math.round((naturalH - sHeight) / 2);
        }

        if (sx + sWidth > naturalW) sWidth = naturalW - sx;
        if (sy + sHeight > naturalH) sHeight = naturalH - sy;

        ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, width, height);
        imageDrawn = true;
      }
    } catch (err) {
      console.warn('Could not draw report thumbnail image, falling back to camera placeholder:', err);
    }
  }

  if (!imageDrawn) {
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(0, 0, width, height);

    // Draw camera icon line art placeholder
    const cx = width / 2;
    const cy = height / 2;
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const bw = 140;
    const bh = 100;
    ctx.strokeRect(cx - bw / 2, cy - bh / 2 + 10, bw, bh);

    ctx.beginPath();
    ctx.arc(cx, cy + 10, 30, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx - 30, cy - bh / 2 + 10);
    ctx.lineTo(cx - 15, cy - bh / 2 - 10);
    ctx.lineTo(cx + 15, cy - bh / 2 - 10);
    ctx.lineTo(cx + 30, cy - bh / 2 + 10);
    ctx.stroke();
  }

  // Draw crisp bounding border matching reference image box
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, width - 4, height - 4);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Creates the Bellevue logo mark for the top-right header matching the reference image.
 * Displays "BELLEVUE" cleanly with no awkward character or extra symbols immediately after it.
 */
function createBellevueHeaderJpeg(): Uint8Array {
  if (typeof document === 'undefined') {
    return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  }
  const canvas = document.createElement('canvas');
  canvas.width = 145;
  canvas.height = 40;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 145, 40);

  // Text "BELLEVUE" right-aligned to match property image width (145px)
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 22px Arial, Helvetica, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText('BELLEVUE', 142, 20);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Generates a valid Word VML text box watermark element:
 * - Direct <w:p> (no nested <w:p> wrapping)
 * - Includes valid <v:shapetype id="_x0000_t202"> definition
 * - <v:shape> with position:absolute, rotation:315, mso-wrap-style:none
 * - Visible stacking (no negative z-index)
 * - Transparent background (fillcolor="none", stroked="f")
 * - Large light-slate text (CBD5E1) centered
 * - Consumes ZERO document-flow space (w:spacing before/after/line = 0)
 */
interface ReportPhotoItem {
  photoNumber: number;
  issueNumber: number;
  imageBytes: Uint8Array;
  caption: string;
  issueTitle: string;
  isFirstPhotoInIssue: boolean;
}

/**
 * Builds the Word Document object for the report adhering strictly to the reference image specification:
 * - Left header: Photo Report, Job Reference, Subject Property, Prepared By, Consultant
 * - Right header: BELLEVUE logo, Report Image thumbnail in rectangular box, Date of Report
 * - 2x2 Photo grid per page with PHOTO and ISSUE badges and caption
 * - Standardized footer with address, email, assured brand, and page numbers
 */
async function buildPhotoReportDocument(
  report: Report,
  providedIssues?: Issue[],
  providedPhotos?: Photo[]
): Promise<Document> {
  // Fetch issues, photos, and user profile
  const [issues, photos] = await Promise.all([
    providedIssues ? Promise.resolve(providedIssues) : getIssuesForReport(report.id),
    providedPhotos ? Promise.resolve(providedPhotos) : getPhotosForReport(report.id),
  ]);
  const userProfile = getUserProfile();

  const issueMap = new Map<string, Issue>();
  issues.forEach((iss) => issueMap.set(iss.id, iss));

  // Filter photos to only those included in photo report (default true)
  const reportPhotos = photos.filter(p => p.includeInReport !== false);

  const photoItems: ReportPhotoItem[] = [];

  if (reportPhotos.length > 0) {
    const photosByIssue = new Map<string, Photo[]>();
    reportPhotos.forEach(p => {
      const issueId = p.issueId || 'no-issue';
      if (!photosByIssue.has(issueId)) photosByIssue.set(issueId, []);
      photosByIssue.get(issueId)!.push(p);
    });

    for (const [issueId, issuePhotos] of photosByIssue.entries()) {
      const associatedIssue = issueMap.get(issueId);
      const issueNum = associatedIssue?.issueNumber || 1;
      const issueTitle = associatedIssue?.issueName || 'Untitled Issue';

      for (let i = 0; i < issuePhotos.length; i++) {
        const p = issuePhotos[i];
        const imgBytes = await imageSourceToJpegBytes(p.imageFile);
        const captionText = p.description?.trim() || '';

        photoItems.push({
          photoNumber: i + 1,
          issueNumber: issueNum,
          imageBytes: imgBytes,
          caption: captionText,
          issueTitle: issueTitle,
          isFirstPhotoInIssue: i === 0,
        });
      }
    }
  }

  // Generate top-right header assets: Bellevue logo and Report Image thumbnail
  const bellevueLogoBytes = createBellevueHeaderJpeg();
  const reportThumbnailBytes = await createReportThumbnailJpeg(report.reportImage);

  // Content values mapped from report details:
  const rawJobRef = report.jobReference?.trim() || 'Job Reference Number';
  const jobRefText = rawJobRef.replace(/^BBC-(\d{2})-(.*)$/i, 'BBC$1-$2');
  const propertyAddress = report.address?.trim() || report.reportName?.trim() || '[Property Address]';
  const preparedBy = 'Assured Consultancy Pty Ltd';
  const consultantName = userProfile?.profileName?.trim() || userProfile?.fullName?.trim() || userProfile?.name?.trim() || '[Consultant Name]';
  const reportDate = report.reportDate?.trim() || report.inspectionDate?.trim() || '[Date]';

  // Build Top Header Table
  const buildHeaderTable = () => {
    return new Table({
      width: { size: CONTENT_WIDTH_TWIPS, type: WidthType.DXA },
      columnWidths: [HEADER_LEFT_WIDTH, HEADER_RIGHT_WIDTH],
      borders: {
        top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      },
      rows: [
        new TableRow({
          cantSplit: true,
          children: [
            // Left Column: Title, Job Ref, Subject Property, Prepared By, Consultant
            new TableCell({
              width: { size: HEADER_LEFT_WIDTH, type: WidthType.DXA },
              margins: { top: 0, bottom: 100, left: 0, right: 140 },
              children: [
                new Paragraph({
                  spacing: { after: 40 },
                  children: [
                    new TextRun({
                      text: 'Photo Report',
                      bold: true,
                      size: 48, // 24pt
                      color: COLOR_TEAL,
                      font: 'Arial',
                    }),
                  ],
                }),
                new Paragraph({
                  spacing: { after: 140 },
                  children: [
                    new TextRun({
                      text: jobRefText,
                      bold: true,
                      size: 26, // 13pt
                      color: COLOR_PURPLE,
                      font: 'Arial',
                    }),
                  ],
                }),
                new Paragraph({
                  spacing: { after: 20 },
                  children: [
                    new TextRun({
                      text: 'SUBJECT PROPERTY',
                      bold: true,
                      size: 14, // 7pt
                      color: COLOR_TEAL,
                      font: 'Arial',
                    }),
                  ],
                }),
                new Paragraph({
                  spacing: { after: 100 },
                  children: [
                    new TextRun({
                      text: propertyAddress,
                      bold: true,
                      size: 18, // 9pt
                      color: COLOR_SLATE,
                      font: 'Arial',
                    }),
                  ],
                }),
                new Paragraph({
                  spacing: { after: 20 },
                  children: [
                    new TextRun({
                      text: 'PREPARED BY',
                      bold: true,
                      size: 14,
                      color: COLOR_TEAL,
                      font: 'Arial',
                    }),
                  ],
                }),
                new Paragraph({
                  spacing: { after: 100 },
                  children: [
                    new TextRun({
                      text: preparedBy,
                      size: 18,
                      color: COLOR_SLATE,
                      font: 'Arial',
                    }),
                  ],
                }),
                new Paragraph({
                  spacing: { after: 20 },
                  children: [
                    new TextRun({
                      text: 'CONSULTANT',
                      bold: true,
                      size: 14,
                      color: COLOR_TEAL,
                      font: 'Arial',
                    }),
                  ],
                }),
                new Paragraph({
                  spacing: { after: 140 },
                  children: [
                    new TextRun({
                      text: consultantName,
                      size: 18,
                      color: COLOR_SLATE,
                      font: 'Arial',
                    }),
                  ],
                }),
              ],
            }),

            // Right Column: Bellevue branding, Report Image photo thumbnail, Date of Report
            new TableCell({
              width: { size: HEADER_RIGHT_WIDTH, type: WidthType.DXA },
              margins: { top: 0, bottom: 100, left: 80, right: 0 },
              verticalAlign: VerticalAlign.TOP,
              children: [
                // Bellevue header logo
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  spacing: { after: 40 },
                  children: [
                    new ImageRun({
                      data: bellevueLogoBytes,
                      transformation: {
                        width: 145,
                        height: 40,
                      },
                      type: 'jpg',
                    }),
                  ],
                }),
                // Report Image photo thumbnail in bordered box
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  spacing: { after: 100 },
                  children: [
                    new ImageRun({
                      data: reportThumbnailBytes,
                      transformation: {
                        width: 145,
                        height: 92,
                      },
                      type: 'jpg',
                    }),
                  ],
                }),
                // DATE OF REPORT label
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  spacing: { after: 20 },
                  children: [
                    new TextRun({
                      text: 'DATE OF REPORT',
                      bold: true,
                      size: 14, // 7pt
                      color: COLOR_TEAL,
                      font: 'Arial',
                    }),
                  ],
                }),
                // Report Date value
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun({
                      text: reportDate,
                      size: 18, // 9pt
                      color: COLOR_SLATE,
                      font: 'Arial',
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    });
  };

  // Helper to create a single photo cell in the 2x2 grid
  const createPhotoCell = (item?: ReportPhotoItem) => {
    if (!item) {
      return new TableCell({
        width: { size: PHOTO_COL_WIDTH, type: WidthType.DXA },
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        borders: {
          top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
          bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
          left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
          right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        },
        children: [new Paragraph({})],
      });
    }

    return new TableCell({
      width: { size: PHOTO_COL_WIDTH, type: WidthType.DXA },
      margins: { top: 40, bottom: 180, left: 0, right: 0 },
      verticalAlign: VerticalAlign.TOP,
      borders: {
        top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      },
      children: [
        // Photo Image Box with clean border - completely fills frame with zero white space
        new Paragraph({
          alignment: AlignmentType.LEFT,
          spacing: { after: 50 },
          children: [
            new ImageRun({
              data: item.imageBytes,
              transformation: {
                width: PHOTO_FRAME_WIDTH,
                height: PHOTO_FRAME_HEIGHT,
              },
              type: 'jpg',
            }),
          ],
        }),

        // Issue Line: ISSUE X: [Issue Title]
        new Paragraph({
          spacing: { after: 20 },
          children: [
            new TextRun({
              text: ` ISSUE ${item.issueNumber} `,
              bold: true,
              size: 14, // 7pt
              color: 'FFFFFF',
              shading: {
                type: ShadingType.CLEAR,
                fill: COLOR_PURPLE,
                color: 'auto',
              },
              font: 'Arial',
            }),
            new TextRun({
              text: `  ${item.issueTitle}`,
              bold: true,
              size: 15, // 7.5pt
              color: COLOR_SLATE,
              font: 'Arial',
            }),
          ],
        }),

        // Photo Line: PHOTO X: [Description]
        new Paragraph({
          spacing: { after: 40 },
          children: [
            new TextRun({
              text: ` PHOTO ${item.photoNumber} `,
              bold: true,
              size: 14, // 7pt
              color: 'FFFFFF',
              shading: {
                type: ShadingType.CLEAR,
                fill: COLOR_TEAL,
                color: 'auto',
              },
              font: 'Arial',
            }),
            new TextRun({
              text: `  ${item.caption}`,
              size: 15, // 7.5pt
              color: COLOR_SLATE,
              font: 'Arial',
            }),
          ],
        }),
      ],
    });
  };

  // Factory function to create the standardized official footer table
  // Uses standard dynamic PAGE field (SimpleField with PAGE instruction and cached page value)
  // Ensures reliable rendering in Google Docs, Microsoft Word, and standard DOCX viewers
  const createReportFooter = (pageNumber = 1): Footer => {
    // Dynamic PAGE field compatible with Google Docs & Word
    const pageField = new SimpleField('PAGE', String(pageNumber));

    return new Footer({
      children: [
        new Table({
          width: { size: CONTENT_WIDTH_TWIPS, type: WidthType.DXA },
          columnWidths: [FOOTER_LEFT_WIDTH, FOOTER_MID_WIDTH, FOOTER_RIGHT_WIDTH],
          borders: {
            top: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
            bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
            left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
            right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
            insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
            insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
          },
          rows: [
            new TableRow({
              cantSplit: true,
              children: [
                // Left: Office PO Box Address
                new TableCell({
                  width: { size: FOOTER_LEFT_WIDTH, type: WidthType.DXA },
                  borders: {
                    top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                    bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                    left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                    right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                  },
                  margins: { top: 60, bottom: 0, left: 0, right: 40 },
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: 'PO BOX 3055. BELLEVUE HILL. NSW 2022',
                          size: 15, // 7.5pt
                          color: COLOR_MUTED,
                          font: 'Arial',
                        }),
                      ],
                    }),
                  ],
                }),
                // Middle: Admin Email
                new TableCell({
                  width: { size: FOOTER_MID_WIDTH, type: WidthType.DXA },
                  borders: {
                    top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                    bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                    left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                    right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                  },
                  margins: { top: 60, bottom: 0, left: 20, right: 20 },
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [
                        new TextRun({
                          text: 'ADMIN@BELLAVIEWBUILDING.COM',
                          size: 15,
                          color: COLOR_MUTED,
                          font: 'Arial',
                        }),
                      ],
                    }),
                  ],
                }),
                // Right: Assured Consultancy & Dynamic Page Numbering
                new TableCell({
                  width: { size: FOOTER_RIGHT_WIDTH, type: WidthType.DXA },
                  borders: {
                    top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                    bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                    left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                    right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                  },
                  margins: { top: 60, bottom: 0, left: 40, right: 0 },
                  children: [
                    new Paragraph({
                      style: 'Footer',
                      alignment: AlignmentType.RIGHT,
                      children: [
                        new TextRun({
                          text: 'assured ',
                          bold: true,
                          size: 17,
                          color: '475569',
                          font: 'Arial',
                        }),
                        new TextRun({
                          text: 'Page ',
                          size: 15,
                          color: COLOR_MUTED,
                          font: 'Arial',
                        }),
                        pageField,
                      ],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    });
  };

  // Helper to build a photo Table for a page with 1, 2, or 3 rows (2 photos per row)
  const buildPhotoTable = (pagePhotos: ReportPhotoItem[], rowsCount: number = 2) => {
    const tableRows: TableRow[] = [];
    for (let r = 0; r < rowsCount; r++) {
      const idx1 = r * 2;
      const idx2 = r * 2 + 1;
      const rowCells: TableCell[] = [
        createPhotoCell(pagePhotos[idx1]),
        // Add empty cell for the gap between photos
        new TableCell({
          width: { size: PHOTO_GAP_WIDTH, type: WidthType.DXA },
          children: [new Paragraph({ text: '' })],
          borders: {
            top: { style: BorderStyle.NONE, size: 0 },
            bottom: { style: BorderStyle.NONE, size: 0 },
            left: { style: BorderStyle.NONE, size: 0 },
            right: { style: BorderStyle.NONE, size: 0 },
          },
        }),
        createPhotoCell(pagePhotos[idx2]),
      ];
      tableRows.push(new TableRow({ cantSplit: true, children: rowCells }));
    }

    return new Table({
      width: { size: CONTENT_WIDTH_TWIPS, type: WidthType.DXA },
      columnWidths: [PHOTO_COL_WIDTH, PHOTO_GAP_WIDTH, PHOTO_COL_WIDTH],
      margins: {
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
      },
      borders: {
        top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      },
      rows: tableRows,
    });
  };

  // Pagination: Page 1 holds up to 4 photos (due to header/metadata block).
  // Starting from Page 2 onwards, as requested: 6 photos per page (3 rows of 2 photos).
  const page1Capacity = 4;
  const subsequentPageCapacity = 6;

  const page1Photos = photoItems.slice(0, page1Capacity);
  const remainingPhotos = photoItems.slice(page1Capacity);

  const additionalPagesCount = remainingPhotos.length > 0
    ? Math.ceil(remainingPhotos.length / subsequentPageCapacity)
    : 0;
  const totalPages = Math.max(1, 1 + additionalPagesCount);

  const sections: any[] = [];

  // ==========================================
  // PAGE 1 SECTION:
  // Existing Photo Report header + report information
  // + TWO ADDITIONAL BLANK LINES / PARAGRAPH SPACES AFTER CONSULTANT
  // + First row/page of photos
  // + Existing footer
  // ==========================================
  const page1Children: (Paragraph | Table)[] = [];
  page1Children.push(buildHeaderTable());

  // Requirement 1: After Consultant name/value, add two additional blank lines / paragraph spaces before first row of photos begins
  page1Children.push(
    new Paragraph({
      spacing: { before: 100, after: 100 },
      children: [new TextRun({ text: '' })],
    })
  );
  page1Children.push(
    new Paragraph({
      spacing: { before: 100, after: 100 },
      children: [new TextRun({ text: '' })],
    })
  );

  if (photoItems.length === 0) {
    page1Children.push(
      new Paragraph({
        spacing: { before: 400, after: 200 },
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: 'No photographic evidence recorded for this report.',
            color: COLOR_SLATE,
            size: 20,
            font: 'Arial',
            italics: true,
          }),
        ],
      })
    );
  } else {
    page1Children.push(buildPhotoTable(page1Photos, 2));
  }

  sections.push({
    properties: {
      titlePage: false,
      page: {
        size: {
          width: PAGE_WIDTH_TWIPS,   // 8.5 inches (12,240 twips)
          height: PAGE_HEIGHT_TWIPS, // 11 inches (15,840 twips)
        },
        margin: {
          top: MARGIN_TWIPS,
          bottom: MARGIN_TWIPS,
          left: MARGIN_TWIPS,
          right: MARGIN_TWIPS,
          header: 360,
          footer: 360,
        },
        pageNumbers: {
          start: 1,
        },
      },
    },
    footers: {
      default: createReportFooter(1),
      first: createReportFooter(1),
      even: createReportFooter(1),
    },
    children: page1Children,
  });

  // ==========================================
  // PAGE 2+ SECTIONS:
  // 6 photos per page (3 rows of 2 photos)
  // Photos ONLY: NO Photo Report header/title section, NO repeated report info block
  // Begins directly with the photo content/grid
  // Keeps existing footer on every page
  // Keeps existing page margins and overall page structure
  // ==========================================
  for (let pageIdx = 0; pageIdx < additionalPagesCount; pageIdx++) {
    const startIdx = pageIdx * subsequentPageCapacity;
    const pagePhotos = remainingPhotos.slice(startIdx, startIdx + subsequentPageCapacity);
    const pageNumber = pageIdx + 2;
    const pageChildren: (Paragraph | Table)[] = [];
    pageChildren.push(buildPhotoTable(pagePhotos, 3));

    sections.push({
      properties: {
        titlePage: false,
        page: {
          size: {
            width: PAGE_WIDTH_TWIPS,
            height: PAGE_HEIGHT_TWIPS,
          },
          margin: {
            top: MARGIN_TWIPS,
            bottom: MARGIN_TWIPS,
            left: MARGIN_TWIPS,
            right: MARGIN_TWIPS,
            header: 360,
            footer: 360,
          },
        },
      },
      footers: {
        default: createReportFooter(pageNumber),
        first: createReportFooter(pageNumber),
        even: createReportFooter(pageNumber),
      },
      children: pageChildren,
    });
  }

  // Create Word Document with explicit page geometry and layout matching reference
  return new Document({
    features: {
      updateFields: true,
    },
    styles: {
      paragraphStyles: [
        {
          id: 'Footer',
          name: 'Footer',
          basedOn: 'Normal',
          run: {
            size: 15,
            color: COLOR_MUTED,
            font: 'Arial',
          },
        },
      ],
    },
    sections,
  });
}

/**
 * Normalizes and extracts the single source of truth Job Reference for export files.
 * Ensures the exact saved reference (e.g. BBC26-456) is used without extra hyphens or corruptions.
 */
export function getReportJobReference(report: Report): string {
  const raw = (report.jobReference || '').trim();
  if (!raw) return 'Photo_Report';
  // Normalizes any legacy BBC-YY- format (BBC-26-456) to standard BBC26-456
  return raw.replace(/^BBC-(\d{2})-(.*)$/i, 'BBC$1-$2');
}

/**
 * Exports a comprehensive, beautifully styled Word (.docx) inspection photo report
 * strictly adhering to the user's provided specification screenshot.
 */
export async function exportPhotoReportDocx(
  report: Report,
  providedIssues?: Issue[],
  providedPhotos?: Photo[]
): Promise<void> {
  const doc = await buildPhotoReportDocument(report, providedIssues, providedPhotos);
  const blob = await Packer.toBlob(doc);
  const ref = getReportJobReference(report);
  const cleanRef = ref.replace(/[^a-zA-Z0-9-_]/g, '_');
  saveAs(blob, `${cleanRef}_Photo_Report.docx`);
}

/**
 * Generates the raw DOCX Blob without prompting a browser save,
 * ideal for direct cloud uploads like Google Drive.
 */
export async function generatePhotoReportDocxBlob(
  report: Report,
  providedIssues?: Issue[],
  providedPhotos?: Photo[]
): Promise<{ blob: Blob; fileName: string }> {
  const doc = await buildPhotoReportDocument(report, providedIssues, providedPhotos);
  const blob = await Packer.toBlob(doc);
  const ref = getReportJobReference(report);
  const cleanRef = ref.replace(/[^a-zA-Z0-9-_]/g, '_');
  return {
    blob,
    fileName: `${cleanRef}_Photo_Report.docx`,
  };
}
