import type { DriveKind } from '../types';

/** Google Drive link handling — detection order is Kotlin parity (first match wins). */
export function detectDriveKind(url: string): DriveKind {
  const u = url.toLowerCase();
  if (u.includes('docs.google.com/document')) return 'GOOGLE_DOC';
  if (u.includes('docs.google.com/spreadsheets')) return 'GOOGLE_SHEET';
  if (u.includes('docs.google.com/presentation')) return 'GOOGLE_SLIDES';
  if (u.includes('docs.google.com/forms') || u.includes('forms.gle')) return 'GOOGLE_FORM';
  if (u.includes('drive.google.com') && u.includes('/folders/')) return 'DRIVE_FOLDER';
  if (u.includes('drive.google.com')) return 'DRIVE_FILE';
  return 'WEB_LINK';
}

/** Trim and auto-prefix https:// when no scheme is present (Kotlin parity). */
export function normalizeUrl(rawUrl: string): string {
  const url = rawUrl.trim();
  if (url.length > 0 && !url.includes('://')) return `https://${url}`;
  return url;
}

/** Kotlin `Attachment.defaultName`: product names for Drive kinds, host for plain links. */
export function defaultAttachmentName(kind: DriveKind, url: string): string {
  switch (kind) {
    case 'GOOGLE_DOC':
      return 'Google Doc';
    case 'GOOGLE_SHEET':
      return 'Google Sheet';
    case 'GOOGLE_SLIDES':
      return 'Google Slides';
    case 'GOOGLE_FORM':
      return 'Google Form';
    case 'FILE_UPLOAD':
      return 'Bestand';
    case 'DRIVE_FOLDER':
      return 'Drive folder';
    case 'DRIVE_FILE':
      return 'Drive file';
    case 'WEB_LINK': {
      try {
        const host = new URL(url).hostname;
        return host.length > 0 ? host : 'Link';
      } catch {
        return 'Link';
      }
    }
  }
}

export interface AttachmentInput {
  url: string;
  kind: DriveKind;
  name: string;
}

/** Validates + normalizes user input for a new attachment; id/timestamps are the caller's job. */
export function prepareAttachment(rawUrl: string, rawName: string | null): AttachmentInput | null {
  const url = normalizeUrl(rawUrl);
  if (url.length === 0 || !url.includes('.')) return null;
  const kind = detectDriveKind(url);
  const trimmed = rawName?.trim() ?? '';
  return { url, kind, name: trimmed.length > 0 ? trimmed : defaultAttachmentName(kind, url) };
}
