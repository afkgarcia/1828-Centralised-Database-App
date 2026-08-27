import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Storage for uploaded task documents (Ernest: attach from the computer, like
 * an email attachment — not only Drive links). Files live under
 * <dataDir>/files/<attachmentId>; the original filename is the attachment's
 * `name` in the DB. Desktop and web share this module — only the transport
 * differs (native dialog + IPC vs raw-body HTTP upload).
 */

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB, email-attachment sized

let filesDir = '';

export function initFiles(dataDir: string): void {
  filesDir = join(dataDir, 'files');
  mkdirSync(filesDir, { recursive: true });
}

export function uploadedFilePath(attachmentId: string): string {
  if (!filesDir) throw new Error('initFiles() has not run');
  // The id is a server-generated UUID — never client input — so it is safe as a
  // path segment; assert the invariant anyway.
  if (!/^[0-9a-f-]{36}$/i.test(attachmentId)) throw new Error('invalid attachment id');
  return join(filesDir, attachmentId);
}

export function saveUploadedFile(attachmentId: string, content: Buffer): void {
  writeFileSync(uploadedFilePath(attachmentId), content);
}

export function uploadedFileExists(attachmentId: string): boolean {
  try {
    return existsSync(uploadedFilePath(attachmentId));
  } catch {
    return false;
  }
}

export function deleteUploadedFile(attachmentId: string): void {
  try {
    rmSync(uploadedFilePath(attachmentId), { force: true });
  } catch {
    /* best-effort cleanup */
  }
}
