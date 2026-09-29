import { jsPDF } from 'jspdf';
import fileSaver from 'file-saver';
const saveAs = (fileSaver as any).saveAs || fileSaver;
import { Report, Issue, Photo } from '../types';
import { getIssuesForReport, getPhotosForReport, getUserProfile } from '../db/storage';
import { getReportJobReference } from './docxExport';

// Colors matching Assured Photo Report specification
const COLOR_TEAL = '#0E7490';
const COLOR_PURPLE = '#581C87';
const COLOR_SLATE = '#1E293B';
const COLOR_MUTED = '#64748B';
const COLOR_BORDER = '#CBD5E1';

// Page geometry in points (Letter: 8.5 x 11 inches = 612 x 792 pt)
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 36; // 0.5 inch margins
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2; // 540 pt
const FOOTER_Y = 760;

// Photo Grid dimensions (2 columns)
const PHOTO_GAP = 16;
const ROW_GAP = 16;
const PHOTO_WIDTH = (CONTENT_WIDTH - PHOTO_GAP) / 2; // 262 pt
const PHOTO_HEIGHT = 158; // ~1.65 aspect ratio matching DOCX

// High-DPI Canvas render target for crisp photos
const TARGET_CANVAS_WIDTH = 704;
const TARGET_CANVAS_HEIGHT = 420;

interface ReportPhotoItem {
  photoNumber: number;
  issueNumber: number;
  imageCanvasUrl: string;
  caption: string;
  issueTitle: string;
}

/**
 * Creates camera placeholder canvas when photo is missing or fails to load
 */
function createCameraPlaceholderDataUrl(w = TARGET_CANVAS_WIDTH, h = TARGET_CANVAS_HEIGHT): string {
  if (typeof document === 'undefined') {
    return 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
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

  // Bounding border
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, w - 4, h - 4);

  return canvas.toDataURL('image/jpeg', 0.9);
}

/**
 * Center-crops and renders any photo source into a crisp JPEG data URL
 */
async function processImageToDataUrl(imageSrc?: string): Promise<string> {
  if (!imageSrc || !imageSrc.trim()) {
    return createCameraPlaceholderDataUrl();
  }

  // Node.js / headless environment fallback
  if (typeof Image === 'undefined' || typeof document === 'undefined') {
    return imageSrc;
  }

  return new Promise((resolve) => {
    const img = new Image();
    if (imageSrc.startsWith('http://') || imageSrc.startsWith('https://')) {
      img.crossOrigin = 'anonymous';
    }

    let resolved = false;
    const fallback = () => {
      if (!resolved) {
        resolved = true;
        resolve(createCameraPlaceholderDataUrl());
      }
    };

    const timeout = setTimeout(fallback, 8000);

    img.onload = () => {
      if (resolved) return;
      clearTimeout(timeout);
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

        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, TARGET_CANVAS_WIDTH, TARGET_CANVAS_HEIGHT);

        const targetRatio = TARGET_CANVAS_WIDTH / TARGET_CANVAS_HEIGHT;
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

        ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, TARGET_CANVAS_WIDTH, TARGET_CANVAS_HEIGHT);

        // Thin photo frame border
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, TARGET_CANVAS_WIDTH - 2, TARGET_CANVAS_HEIGHT - 2);

        resolve(canvas.toDataURL('image/jpeg', 0.92));
      } catch (err) {
        fallback();
      }
    };

    img.onerror = fallback;
    img.src = imageSrc;
  });
}

/**
 * Creates property thumbnail for the top-right header box
 */
async function processReportThumbnailDataUrl(imageSrc?: string): Promise<string> {
  if (!imageSrc || !imageSrc.trim()) {
    return createCameraPlaceholderDataUrl(300, 190);
  }
  return processImageToDataUrl(imageSrc);
}

/**
 * Builds the complete Photo Report PDF document adhering strictly to Assured Capture layout
 */
export async function buildPhotoReportPdf(
  report: Report,
  providedIssues?: Issue[],
  providedPhotos?: Photo[]
): Promise<jsPDF> {
  const [issues, photos] = await Promise.all([
    providedIssues ? Promise.resolve(providedIssues) : getIssuesForReport(report.id),
    providedPhotos ? Promise.resolve(providedPhotos) : getPhotosForReport(report.id),
  ]);
  const userProfile = getUserProfile();

  const sortedIssues = [...issues].sort((a, b) => a.issueNumber - b.issueNumber);
  const issueMap = new Map<string, Issue>();
  sortedIssues.forEach(iss => issueMap.set(iss.id, iss));

  // Only photos included in the photo report
  const reportPhotos = photos.filter(p => p.includeInReport !== false);

  const photoItems: ReportPhotoItem[] = [];

  if (reportPhotos.length > 0) {
    const photosByIssue = new Map<string, Photo[]>();
    reportPhotos.forEach(p => {
      const issueId = p.issueId || 'no-issue';
      if (!photosByIssue.has(issueId)) photosByIssue.set(issueId, []);
      photosByIssue.get(issueId)!.push(p);
    });

    // Strictly preserve issue order (ISSUE 1, ISSUE 2, ISSUE 3...)
    const orderedIssueIds: string[] = [];
    sortedIssues.forEach(iss => {
      if (photosByIssue.has(iss.id)) {
        orderedIssueIds.push(iss.id);
      }
    });
    // Append any photos not tied to a registered issue
    for (const issueId of photosByIssue.keys()) {
      if (!orderedIssueIds.includes(issueId)) {
        orderedIssueIds.push(issueId);
      }
    }

    for (const issueId of orderedIssueIds) {
      const issuePhotos = photosByIssue.get(issueId) || [];
      const associatedIssue = issueMap.get(issueId);
      const issueNum = associatedIssue?.issueNumber || (orderedIssueIds.indexOf(issueId) + 1);
      const issueTitle = associatedIssue?.issueName || 'Untitled Issue';

      for (let i = 0; i < issuePhotos.length; i++) {
        const p = issuePhotos[i];
        const imgUrl = await processImageToDataUrl(p.imageFile);
        const captionText = p.description?.trim() || '';

        photoItems.push({
          photoNumber: i + 1,
          issueNumber: issueNum,
          imageCanvasUrl: imgUrl,
          caption: captionText,
          issueTitle,
        });
      }
    }
  }

  // Cover / property thumbnail
  const reportThumbnailUrl = await processReportThumbnailDataUrl(report.reportImage);

  // Content values mapped from report
  const rawJobRef = report.jobReference?.trim() || 'Job Reference Number';
  const jobRefText = rawJobRef.replace(/^BBC-(\d{2})-(.*)$/i, 'BBC$1-$2');
  const propertyAddress = report.address?.trim() || report.reportName?.trim() || '[Property Address]';
  const preparedBy = 'Assured Consultancy Pty Ltd';
  const consultantName = userProfile?.profileName?.trim() || userProfile?.fullName?.trim() || userProfile?.name?.trim() || '[Consultant Name]';
  const reportDate = report.reportDate?.trim() || report.inspectionDate?.trim() || '[Date]';

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'letter', // 612 x 792 pt
  });

  // Helper to render standardized footer on each page
  const renderFooter = (pageNumber: number, totalPagesCount: number) => {
    // Divider line
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.75);
    doc.line(MARGIN, FOOTER_Y - 12, PAGE_WIDTH - MARGIN, FOOTER_Y - 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(COLOR_MUTED);

    // Left: Address
    doc.text('PO BOX 3055. BELLEVUE HILL. NSW 2022', MARGIN, FOOTER_Y);

    // Middle: Admin Email
    doc.text('ADMIN@BELLAVIEWBUILDING.COM', PAGE_WIDTH / 2, FOOTER_Y, { align: 'center' });

    // Right: Assured Page X of Y
    const pageText = `Page ${pageNumber} of ${totalPagesCount}`;
    const pageTextWidth = doc.getTextWidth(pageText);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(71, 85, 105);
    const assuredWidth = doc.getTextWidth('assured ');
    doc.text('assured ', PAGE_WIDTH - MARGIN - pageTextWidth - assuredWidth, FOOTER_Y);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(COLOR_MUTED);
    doc.text(pageText, PAGE_WIDTH - MARGIN - pageTextWidth, FOOTER_Y);
  };

  // Helper to draw a badge with text
  const drawBadge = (
    text: string,
    x: number,
    y: number,
    bgColor: string,
    textColor: string,
    precalculatedWidth?: number
  ): number => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    const badgeWidth = precalculatedWidth ?? (doc.getTextWidth(text) + 8);
    const badgeHeight = 11;

    doc.setFillColor(bgColor);
    doc.roundedRect(x, y - 8.5, badgeWidth, badgeHeight, 1.5, 1.5, 'F');

    doc.setTextColor(textColor);
    doc.text(text, x + 4, y);

    return badgeWidth;
  };

  interface MeasuredPhotoCard {
    item: ReportPhotoItem;
    titleLines: string[];
    captionLines: string[];
    issueBadgeWidth: number;
    photoBadgeWidth: number;
    height: number;
  }

  interface MeasuredPhotoRow {
    left: MeasuredPhotoCard;
    right?: MeasuredPhotoCard;
    height: number;
  }

  // Pre-measures photo card height based on actual wrapped lines of description and issue title
  const measurePhotoCard = (item: ReportPhotoItem): MeasuredPhotoCard => {
    // 1. Issue Badge & Title measurement
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    const issueText = `ISSUE ${item.issueNumber}`;
    const issueBadgeWidth = doc.getTextWidth(issueText) + 8; // paddingX = 4 on both sides

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    const maxTitleWidth = Math.max(60, PHOTO_WIDTH - issueBadgeWidth - 10);
    const titleLines = doc.splitTextToSize(item.issueTitle || 'Untitled Issue', maxTitleWidth);

    // 2. Photo Badge & Description measurement
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    const photoText = `PHOTO ${item.photoNumber}`;
    const photoBadgeWidth = doc.getTextWidth(photoText) + 8;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    const maxCaptionWidth = Math.max(60, PHOTO_WIDTH - photoBadgeWidth - 10);
    const captionLines: string[] = item.caption && item.caption.trim()
      ? doc.splitTextToSize(item.caption.trim(), maxCaptionWidth)
      : [];

    // Exact height calculation:
    // - Photo image: PHOTO_HEIGHT (158 pt)
    // - Top gap to issue line: 13 pt
    // - Issue title block height: Math.max(1, titleLines.length) * 9.5 pt
    // - Gap between issue title and photo line: 4.5 pt
    // - Photo description lines: (captionLines.length - 1) * 9.5 pt (first line shares baseline with PHOTO badge)
    // - Bottom padding below text: 6 pt
    const titleBlockHeight = Math.max(1, titleLines.length) * 9.5;
    const captionBlockHeight = Math.max(0, captionLines.length - 1) * 9.5;
    const height = PHOTO_HEIGHT + 13 + titleBlockHeight + 4.5 + captionBlockHeight + 6;

    return {
      item,
      titleLines,
      captionLines,
      issueBadgeWidth,
      photoBadgeWidth,
      height,
    };
  };

  // Draws a measured photo card with full description wrapping across all lines
  const drawMeasuredPhotoCard = (card: MeasuredPhotoCard, x: number, y: number) => {
    const { item, titleLines, captionLines, issueBadgeWidth, photoBadgeWidth } = card;

    // 1. Photo Image
    try {
      doc.addImage(item.imageCanvasUrl, 'JPEG', x, y, PHOTO_WIDTH, PHOTO_HEIGHT);
    } catch (_) {
      doc.setDrawColor(203, 213, 225);
      doc.rect(x, y, PHOTO_WIDTH, PHOTO_HEIGHT);
    }
    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(1);
    doc.rect(x, y, PHOTO_WIDTH, PHOTO_HEIGHT);

    // 2. Issue Line
    const issueY = y + PHOTO_HEIGHT + 13;
    drawBadge(`ISSUE ${item.issueNumber}`, x, issueY, COLOR_PURPLE, '#FFFFFF', issueBadgeWidth);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(COLOR_SLATE);
    for (let i = 0; i < titleLines.length; i++) {
      doc.text(titleLines[i], x + issueBadgeWidth + 6, issueY + i * 9.5);
    }

    // 3. Photo Line & Full Description (renders all lines with zero truncation)
    const titleBlockHeight = Math.max(1, titleLines.length) * 9.5;
    const photoLineY = issueY + titleBlockHeight + 4.5;
    drawBadge(`PHOTO ${item.photoNumber}`, x, photoLineY, COLOR_TEAL, '#FFFFFF', photoBadgeWidth);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(COLOR_SLATE);
    if (captionLines.length > 0) {
      for (let i = 0; i < captionLines.length; i++) {
        doc.text(captionLines[i], x + photoBadgeWidth + 6, photoLineY + i * 9.5);
      }
    }
  };

  // Measure all cards and group into 2-column rows
  const measuredCards: MeasuredPhotoCard[] = photoItems.map(item => measurePhotoCard(item));
  const rows: MeasuredPhotoRow[] = [];
  for (let i = 0; i < measuredCards.length; i += 2) {
    const left = measuredCards[i];
    const right = i + 1 < measuredCards.length ? measuredCards[i + 1] : undefined;
    const rowHeight = right ? Math.max(left.height, right.height) : left.height;
    rows.push({ left, right, height: rowHeight });
  }

  // ==========================================
  // PAGE 1 RENDER:
  // Top Header + Report Info + Flowing photo rows + Dynamic page breaking
  // ==========================================
  let curY = MARGIN;

  // Title: "Photo Report"
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  doc.setTextColor(COLOR_TEAL);
  doc.text('Photo Report', MARGIN, curY + 20);

  // Bellevue Logo in top right
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor('#0f172a');
  doc.text('BELLEVUE', PAGE_WIDTH - MARGIN, curY + 16, { align: 'right' });

  // Job Reference
  curY += 36;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(COLOR_PURPLE);
  doc.text(jobRefText, MARGIN, curY);

  // Property Image Thumbnail in top-right
  const thumbWidth = 140;
  const thumbHeight = 88;
  const thumbX = PAGE_WIDTH - MARGIN - thumbWidth;
  const thumbY = MARGIN + 26;

  try {
    doc.addImage(reportThumbnailUrl, 'JPEG', thumbX, thumbY, thumbWidth, thumbHeight);
  } catch (_) {
    doc.setDrawColor(203, 213, 225);
    doc.rect(thumbX, thumbY, thumbWidth, thumbHeight);
  }
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(1.5);
  doc.rect(thumbX, thumbY, thumbWidth, thumbHeight);

  // Date of Report under thumbnail
  const dateY = thumbY + thumbHeight + 14;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(COLOR_TEAL);
  doc.text('DATE OF REPORT', PAGE_WIDTH - MARGIN, dateY, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(COLOR_SLATE);
  doc.text(reportDate, PAGE_WIDTH - MARGIN, dateY + 11, { align: 'right' });

  // Metadata block (Left Column)
  curY += 16;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(COLOR_TEAL);
  doc.text('SUBJECT PROPERTY', MARGIN, curY);

  curY += 11;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(COLOR_SLATE);
  const addressLines = doc.splitTextToSize(propertyAddress, 360);
  doc.text(addressLines[0] || '', MARGIN, curY);

  curY += 18;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(COLOR_TEAL);
  doc.text('PREPARED BY', MARGIN, curY);

  curY += 11;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(COLOR_SLATE);
  doc.text(preparedBy, MARGIN, curY);

  curY += 18;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(COLOR_TEAL);
  doc.text('CONSULTANT', MARGIN, curY);

  curY += 11;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(COLOR_SLATE);
  doc.text(consultantName, MARGIN, curY);

  // Space after Consultant
  curY += 34;

  const page1StartY = Math.max(curY, 195);
  const subsequentPageStartY = MARGIN + 10; // 46 pt
  const MAX_CONTENT_Y = FOOTER_Y - 24; // 736 pt - safe buffer above footer divider at 748 pt

  if (rows.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10);
    doc.setTextColor(COLOR_MUTED);
    doc.text('No photographic evidence recorded for this report.', PAGE_WIDTH / 2, page1StartY + 60, {
      align: 'center',
    });
  } else {
    let currentY = page1StartY;

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];

      // Check if this row cannot fit safely in the remaining space of current page
      const isStartOfPage = (doc.getNumberOfPages() === 1 && currentY === page1StartY) ||
                            (doc.getNumberOfPages() > 1 && currentY === subsequentPageStartY);

      if (!isStartOfPage && currentY + row.height > MAX_CONTENT_Y) {
        // Move the entire photo block/row to the next page without splitting
        doc.addPage('letter', 'portrait');
        currentY = subsequentPageStartY;
      }

      // Render left card
      drawMeasuredPhotoCard(row.left, MARGIN, currentY);

      // Render right card (if present)
      if (row.right) {
        drawMeasuredPhotoCard(row.right, MARGIN + PHOTO_WIDTH + PHOTO_GAP, currentY);
      }

      // Next row begins only after the tallest block in the current row has finished
      currentY += row.height + ROW_GAP;
    }
  }

  // Render footers across all generated pages with exact total page count
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    renderFooter(p, totalPages);
  }

  return doc;
}

/**
 * Exports the official Assured formatted PDF inspection photo report and triggers browser download
 */
export async function exportPhotoReportPdf(
  report: Report,
  providedIssues?: Issue[],
  providedPhotos?: Photo[]
): Promise<void> {
  const doc = await buildPhotoReportPdf(report, providedIssues, providedPhotos);
  const pdfBlob = doc.output('blob');
  const ref = getReportJobReference(report);
  const cleanRef = ref.replace(/[^a-zA-Z0-9-_]/g, '_');
  saveAs(pdfBlob, `${cleanRef}_Photo_Report.pdf`);
}
