import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Google Drive export — uploads the per-project workbook into the connected
 * Google account's Drive ("export completed project to Drive", client ask).
 *
 * Zero dependencies: plain fetch against Google's OAuth + Drive v3 REST APIs,
 * with the least-privilege `drive.file` scope (the app sees only files it
 * created itself). Configuration follows the smtp.json pattern:
 *   <dataDir>/google-oauth.json  { "clientId": "…", "clientSecret": "…" }
 *     — from the client's Google Cloud console (see DEPLOY.md §Drive).
 *   <dataDir>/google-drive-token.json
 *     — written by the connect flow (refresh token); delete to disconnect.
 * Until the first file exists the feature reports 'unconfigured' and stays
 * invisible in the UI.
 */

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_NAME = '1828 Fasedocument Tracker';

export type DriveStatus = 'unconfigured' | 'disconnected' | 'connected';

interface OauthClient {
  clientId: string;
  clientSecret: string;
}

/** Injectable for tests; production uses global fetch. */
export type FetchLike = typeof fetch;

let dataDir = '';

export function initDrive(dir: string): void {
  dataDir = dir;
}

function readJson<T>(file: string): T | null {
  if (!dataDir || !existsSync(join(dataDir, file))) return null;
  try {
    return JSON.parse(readFileSync(join(dataDir, file), 'utf8')) as T;
  } catch {
    return null;
  }
}

function oauthClient(): OauthClient | null {
  const cfg = readJson<Partial<OauthClient>>('google-oauth.json');
  return cfg?.clientId && cfg.clientSecret
    ? { clientId: cfg.clientId, clientSecret: cfg.clientSecret }
    : null;
}

function storedRefreshToken(): string | null {
  return readJson<{ refreshToken?: string }>('google-drive-token.json')?.refreshToken ?? null;
}

export function driveStatus(): DriveStatus {
  if (!oauthClient()) return 'unconfigured';
  return storedRefreshToken() ? 'connected' : 'disconnected';
}

export function disconnectDrive(): void {
  try {
    rmSync(join(dataDir, 'google-drive-token.json'), { force: true });
  } catch {
    /* best effort */
  }
}

// ── OAuth (authorization-code flow; web redirect or desktop loopback) ────────

/** One-shot anti-CSRF states for the callback, 10-minute lifetime. */
const pendingStates = new Map<string, number>();

export function buildAuthUrl(redirectUri: string): { url: string; state: string } | null {
  const client = oauthClient();
  if (!client) return null;
  const state = randomUUID();
  pendingStates.set(state, Date.now() + 10 * 60 * 1000);
  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent', // always mint a refresh token
    state,
  });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, state };
}

export function consumeState(state: string): boolean {
  const expiry = pendingStates.get(state);
  pendingStates.delete(state);
  for (const [key, until] of pendingStates) if (until < Date.now()) pendingStates.delete(key);
  return expiry !== undefined && expiry >= Date.now();
}

export async function completeConnect(
  code: string,
  redirectUri: string,
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  const client = oauthClient();
  if (!client) return false;
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) return false;
  const tokens = (await res.json()) as { refresh_token?: string };
  if (!tokens.refresh_token) return false;
  writeFileSync(
    join(dataDir, 'google-drive-token.json'),
    JSON.stringify({ refreshToken: tokens.refresh_token }, null, 2),
  );
  return true;
}

async function accessToken(fetchImpl: FetchLike): Promise<string | null> {
  const client = oauthClient();
  const refreshToken = storedRefreshToken();
  if (!client || !refreshToken) return null;
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) return null;
  return ((await res.json()) as { access_token?: string }).access_token ?? null;
}

// ── Drive upload ─────────────────────────────────────────────────────────────

async function findOrCreateFolder(token: string, fetchImpl: FetchLike): Promise<string | null> {
  const query = encodeURIComponent(
    `name = '${FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
  );
  const found = await fetchImpl(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (found.ok) {
    const body = (await found.json()) as { files?: { id: string }[] };
    if (body.files?.[0]) return body.files[0].id;
  }
  const created = await fetchImpl('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  if (!created.ok) return null;
  return ((await created.json()) as { id?: string }).id ?? null;
}

export interface DriveUploadResult {
  ok: boolean;
  error?: 'NOT_CONNECTED' | 'UPLOAD_FAILED';
  link?: string;
  fileName?: string;
}

/** Uploads an .xlsx into the app's Drive folder; returns the webViewLink. */
export async function uploadWorkbookToDrive(
  content: Buffer,
  fileName: string,
  fetchImpl: FetchLike = fetch,
): Promise<DriveUploadResult> {
  const token = await accessToken(fetchImpl);
  if (!token) return { ok: false, error: 'NOT_CONNECTED' };
  const folderId = await findOrCreateFolder(token, fetchImpl);

  const metadata = {
    name: fileName,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ...(folderId ? { parents: [folderId] } : {}),
  };
  const boundary = `1828-${randomUUID()}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const uploaded = await fetchImpl(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  if (!uploaded.ok) return { ok: false, error: 'UPLOAD_FAILED' };
  const file = (await uploaded.json()) as { webViewLink?: string };
  return { ok: true, link: file.webViewLink, fileName };
}

/** "Pieterskwartier — fasedocument 2026-08-13.xlsx" */
export function driveFileName(projectName: string): string {
  return `${projectName} — fasedocument ${new Date().toISOString().slice(0, 10)}.xlsx`;
}
