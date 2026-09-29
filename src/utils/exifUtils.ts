import exifr from 'exifr';

/**
 * Extracts the original capture date/time from EXIF metadata (DateTimeOriginal).
 * Strictly prefers DateTimeOriginal.
 * Returns an ISO timestamp string if found, or null if capture metadata is unavailable.
 * Never invents a date or falls back to upload/report time.
 */
export async function extractExifCaptureDate(
  fileOrDataUrl: File | Blob | string | undefined | null
): Promise<string | null> {
  if (!fileOrDataUrl) return null;

  // If string, only accept valid data URLs or blob URLs to avoid network/fs lookups
  if (typeof fileOrDataUrl === 'string') {
    if (!fileOrDataUrl.startsWith('data:image/') && !fileOrDataUrl.startsWith('blob:')) {
      return null;
    }
  }

  try {
    const output = await exifr.parse(fileOrDataUrl, {
      tiff: true,
      exif: true,
      pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate'],
    });

    if (!output) return null;

    // Prefer DateTimeOriginal, then CreateDate
    const rawDate = output.DateTimeOriginal || output.CreateDate;
    if (!rawDate) return null;

    if (rawDate instanceof Date && !isNaN(rawDate.getTime())) {
      return rawDate.toISOString();
    }

    if (typeof rawDate === 'string') {
      // Standard EXIF format: "YYYY:MM:DD HH:MM:SS" or "YYYY-MM-DD HH:MM:SS"
      const normalized = rawDate.trim().replace(/^(\d{4})[:\-](\d{2})[:\-](\d{2})[\sT]+/, '$1-$2-$3T');
      const parsed = new Date(normalized);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }

    return null;
  } catch {
    // If no EXIF headers or parsing error, return null (never invent a timestamp)
    return null;
  }
}

/**
 * Formats the capture timestamp into a clear, professional date & time string
 * using the device's local format.
 */
export function formatCaptureDateTime(isoString?: string | null): string {
  if (!isoString) return 'Capture date/time unavailable';

  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return 'Capture date/time unavailable';

    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return 'Capture date/time unavailable';
  }
}
