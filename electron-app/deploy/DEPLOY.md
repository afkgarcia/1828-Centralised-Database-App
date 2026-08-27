# Deploying the 1828 Fasedocument Tracker (web) — Ubuntu 22.04/24.04

Copy-paste guide. Assumes a fresh VPS with root access and a DNS A-record
(e.g. `tracker.example.nl`) pointing at it.

## 1. System packages

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential python3 caddy
```

(`build-essential` + `python3` compile better-sqlite3; `caddy` is the HTTPS
reverse proxy.)

## 2. App user, directories, code

```bash
sudo useradd --system --home /var/lib/1828-tracker --shell /usr/sbin/nologin tracker
sudo mkdir -p /opt/1828 /var/lib/1828-tracker
sudo chown tracker:tracker /var/lib/1828-tracker
# Get the code onto the box (rsync from your machine, or git clone):
rsync -a --exclude node_modules --exclude dist.nosync electron-app/ you@server:/opt/1828/electron-app/
```

## 3. Build

```bash
cd /opt/1828/electron-app
npm ci                 # compiles better-sqlite3 for the server's Node — no Electron ABI dance here
npm run web:build      # builds the renderer into web/dist-renderer
```

## 4. Environment + service

```bash
sudo cp deploy/env.example /etc/1828-tracker.env
sudo chmod 600 /etc/1828-tracker.env
sudo nano /etc/1828-tracker.env        # set the real owner email + a strong password
sudo cp deploy/1828-tracker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now 1828-tracker
journalctl -u 1828-tracker -n 20       # expect "[bootstrap] owner account created for …"
```

The bootstrap owner is only created while the users table is empty. After the
first successful login, delete the `BOOTSTRAP_OWNER_PASSWORD` line from
`/etc/1828-tracker.env`.

## 5. HTTPS

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile         # put the real domain in
sudo systemctl reload caddy
```

Open `https://your-domain` — the login screen should be there. Certificates are
automatic (Let's Encrypt) and renew themselves.

## 6. Nightly backups

```bash
sudo -u tracker crontab -e
# add:
0 3 * * * cd /opt/1828/electron-app && DATA_DIR=/var/lib/1828-tracker /usr/bin/node scripts/backup-db.cjs
```

Backups land in `/var/lib/1828-tracker/backups/` (30 retained). Test one now:

```bash
sudo -u tracker env DATA_DIR=/var/lib/1828-tracker node /opt/1828/electron-app/scripts/backup-db.cjs
```

## 7. Live email (SMTP)

Notifications and password-reset codes record to the in-app outbox + `.eml`
files until SMTP is configured. Once the client provides the account, create
`/var/lib/1828-tracker/smtp.json`:

```json
{
  "enabled": true,
  "host": "smtp.example.com",
  "port": 587,
  "user": "notificaties@vivout.nl",
  "pass": "…",
  "from": "1828 Tracker <notificaties@vivout.nl>"
}
```

then `sudo systemctl restart 1828-tracker`. **Without SMTP, password reset is
unusable for remote users** (codes land in the server-side outbox) — treat SMTP
as required for client testing.

## 7b. Google Drive export (optional, owner feature)

"Export completed project to Drive" needs a Google OAuth client from the
client's Google Workspace:

1. In [console.cloud.google.com](https://console.cloud.google.com) (logged in
   as the Workspace admin): create a project → **APIs & Services → Enable
   APIs** → enable **Google Drive API**.
2. **OAuth consent screen** → Internal (Workspace only) → app name "1828
   Fasedocument Tracker" → scope `…/auth/drive.file` (the app only ever sees
   files it created itself).
3. **Credentials → Create credentials → OAuth client ID**:
   - Web deployment: type *Web application*, authorized redirect URI
     `https://your-domain/api/drive/callback`.
   - Desktop app: type *Desktop app* (loopback redirects are allowed
     automatically).
4. Put the client id + secret on the server:

```bash
sudo -u tracker tee /var/lib/1828-tracker/google-oauth.json > /dev/null <<'EOF'
{ "clientId": "….apps.googleusercontent.com", "clientSecret": "…" }
EOF
```

No restart needed. The owner then opens the export dialog → **Verbind Google
Drive…** → Google consent → done. Exports land in a "1828 Fasedocument
Tracker" folder in that account's My Drive; the app stores only a refresh
token (`google-drive-token.json` — delete it to disconnect).

## 8. Updating

```bash
cd /opt/1828/electron-app
git pull            # or rsync
npm ci
npm run web:build
sudo systemctl restart 1828-tracker
```

Sessions live in the database, so a restart does **not** log users out. Schema
changes apply automatically at boot via drizzle migrations (`drizzle/`).

## Notes

- The server binds `127.0.0.1:8028`; only Caddy is exposed. Secure cookies are
  on because `NODE_ENV=production`.
- Account-existence probing is blunted (normalized login/reset responses) and
  the auth endpoints are rate-limited per IP (`AUTH_RATE_LIMIT`).
- PDF export is desktop-only for now; Excel export works on the web.
- Everything else (users, cities, approvals, admin) is managed in-app by the
  owner account.
