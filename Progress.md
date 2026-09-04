# 1828 Fasedocument Tracker — Progress

*Last updated: 4 September 2026*

## What this project is

A phase-document tracker for client Ernest (1828): construction projects move through
Gemeenteontwikkeling → Acquisitiefase → … → Garantiefase, with deliverables per phase,
role-based access, and formal owner approval gating each phase. Source of truth for the
task structure is Ernest's workbook (*260320 fasedocument Vdef*, 10 sheets / 338 tasks,
verified cell-by-cell against the app data).

## What we've accomplished

### 1. HTML prototypes (`Prototypes/`)
- `fasedocument_tracker.html` — the original single-file prototype.
- `fasedocument_tracker_v2.html` — added three-state tasks (Open/Done/N.v.t.), custom
  rows, phase approval instead of auto-unlock, and the Cities vs Projects split.

### 2. Kotlin/JavaFX desktop app (`desktop-app/`, v0.9) — the client-facing build
Delivered against Ernest's weekly roadmap, demo-ready throughout:
- **Login & accounts** — email/password sign-in, self-service signup with owner
  approval, password reset via emailed code, change-password.
- **Role-based access** — owner (Ernest) sees everything; colleagues only their
  granted cities/projects. Owner user-admin with per-city access chips and
  remove-user-with-document-handover.
- **Approval workflow** — always-visible "Indienen ter goedkeuring", unfinished-task
  prompt (mark N/A or move to next phase under a **WIP** headline), owner
  approve/reject/reopen, completed phases viewable-but-locked.
- **City gate** — Gemeenteontwikkeling comes *before* Acquisitiefase: completed and
  approved once per city; projects in a city stay locked until then (confirmed by the
  source numbering: 1.1–1.3 city, 1.4+ acquisition).
- **Email notifications** — deliverable submitted / approval requested / phase
  approved, with in-app outbox + `.eml` files + optional SMTP.
- **Google Drive linking** — documents attach per task (type auto-detected), review
  strips, docs listed in approval emails.
- **Dashboard, Excel export, NL/EN, zoom, Docs-style readability pass.**
- Verified by `./gradlew accessCheck` (~60 printed invariants) each release.

### 3. Electron + TypeScript migration (`electron-app/`) — the go-forward codebase
Full port completed in 7 checkpointed steps, then extended:
- **Architecture for reuse**: `/shared` (types, business logic, i18n — zero
  Electron/DB/React imports, lint-enforced) + `/desktop` (main = SQLite via
  Drizzle/better-sqlite3, IPC; renderer = React with one swappable API adapter).
  The future web app swaps the adapter for fetch and reuses `/shared` verbatim.
- **Persistence** (new vs Kotlin): everything survives restarts in SQLite; UUID keys,
  Postgres-portable schema; demo seeds dev-gated.
- **Feature parity** with the Kotlin app across auth, access, approvals + city gate,
  unfinished-task WIP move, attachments, notifications (outbox + `.eml` + optional
  SMTP via nodemailer), user admin, outbox view, zoom, NL/EN.
- **Kotlin bugs fixed rather than ported** (found by adversarial audit): RASCI
  substring matching (PM matched PPM), UI-only lock bypass (guards now in the main
  process), junk attachments from placeholder links, reset codes visible in the
  owner's outbox.
- **Exports (latest)**:
  - *Excel* — matches Ernest's **original workbook** per-sheet (measured widths,
    header/spacer differences, blok-separator blanks): **6 of 10 sheets row-for-row
    identical incl. blank positions**; remaining deltas are source-side
    irregularities, all formatting knobs in one theme object for team iteration.
    Scope picker: whole portfolio or one project in the original's exact sheet names.
  - *PDF* — print-designed report (brand band, status pills, progress bars, per-phase
    page breaks, NL/EN) via Chromium printToPDF; verified headlessly end-to-end.
- **Admin-mode parity port (28 Jul, hardened 5 Aug)** — the i18n dead-key scan exposed that the
  Kotlin admin features were never ported (deferred in step 5, missed at close):
  now delivered — owner admin toggle + badge, add city (owner), add project
  (any user with city access), custom rows with the Kotlin delete-lock bypass
  **fixed** rather than ported, blok/task reorder with Kotlin semantics; all
  guards in the main process. Plus smaller gaps: signup role labels, attach-URL
  validation, dashboard empty states + activity feed + "met document" tile,
  outbox Van-line, doc-kind tooltips.
- **Packaging validated (28 Jul)** — `npm run dist` DMG boots on a clean
  userData: native module ✓, seed gate off when packaged ✓, `SEED_DEMO=1`
  escape hatch ✓, outbox under packaged userData ✓. electron-builder now
  ad-hoc-signs via an afterPack hook (unsigned bundles get SIGKILLed on Apple
  silicon); output moved to `dist.nosync/`. Real distribution still wants a
  Developer ID + a build off this machine (see machine caveat).
- **i18n**: 209 keys, **zero unreferenced** (pruned 29 dead keys after the port).
- **Web app v1 (9 Aug)** — the same renderer now runs in the browser: `web/`
  Express server reuses the main-process modules; cookie-session auth with the
  actor always taken from the session (never the wire); access enforcement and
  the phase gate run server-side; Excel export streams as a download (PDF stays
  desktop-only for now). Run: `npm run web:build` once, then
  `npm run web:server:demo` → http://localhost:8028. Verified live end-to-end
  in the browser plus 7 dedicated API tests.
- **Live-test readiness (10 Aug)** — everything engineering-side for client
  testing: drizzle-kit migrations with legacy-DB adoption (backlog #8 closed),
  first-owner bootstrap via env vars (fresh installs previously had no way to
  create an owner), DB-backed sessions (deploys keep users signed in), per-IP
  rate limiting + no-account-oracle auth responses, nightly-backup script, and
  a `deploy/` kit (Caddyfile, systemd unit, env template, DEPLOY.md,
  TESTING_CHECKLIST.md). Remaining before Ernest: hosting + domain + SMTP
  (client), deploy + smoke pass (Alessandro).
- **Review screen + export completeness (12 Aug, client feedback)** — Ernest's
  approval screen: a submitted phase shows row by row the completed items
  (green, documents clickable), N.v.t. items (greyed), and moved-to-next-phase
  items (struck through, with their documents) — reachable from the dashboard
  approval queue. Excel and PDF exports now mark N.v.t. rows and list the
  moved-out rows per origin phase (new `moved_from_phase_id` provenance,
  migration 0002).
- **Client feedback round 2 (13 Aug)** — (1) *file attachments from the
  computer*: upload like an email attachment (25 MB), stored by the app,
  access-checked downloads on web, native open on desktop; (2) *add row for
  every user* (not admin-only), with all server-side guards intact;
  (3) *WIP items governed by the approval flow*: moved rows are pulled back on
  reject/withdraw with their original place restored, stay only after
  approval, and carry a WIP badge in the next phase.
- **Google Drive export (13 Aug)** — "export completed project to Drive":
  owner connects the company Google account once (OAuth, `drive.file` scope
  only), then per-project exports upload straight into a "1828 Fasedocument
  Tracker" Drive folder and open in the browser. Ships credential-gated:
  invisible until Ernest's Workspace OAuth client (client action #5) is
  dropped in as `google-oauth.json` — then it lights up without a deploy.
- **Quality**: 128 asserting tests (the Kotlin invariants as a real Vitest suite +
  regressions + 14 structure-mutation tests incl. position-density repros and
  main-process phase-gate enforcement), tsc + eslint clean, **six** adversarial
  multi-agent verification rounds (97 findings total; every blocker/should-fix
  resolved — highlights: `window.prompt` crashing in Electron (r4), silent
  dead UI on expired web sessions (r5), and a legacy-migration attachment wipe
  via FK cascade (r6) — each caught before any user ever hit it).

## Live deployment (4 Sep 2026)

- **https://fasedocument.1828.nl** — client VPS (Ubuntu 24.04, `179.198.197.19`),
  systemd service `1828-tracker`, Caddy auto-HTTPS, nightly backups (DB + files)
  at 03:00 under `/var/lib/1828-tracker/backups`. Deploy = rsync from this
  repo + `npm ci` + `npm run web:build` + `systemctl restart` (DEPLOY.md).
- **Email live** via Microsoft 365 (`tracker@1828.nl`, SMTP AUTH) — verified:
  password-reset mail delivered `SMTP ✓`. Fixed on the way: reset codes were
  never handed to the mail pipeline before (outbox only).
- **Accounts**: `alessandro@garciagaspar.com` (owner, support) and
  `ernest@1828.nl` (owner, all cities). Database starts clean — no test data.
- **Open with the client**: rotate the `alessandro-garcia` server password +
  disable SSH password auth (asked, unanswered); Google OAuth for Drive export
  (optional). Note: the VPS template's unused Traefik container was stopped
  (kept, auto-restart off) because it occupied ports 80/443.

## Current state

- **`electron-app/` is the primary codebase.** Run: `cd electron-app && npm run dev`.
  Logins: `ernest@1828.nl`/`ernest` (owner), `pia@1828.nl`/`test` (PM, Leiden only).
  Reset demo data: `npm run db:reset`. Tests: `npm test`.
- **`desktop-app/` (Kotlin) remains as the reference build** (`./gradlew run`) and the
  parity baseline; no further development planned there.
- **Known machine caveats** (root-caused 28 Jul): (1) iCloud FileProvider stamps
  Finder xattrs onto app/framework bundle roots in the tree — this breaks code
  signatures, which Apple-silicon macOS punishes with SIGKILL; the packaging
  hook strips + re-signs, and dev self-heals via the signed Electron copy in
  `~/Library/Caches/1828-electron` (no HMR on this machine). (2) **Norton**
  (com.norton.mes) SIGKILLs freshly-written executables in /tmp-like paths and
  deletes flagged apps out of `~/Library/Caches` — the historical "Electron
  broke twice" now has two culprits, not one. (3) `npm test` and `npm run dev`
  need different native builds of better-sqlite3 — the scripts handle this.
  (4) Dev and packaged builds share the same userData dir
  (`~/Library/Application Support/fasedocument-tracker`).

## Next steps

**Recommended immediately**
1. **Move the project off the iCloud-synced Desktop** (e.g. `~/Projects/1828`) — ends
   the executable-kill / EPERM / eviction failure class for good.
2. **Team formatting round on the Excel export** (expected by the roadmap): review a
   per-project export side-by-side with Ernest's workbook; tweaks are one-line edits
   in `EXCEL_THEME` / `SHEET_LAYOUTS`.

**For Ernest / the client**
3. Final title for the **WIP** headline (placeholder; single constant to change).
4. Source-data cleanup: stray RASCI tokens `DENISE` and `PP` in the workbook.
5. Google Workspace OAuth credentials — now unlocks BOTH in-app Drive browsing
   (future) and the shipped **export-to-Drive** button (see DEPLOY.md §7b for
   the exact console steps).
6. SMTP account to switch notifications from outbox-only to live email.

**Engineering backlog** (tracked in `electron-app/MIGRATION_NOTES.md` §7)
7. ~~Run `npm run dist` once and validate the packaged app~~ **done 28 Jul** (see
   Current state; DMG boots, gates verified, afterPack ad-hoc signing added).
8. ~~Adopt drizzle-kit migrations / XOR CHECK~~ **done 10 Aug** (0000 baseline +
   0001, legacy DBs auto-adopted, schema.ts is the source of truth).
9. ~~Web version~~ **v1 done 9 Aug** (fetch adapter, server-side enforcement,
   session auth). Still open: deployment/HTTPS, persistent session store,
   web PDF export, in-app desktop download page.
10. ~~Prune the ~20 dead i18n keys~~ **done 28 Jul** (209 keys, zero unreferenced —
    and the scan exposed + closed the unported admin-mode feature set); still open:
    consider a wasm SQLite driver to end the dual-ABI rebuild dance.
11. Developer ID + notarization (or a CI build off this machine) when the DMG
    starts going to the client's team.
