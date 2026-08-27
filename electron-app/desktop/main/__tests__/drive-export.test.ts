// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildAuthUrl,
  completeConnect,
  consumeState,
  disconnectDrive,
  driveFileName,
  driveStatus,
  initDrive,
  uploadWorkbookToDrive,
  type FetchLike,
} from '../drive-export';

/** Google stand-in: token endpoint + Drive search/create/upload. */
function mockGoogle(): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const respond = (body: unknown): Response =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith('https://oauth2.googleapis.com/token'))
      return respond({ access_token: 'at-123', refresh_token: 'rt-456' });
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?q='))
      return respond({ files: [] }); // no folder yet
    if (url.startsWith('https://www.googleapis.com/drive/v3/files'))
      return respond({ id: 'folder-1' });
    if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files'))
      return respond({ id: 'file-1', webViewLink: 'https://drive.google.com/file/d/file-1/view' });
    return new Response('not found', { status: 404 });
  }) as FetchLike;
  return { fetch: impl, calls };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), '1828-drive-'));
  initDrive(dir);
});

describe('Google Drive export (credential-gated)', () => {
  it('walks unconfigured → disconnected → connected → disconnected', async () => {
    expect(driveStatus()).toBe('unconfigured');
    expect(buildAuthUrl('http://127.0.0.1:1/callback')).toBeNull();

    writeFileSync(
      join(dir, 'google-oauth.json'),
      JSON.stringify({ clientId: 'cid', clientSecret: 'sec' }),
    );
    expect(driveStatus()).toBe('disconnected');

    const auth = buildAuthUrl('http://127.0.0.1:1/callback')!;
    expect(auth.url).toContain('client_id=cid');
    expect(auth.url).toContain('drive.file'); // least-privilege scope
    expect(consumeState(auth.state)).toBe(true);
    expect(consumeState(auth.state)).toBe(false); // one-shot

    const google = mockGoogle();
    expect(await completeConnect('code-1', 'http://127.0.0.1:1/callback', google.fetch)).toBe(true);
    expect(driveStatus()).toBe('connected');

    disconnectDrive();
    expect(driveStatus()).toBe('disconnected');
  });

  it('uploads the workbook into the app folder and returns the Drive link', async () => {
    writeFileSync(
      join(dir, 'google-oauth.json'),
      JSON.stringify({ clientId: 'cid', clientSecret: 'sec' }),
    );
    writeFileSync(join(dir, 'google-drive-token.json'), JSON.stringify({ refreshToken: 'rt' }));

    const google = mockGoogle();
    const result = await uploadWorkbookToDrive(
      Buffer.from('xlsx-bytes'),
      driveFileName('Pieterskwartier'),
      google.fetch,
    );
    expect(result.ok).toBe(true);
    expect(result.link).toBe('https://drive.google.com/file/d/file-1/view');
    expect(result.fileName).toMatch(/^Pieterskwartier — fasedocument \d{4}-\d{2}-\d{2}\.xlsx$/);
    // token → folder search → folder create → multipart upload
    expect(google.calls.some((u) => u.includes('oauth2'))).toBe(true);
    expect(google.calls.some((u) => u.includes('uploadType=multipart'))).toBe(true);
  });

  it('reports NOT_CONNECTED without a stored token', async () => {
    writeFileSync(
      join(dir, 'google-oauth.json'),
      JSON.stringify({ clientId: 'cid', clientSecret: 'sec' }),
    );
    const google = mockGoogle();
    const result = await uploadWorkbookToDrive(Buffer.from('x'), 'a.xlsx', google.fetch);
    expect(result).toEqual({ ok: false, error: 'NOT_CONNECTED' });
  });
});
