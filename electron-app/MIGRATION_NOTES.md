# 1828 Tracker — Kotlin/JavaFX → Electron + TypeScript migration notes

Running log of the migration. Full audit reports (5 readers + completeness
critic, generated 2026-07-19 against desktop-app v0.9.0) live in `./audit/`.
This file is the curated summary plus decisions and follow-ups.

Status: **MIGRATION COMPLETE — feature parity with desktop-app v0.9 reached
(steps 1–7 delivered, 82 tests green).** Remaining follow-ups live in §7.

Decisions (2026-07-21, confirmed by the user): Drizzle + better-sqlite3 · full local
accounts with bcrypt behind an AuthProvider seam · full email-notification port ·
demo seeds identical to Kotlin (dev-gated) plus reset script.

---

## 1. Audit of the existing app (`../desktop-app`, Kotlin 1.9 / JavaFX 21)

### 1.1 Screens

| View | Purpose |
|---|---|
| LoginView | Email+password sign-in; inline signup-request card; 2-step forgot-password (code by email → new password) |
| DashboardView | Stats strip (cities/projects/open tasks/pending approvals), owner approval queue, city tile grid, recent-notifications feed |
| CityDetailView | One city's Gemeenteontwikkeling task list + its own submit→approve banner + projects grid (locked tiles until city approved) |
| ProjectView | Phase tabs (9), approval banner (always-visible submit w/ unfinished-task flow), review-docs strip, task list |
| ApprovalsView | Owner inbox: pending city submissions (first), phase submissions with doc chips, pending signups |
| UserAdminView | Owner: role dropdown, per-city access chips, approve/reject/remove users (remove = pick replacement, hand over documents) |
| OutboxView | Sent notification emails; owner sees all, colleagues only mail addressed to them; expandable bodies; open-.eml-folder |
| Shared chrome | HeaderBar (nav, pending badge, 🔑 change password, zoom 🔍−%+, NL/EN), ExportPanel (stats + Excel export), TaskRow/TaskListView (tri-state check, N/A pill, RASCI tags, doc chips, admin reorder/add/delete-custom) |

### 1.2 Entities (all in-memory; no IDs survive restart)

- **TaskTemplate / PhaseTemplate** — parsed from `resources/phases.json` (10 sheets, 338 tasks: Gemeenteontwikkeling 26 = "city phase"; 9 project phases = Acquisitie 27 … Garantie 26). Template fields: `row, step, blok, deliverable, existingLink, r, a, s, c, i, opm`.
- **Task** — `id, step, blok, deliverable, r/a/s/c/iCol/opm, status ∈ {OPEN, DONE, NA}, attachments[], custom`. `blokKey = "step||blok"` is the grouping key. IDs: `"{prefix}_b_{idx}"` or `"c_{millis}_{counter}"`.
- **City** — `name (natural key), tasks[], submitted, approved`.
- **Phase** — `template, tasks[], submitted, approved`. **Project** — `name (natural key), parentCity, phases[9]`.
- **Attachment** — `id, name, url, kind ∈ {GOOGLE_DOC, GOOGLE_SHEET, GOOGLE_SLIDES, GOOGLE_FORM, DRIVE_FOLDER, DRIVE_FILE, WEB_LINK}, addedBy (display-name string!), addedAt`. Kind detected from URL substrings; `https://` auto-prefixed.
- **User** — `email (natural key), passwordHash (SHA-256, unsalted), displayName, role ∈ {OWNER, PM, OM, PO, PPM, MT}, status ∈ {PENDING, ACTIVE, REJECTED}, accessAllCities, cityAccess: Set<cityName>, projectAccess: Set<projectName>`.
- **EmailMessage** — `event, from, to[], subject, body, timestamp, deliveredVia` (outbox is in-memory, newest first; every send also writes an RFC-822 `.eml` under `~/.1828-tracker/outbox/`).

### 1.3 Business rules (the heart of `/shared/business-logic`)

- **City gate**: project phase index 0 unlocks iff `cities[project.parentCity].approved`. Phase *i>0* unlocks iff `phases[i-1].approved`. Approved/submitted phases freeze task edits (viewable, locked).
- **Approval lifecycle** (identical for city + phase): open → submitted (freeze; email owners) → owner approves (email team; next unlocks) / rejects (email team; unfreeze) / submitter withdraws. Owner can reopen approved.
- **Submit with unfinished tasks**: submit is always visible. If open tasks exist: confirm prompt → choose *mark all N/A* or *move to next phase* (moved tasks get `step="WIP", blok=""`, prepended to next phase, keep status/RASCI/attachments; move option absent on last phase and on cities).
- **Progress math**: `progress = done / (relevant tasks not N/A)`; empty ⇒ 1.0. `isPhaseReady` = no OPEN among *role-filtered* tasks; the submit-banner open-count uses the *full* task list (deliberate: prevents role-filtered users submitting past others' work — but the two disagree; normalize in port, see §3).
- **Role filter (RASCI)**: task relevant to role R iff R appears in `r/a/s/c` via **substring** match — a bug: "PM" matches "PPM" cells (36 tasks affected). Port with token-split matching.
- **Access control**: owner/accessAllCities see everything. City visible iff in `cityAccess` or user has project grant under it; project visible iff parent city granted or project granted. Approver = owner only.
- **Auth**: login (Unknown/BadPassword/Pending/Rejected/Ok), signup→PENDING→owner approves, 6-digit single-use reset codes (emailed), change-password verifies current, remove-user = never owner/self + reassign all attachments `addedBy` to chosen replacement.
- **Notifications** (recipient rules): deliverable done (single + mark-all digest) → active owners; approval requested → active owners; approved/rejected → active non-owner team with access (fallback owners); password reset → the account only. City variants mirror phase variants.

### 1.4 Persistence

**None.** Everything is in-memory singletons (`AppState`, `AuthService`, `EmailService`); state resets every launch. Only disk I/O: reads `phases.json` (classpath) + `~/.1828-tracker/smtp.properties`; writes `.eml` files. **⇒ There is no user data to import.** The only "data compatibility" work is importing `phases.json` (and re-verifying against the source workbook *260320 fasedocument Vdef.xlsx*) into the template tables, plus reproducing the demo seeds.

### 1.5 Integrations (exact calls)

- **Excel export**: Apache POI XSSF — `XSSFWorkbook`, `createSheet/createRow/createCell`, header style (bold white on dark blue), `WorkbookUtil.createSafeSheetName`, col widths ×256. Sheets: Overview + one per city + one per project-phase (status line + 11-col task table incl. Documents column). → port with **exceljs** in Electron main.
- **Email**: jakarta.mail (Angus) `Session/MimeMessage/Transport.send`, STARTTLS props, auth from `smtp.properties`; only if `enabled=true`, on a daemon thread; outbox row shows `SMTP ✓/✗`. `.eml` writing includes RFC 2047 base64 subject encoding. → **nodemailer** + same outbox/.eml behavior.
- **Google Drive**: *link-based only* — no API, no OAuth. URL-substring type detection + open in system browser (JavaFX HostServices). → pure function in `/shared`, `shell.openExternal` in main.
- **PDF export: does not exist** (brief assumed it; flag — see §3/§4).

### 1.6 Parity acceptance suite

`desktop-app/src/test/kotlin/app/AccessCheck.kt` enumerates ~60 checks (auth results, access scoping, approval+city gates, notification routing incl. exact recipients, Drive detection, reset/change/removal, N/A + WIP-move). It only *prints* — the port turns this list into real asserting tests (Vitest) over `/shared`. Full enumeration: `audit/build-runtime-tests.md` §3.

### 1.7 Do-not-carry list (fragile/wrong, fix in port)

1. **existingLink junk attachments**: 302/338 templates have placeholder *descriptions* ("Link naar besluit"), not URLs; the app materializes each as a broken `https://Link naar…` attachment. Port as a `linkHint` display field; create zero attachments from it.
2. **RASCI substring matching** ("PM" ⊂ "PPM") + dirty tokens in data (`MT/PO`, `DENISE + PO`, `PP`) → tokenize on split + normalize data at import.
3. **SHA-256 unsalted passwords + seeded demo credentials** → bcrypt/argon2; seeds behind a dev flag.
4. **Attachment ownership by displayName string** (`addedBy`) — collides on rename/duplicate names → FK to user id; keep a denormalized display string for exports.
5. **IDs from `System.currentTimeMillis()+counter`** → UUIDs everywhere (also the brief's requirement for future sync).
6. **Cities/projects keyed by name** (rename impossible) → UUID PK + unique name.
7. **Custom-row deletion bypasses the phase lock** (admin can delete custom rows in submitted/approved phases — confirmed bug) → enforce lock in shared logic, not UI.
8. **Reset codes visible in owner outbox** + `requestPasswordReset` returns the code → owner outbox excludes security mail; code never returned to callers.
9. **Full-tree re-render on a global listener** → React state (fine-grained re-render for free).
10. **`WIP` placeholder headline** (title pending from Ernest) → config constant, single source.
11. 20 dead i18n keys of 222; NL fallback chain (active → NL → raw key) worth keeping.

---

## 2. Proposed target architecture

```
electron-app/
  package.json  tsconfig.base.json  .eslintrc.cjs  .prettierrc  electron-builder.yml
  /shared                     # zero Electron/DB/React imports — future web backend reuses verbatim
    /types                    # City, Project, Phase, Task, Attachment, User, EmailMessage, enums
    /business-logic           # pure functions + exhaustive Vitest suite (ported AccessCheck)
      access.ts               # canAccessCity/Project(user, grants), isApprover
      approval.ts             # unlock rules (city gate), submit/approve/reject/reopen transitions
      progress.ts             # N/A-aware progress, readiness, open counts
      rasci.ts                # tokenized role matching (fixes substring bug)
      unfinished.ts           # markAllNa / moveToNextPhase (WIP) as pure list transforms
      drive.ts                # DriveKind detection, URL normalization, default names
      notifications.ts        # event → recipients + i18n-keyed subject/body descriptors
    /i18n                     # nl.json / en.json (222 keys, dead ones dropped)
  /desktop
    /main                     # Electron main: window, SQLite (ORM per §4), IPC handlers,
                              #   excel-export (exceljs), mailer (nodemailer + .eml outbox),
                              #   shell.openExternal, phases.json import + demo seed
    /preload                  # typed contextBridge API (one namespace per domain)
    /renderer                 # React + TS + Vite; components take data + callbacks only,
                              #   IPC isolated in a /services adapter layer (web swaps it for fetch)
  /scripts
    import-phases.ts          # one-time: phases.json → template tables (+ RASCI normalization report)
  MIGRATION_NOTES.md          # this file
  /audit                      # frozen audit reports
```

DB schema mirrors §1.2 with the §1.7 fixes: UUID PKs, `users` (+`role`,`status`,`grants`), `cities`, `projects(city_id)`, `phases(project_id, idx, submitted, approved)`, `tasks(phase_id NULLABLE / city_id NULLABLE, template_row, status, is_custom, link_hint)`, `attachments(task_id, added_by_user_id)`, `emails` + `email_recipients`, `phase_templates`/`task_templates`. Postgres-compatible types only (TEXT/INTEGER/BOOLEAN/timestamps as ISO strings).

## 3. Doesn't map cleanly — flagged

- **Submit-banner count vs `isPhaseReady`** disagree in the Kotlin app (full-list vs role-filtered). Port picks one definition in `/shared/progress.ts`: readiness = full-list (the stricter, and what submission actually gates) with the role-filtered number displayed only as the user's personal filter count. *Intentional behavior difference; will log in §6.*
- **PDF export** is in the brief but not in the Kotlin app. Not ported in the parity pass; noted as post-parity backlog.
- **Email notifications** are in the Kotlin app but absent from the brief's feature list — see open question Q3.
- **JavaFX zoom (root em scaling)** maps to a CSS `rem` root-font-size control — trivial, kept.
- **NL/EN Strings object** → JSON dictionaries in `/shared/i18n` so the web app reuses them.

## 4. Open questions (blocking scaffold)

1. ORM: Drizzle + better-sqlite3 vs Prisma. *(recommend Drizzle: no engine binaries to package in Electron, SQL-first schema ports to Postgres cleanly)*
2. Desktop auth approach for v1. *(recommend porting the full local account system with bcrypt behind an `AuthProvider` interface the web version swaps for real IdP/session auth)*
3. Email notifications scope in the parity pass.
4. Demo seed data: reproduce Kotlin seeds vs start empty.
- **Deferred by design (not deciding now):** sync layer (none in v1; UUIDs keep the door open), web authentication/session model, hosted Postgres migration mechanics.

## 5. Migration order (each step ends with a parity checkpoint)

1. Scaffold (electron-vite, ESLint/Prettier, workspaces) + DB schema + phases.json import + seeds → *checkpoint: template counts 26/27/22/49/52/33/26/26/51/26; RASCI normalization report*
2. `/shared` types + business logic + **ported AccessCheck as asserting Vitest suite** → *checkpoint: all ~60 invariants green*
3. Read-only UI: login-less shell → Dashboard → CityDetail → ProjectView on seeded data
4. Auth + role-based access wiring (per Q2)
5. Approval workflow + unfinished-task flow (interactive)
6. Attachments/Drive + notifications (per Q3) + user admin incl. removal handover
7. Excel export + outbox UI + zoom/i18n polish → *checkpoint: side-by-side workbook diff vs Kotlin export*

## 6. Running log

- 2026-07-19 — Audit completed (5 readers + critic). Found & documented two Kotlin bugs (custom-row delete bypasses lock; RASCI substring match) and the existingLink junk-attachment data bug; all will be **fixed, not carried**. No persisted user data exists ⇒ no import script beyond phases.json + seeds.
- 2026-07-21 — **Step 1+2 delivered.** Scaffold (electron-vite + React + TS, ESLint/Prettier with a lint rule banning Electron/DB/React/Node imports inside `shared/`), Drizzle+better-sqlite3 schema (UUID PKs, Postgres-portable types), phases.json import (10/338 verified; 302 linkHints; RASCI histogram flags `DENISE`, `PP` for Ernest to clean), demo seed identical to Kotlin, `/shared` (8 logic modules + i18n 222×2 keys byte-identical), parity suite **45 tests green**, Electron shell boots with DB health over IPC.
  - *Ported directly:* every rule in §1.3, i18n tables, seed world, subject keys.
  - *Redesigned (documented intentional):* tokenized RASCI (owner filter maps via `roleToFilter`), full-list readiness, linkHint field, UUID ids, user-id attachment ownership, locks in logic, reset codes never returned to callers.
  - *Adversarial verification round 1:* 4 reviewers, 26 findings, 0 blockers; all 10 should-fixes fixed same-day (missing pending-submission selectors, OWNER→'all' filter mapping, displayName fallback, transactional+gated seeds, XOR-CHECK drift comment, outbox visibility selector, last-phase move guard, extra parity tests). Reviewer confirmations: schema/seed otherwise parity-faithful; i18n extraction exact; no undocumented behavioral divergence.
  - *Known friction:* better-sqlite3 dual ABI — `npm run dev` rebuilds for Electron, `npm test` rebuilds for Node (pretest hook). TODO: consider a wasm driver or Electron-run integration tests when CI lands.
  - *Deferred to later features (tracked):* email body composition + .eml/SMTP delivery (feature 6), Excel export (feature 7), `db:` scripts point at a repo-local dev DB, not the app's userData DB (dev tooling only). WEB_LINK default-name host parsing may differ from Java URI on exotic URLs (cosmetic).
- 2026-07-21 — **Step 3 delivered (read-only views).** `getWorld` snapshot query (main) → typed preload bridge → `services/api.ts` adapter (the web swap-point) → pure-prop React views: Dashboard (stats strip + city tiles with progress), CityDetail (approval-state banner, blok-grouped task list with RASCI/status/doc chips + linkHint display, projects grid with 🔒 gate), ProjectDetail (9 phase tabs with lock/state dots from shared `isPhaseUnlocked`, review-docs strip on submitted/approved phases). NL/EN toggle wired to shared i18n. Documents open via `shell.openExternal` behind an http(s)-only IPC guard.
  - *Ported directly:* view structure, blok grouping, status glyphs, banner states, gate messaging, tab dot logic.
  - *Intentional differences:* task lists render read-only (mutations arrive with auth in step 4); role filter is a view-local chip bar defaulting to 'Alle' (per-user default lands with login); zoom control deferred to the polish step.
  - *Verified:* 54 tests green (43 shared parity + 3 DB + 8 jsdom component tests covering city-gate locking, RASCI-filter narrowing, review-docs strip, navigation), tsc + eslint clean, Electron smoke launch clean (0 error lines).
- 2026-07-21 — **Step 4 delivered (auth + role-based access).** Main-process auth service over the DB (bcrypt verify/hash; decision logic from `@shared`): login with safe user DTO (grants resolved from the access tables, hash never crosses IPC), signup→PENDING with the Kotlin displayName fallback, persisted single-use reset codes with the notification recorded in the outbox tables (delivery = feature 6; dev builds print the code to the terminal, packaged builds never do), change-password. Renderer: Login view (login/signup/reset cards, per-outcome NL/EN errors), session in App, views scoped through shared access rules (Pia sees only Leiden + Pieterskwartier), RASCI filter lifted to the shell and defaulting via `roleToFilter` (owner → 'Alle'), header user chip + Goedkeurder badge + 🔑 change-password dialog + logout.
  - *Ported directly:* every auth outcome and message, access scoping, filter-default behavior, no-session-persistence-across-restarts.
  - *Redesigned:* OWNER is not offerable/acceptable as a signup role (silently downgraded to PM server-side); reset-code delivery goes through the persistent outbox tables instead of an in-memory list.
  - *Trust model note:* scoping is renderer-side over a full world snapshot — same model as the Kotlin app; real enforcement moves into the API layer with the web backend (flagged for that phase).
  - *Verified:* 62 tests green (adds 4 auth-over-DB tests incl. bcrypt round-trips + outbox recording, 4 Login component tests), tsc + eslint clean, Electron smoke clean.
- 2026-07-22 — **Step 5 delivered (interactive approvals + task mutations).** `mutations.ts` in main: set-status, mark-all (tokenized role filter, N/A skipped), submit with the unfinished-choice contract (NEEDS_CHOICE → 'na' converts, 'move' carries open tasks to the next phase prepended under WIP with positions renumbered, transactional), decide (approve/reject/withdraw/reopen) with the actor's role resolved from the DB — every guard runs against shared logic in the main process, so the Kotlin UI-only-lock bypass class is structurally closed. Renderer: interactive tri-state boxes + N/A pills (frozen when submitted/approved), Alles ✓/✗, the always-visible submit banner with the two-step dialog (move option only when a next phase exists — never cities, never Garantiefase), owner approve/reject + reopen, submitter withdraw. Mutations refetch the world snapshot.
  - *Ported directly:* the full Kotlin v0.7/v0.8 approval + unfinished-task behavior, including banner states and dialog wording.
  - *Deferred within scope:* approval notification emails record with feature 6 (email); custom-row add/delete + reorder land with feature 6/7 alongside admin mode.
  - *Verified:* 73 tests green (adds 6 mutation tests: lock enforcement incl. double-submit, WIP-move positions, city INVALID_CHOICE, owner gating, reopen unfreeze; 5 interaction component tests incl. dialog flows). One test premise was corrected against the data (all 27 Acquisitiefase tasks are OM-relevant, so the filter test uses MT with 3/27). tsc + eslint clean, Electron smoke clean.
- 2026-07-24 — **Step 6 delivered (attachments, notification delivery, user admin).** `notify.ts` in main: Kotlin-parity email composition (deliverable single + mark-all digest with attachment lines, approval requests with the phase's document list, decisions with next-phase-unlocked line, city variants) recorded in the emails tables + RFC-2047 `.eml` files, optional SMTP via nodemailer (`<userData>/tracker-data/smtp.json`), delivery status per row; caller's UI language travels over IPC. Attachment add/remove mutations behind the same main-process lock guards (`prepareAttachment` from shared). `admin.ts`: signup approve/reject, role changes (owner can't demote self), access-all + per-city grants, remove-with-handover reporting the moved-document count — all actor-gated owner-only against the DB. Renderer: attach dialog + removable doc chips per task row, Outbox view (expandable bodies, open-.eml-folder), Admin view (status chips, role select, access chips, remove dialog with Ernest defaulted), dashboard owner queue rows.
  - *Redesigned (flagged in chat, easy to revert):* owners do NOT see other users' password-reset emails in the outbox (fixes audited leak §1.7.8 rather than porting it — test-proven); the Kotlin ApprovalsView screen is consolidated into the dashboard queue + on-page approval banners; pending signups live in the Admin view.
  - *Verified:* **81 tests green** (adds 5 notification-recording tests incl. digest-once semantics, recipients per event, city wording, `.eml` on disk, outbox visibility; 3 admin tests incl. owner gating and the 3-document handover), tsc + eslint clean, Electron smoke clean. One test expectation corrected to the shared guard order (owner-removal returns IS_OWNER before IS_SELF, matching Kotlin).
  - *Environment note:* a macOS Files-and-Folders permission revocation for the Claude app interrupted verification mid-step (all project files EPERM); restored by re-granting Desktop access + app restart. No data lost.
- 2026-07-24 — **Step 7 delivered (Excel export + zoom + packaging) — MIGRATION COMPLETE.** `export.ts` (exceljs) reproduces the Kotlin workbook: Overview sheet, one sheet per city, one per project phase (project/phase/status lines), the 11-column task table with the Documents column, bold-white-on-`#000080` headers, audited widths, sanitized-unique ≤31-char tab names; native save dialog via `export:excel` IPC; export button on the Dashboard stats strip. Zoom control in the header (🔍 − % +, 90–150%, rem-based root scaling — Kotlin v0.9 parity). `electron-builder.yml` + `npm run dist` added (packaging not yet exercised — first run should verify the better-sqlite3 rebuild and the `app.isPackaged` seed gate).
  - *Workbook parity method:* structural verification against the audited Kotlin layout (audit/services-integrations.md §4) via an ExcelJS read-back test, not a byte-level diff of a Kotlin-generated file (the Kotlin export requires a GUI click to produce).
  - *Verified:* **82 tests green** (adds the export read-back test: 31 sheets, headers/status text/Documents column/widths/name-uniqueness), tsc + eslint clean, Electron smoke clean.

- 2026-07-28 — **Exports P1+P2 delivered (post-parity feature).** Excel rewritten to match the ORIGINAL source workbook (not the Kotlin layout): per-sheet measured column widths/`opm` header/spacer rules (`SHEET_LAYOUTS`, measured with openpyxl), blok-separator blank rows, Dutch headers, Calibri 11, status row-tints + live links in the original's own D column; scope picker exports one project as a workbook with the original's exact sheet names or the whole portfolio (tab names keep phase identity when truncating). **Fidelity: 6/10 sheets row-for-row identical to the source incl. blank positions; the 4 others differ only where the source's own blanks are irregular — flagged for the team formatting round.** PDF export: print-designed HTML (brand band, status pills, progress bars, per-phase page breaks, escaped content, https-only links) rendered via offscreen `printToPDF`; verified end-to-end headlessly (`--pdf-smoke` → 770 KB PDF). Adversarial verification round: 21 findings, 1 blocker (apostrophe project names crash ExcelJS — fixed + regression test), all 9 should-fixes fixed (incl. missing `cancel`/`confirm` i18n keys, mixed-language PDF headers, launcher hardening). 87 tests green; gates clean.
  - *Environment:* this checkout's iCloud-synced location SIGKILLs executables in-tree (broke Electron mid-week). `npm run dev` now routes through `scripts/dev-launch.cjs`, which maintains an ad-hoc-signed Electron copy in `~/Library/Caches/1828-electron` via `ELECTRON_OVERRIDE_DIST_PATH` (no HMR on this machine). **Recommended: move the project off the synced Desktop.**

- 2026-07-28 — **Packaging validated (§7 item 1) + admin-mode parity port + i18n zero-dead.**
  - *Packaging*: `npm run dist` produces a working DMG. Verified on a clean userData:
    better-sqlite3 loads inside the package, renderer boots to the login screen,
    the `app.isPackaged` seed gate keeps demo data out, `SEED_DEMO=1` seeds the
    demo world (3 users/3 cities/3 projects), outbox lands under
    `<userData>/tracker-data/outbox`. **Two build fixes:** electron-builder
    skips signing without a Developer ID, which leaves the bundle's seal invalid
    → Apple-silicon macOS SIGKILLs it at exec; `scripts/after-pack-sign.cjs`
    now applies a deep ad-hoc signature (with an `xattr -cr` sweep first — the
    iCloud checkout stamps Finder xattrs onto the packed bundle). Output moved
    to `dist.nosync/`. **Machine findings:** (a) iCloud FileProvider re-stamps
    `com.apple.FinderInfo`/`fpfs#P` onto bundle roots even post-build, so
    `codesign --verify --strict` can fail on this machine while binaries stay
    valid — the DMG launches; build on a clean machine/CI for distribution.
    (b) Norton (com.norton.mes) SIGKILLs *any* freshly-written executable in
    high-risk paths (/tmp) and deletes flagged apps from `~/Library/Caches` —
    this, not iCloud alone, is likely the historical "Electron broke" culprit.
    (c) Dev and packaged builds share `~/Library/Application Support/fasedocument-tracker`
    (userData comes from package.json `name`) — fine in production, confusing in tests.
  - *Admin-mode parity port* (gap found by the i18n dead-key scan — step 5 had
    deferred these to "feature 6/7" and the completion log missed them): owner
    admin toggle + gold badge in the header, `+ Stad` (owner, dashboard),
    `+ Project` (any user with city access — Kotlin parity), custom rows
    (add at blok bottom, empty RASCI, `eigen` tag, delete with confirm), blok
    ▲/▼ + task ▲/▼ reorder (Kotlin semantics incl. merge-on-move and
    unfiltered-neighbour boundaries). All guards run in the main process
    (`structure` mutations); **the Kotlin delete-custom-row lock bypass
    (TaskRow.kt:124) is fixed, not ported** — test-proven. Also closed smaller
    gaps: signup role labels (rolePM…roleMT), attach-URL validation
    (`attachInvalidUrl`), dashboard empty states (noCities/noAccessibleCities),
    `statLink` stat tile, recent-notifications feed + `viewAll`, outbox `Van:`
    line, doc-chip kind tooltips, `cannotRemoveOwner` alert.
  - *i18n*: pruned 19 keys dead in both apps + 10 dead-by-redesign
    (ApprovalsView consolidation, React navigation) → **209 keys, 0 unreferenced**.
  - *Verified (at 28 Jul close)*: 96 tests green (adds 9 structure-mutation
    tests: create city/project incl. access + global-uniqueness, custom-row
    placement + lock enforcement, blok/task reorder + boundaries), tsc +
    eslint clean.

- 2026-08-05 — **Adversarial review round 4 + fixes (admin-mode hardening).**
  - *Round 4* (3 lenses + per-finding refutation, 13 agents): 10 findings,
    7 confirmed, 3 refuted. All confirmed issues fixed same-day:
    **(blocker)** `window.prompt` throws in Electron — the three add-buttons
    crashed at click; replaced with a `NamePromptDialog` modal (Kotlin
    TextInputDialog parity, blank-confirm aborts). **(blocker)** `addCustomRow`
    assumed dense positions while `deleteCustomRow` and the WIP move left gaps
    — rows landed away from their blok bottom, ties made `moveTask` a silent
    no-op; inserts now renumber densely, delete + WIP-move compact
    (`compactPositions`). **(should-fix)** the phase-unlock/city-gate ran only
    in the renderer — crafted IPC could edit or even submit gated phases;
    `isRefGated` now enforces `isPhaseUnlocked` in every main-process edit and
    submit path (decisions keep their own transition rules). **(should-fix)**
    create-city/project navigated before the world refetch, flashing the
    not-found page — navigation now awaits the refreshed snapshot.
    **(should-fix)** the pending-approvals stat tile is owner-only again
    (Kotlin parity). Refuted (documented-by-design): actorUserId-on-the-wire
    trust model, unreachable runMutation rejection path, project-grant users
    seeing `+ Project`.
  - *Verified*: **101 tests green** (9 structure-mutation tests + 5 extras:
    contiguous positions after insert, attachment cascade on delete, dense
    source phase after WIP-move repro, duplicate-slot repro, gated-phase
    enforcement incl. unlock-after-approve), tsc + eslint clean, production
    bundle builds.

- 2026-08-09 — **Web app v1 (§7 web item) — same renderer, new trust boundary.**
  - *Architecture*: `web/` = Express server reusing the Electron-free main-process
    modules verbatim (db/mutations/auth/admin/notify/export — only `index.ts`
    and `pdf.ts` import Electron). The renderer is byte-identical: `services/api.ts`
    now branches — preload bridge present → IPC (desktop unchanged), absent →
    fetch against `/api` (`isWeb` drives web-only UI: hidden .eml-folder/PDF
    buttons, session restore, platform badge).
  - *Trust model shift (the point of the exercise)*: the ACTOR IS THE SESSION
    USER — actorUserId on the wire is ignored everywhere; HttpOnly SameSite=Lax
    cookie sessions (in-memory store v1, sliding 7-day TTL); every mutating
    route resolves its target to a ListRef and enforces city/project access
    server-side (`web/access.ts`) before the shared guards run; `/api/world` is
    pre-scoped per user; portfolio Excel export is owner-only, per-project
    export requires access to that project.
  - *Run*: `npm run web:build` once, then `npm run web:server:demo` (seeds demo
    world, data in `~/.1828-tracker-web`, port 8028). Dev loop: `web:server` +
    `web:dev` (vite on :5173 proxying /api).
  - *Verified*: **108 tests green** (7 new web API tests: 401 wall, per-user
    world scoping, cross-city mutation denial, wire-actor ignored, owner gates,
    export scoping, logout kills the session) + live browser pass: login →
    dashboard → city → task toggle (POST /api/task/status → world refetch) →
    reload keeps the session. tsc + eslint clean, desktop suite untouched.
  - *Not yet (tracked in §7)*: PDF export on web (needs a headless-Chromium
    route), persistent session store, HTTPS/deployment story, in-app desktop
    download page, monthly desktop/web alignment routine.
  - *Adversarial review round 5* (2 lenses + refutation, 10 agents): 8 findings,
    7 confirmed, 1 refuted — all fixed same-day. **(blocker)** expired-session
    401s were unhandled — after a server restart every mutation became a silent
    no-op; the adapter now throws a typed `SessionExpiredError` and App has a
    global rejection handler (alert once → back to login), verified live by
    destroying the session under an open tab and clicking a task. **(should-fix)**
    web Excel export fabricated success and opened raw-JSON tabs on refusal —
    now fetches a blob, surfaces server errors as results, and the portfolio
    scope option is hidden for non-owners on web; the export route no longer
    echoes exception internals (fixed `EXPORT_FAILED` enum, detail logged
    server-side). Also: session-restore no longer resets the role filter when a
    user logged in during the race; Outbox handles a rejected fetch; web
    `openExternal` gained the same http(s)-only scheme guard as desktop main.
    **(nit, follow-up)** login/reset-request outcomes allow account enumeration
    by anonymous callers (desktop-parity behavior newly exposed over HTTP) —
    normalize responses + rate-limit at deployment time.

- 2026-08-10 — **Live-test readiness batch (everything engineering-side before
  client testing; client still owes: hosting choice, domain, SMTP account).**
  - *drizzle-kit migrations adopted (§7 item)*: drizzle-orm 0.33→0.38 +
    drizzle-kit 0.24→0.30 (zero code changes needed), `drizzle/` with
    0000_baseline + 0001 (sessions table + the tasks XOR CHECK now living in
    schema.ts). `openDb` runs `migrate()`; pre-migration databases are detected
    (tables but no journal) and get the baseline stamped as applied, then
    continue normally — test-proven with a raw-DDL fixture incl. data survival
    through the tasks rebuild and idempotent reopen. Packaged app ships
    `drizzle/**` in the asar.
  - *Owner bootstrap*: fresh installs had NO way to mint the first OWNER
    (signup is PENDING + never owner; approval needs an owner) —
    `bootstrapOwner(db)` reads `BOOTSTRAP_OWNER_EMAIL/PASSWORD[/NAME]` and
    creates one ACTIVE owner iff the users table is empty; wired into web and
    desktop startup, warns loudly when empty with no env.
  - *Persistent sessions*: web/sessions.ts is DB-backed (sessions table,
    sliding 7-day TTL with hourly write-throttle, lazy pruning) — deploys and
    restarts keep users signed in; logout still kills server-side.
  - *Auth hardening*: per-IP sliding-window rate limit on login/signup/
    reset-request/reset-complete (`AUTH_RATE_LIMIT`/5 min, 429 RATE_LIMITED);
    the round-5 enumeration nit closed on the web: unknown email answers
    BAD_PASSWORD, reset-request always returns true.
  - *Ops kit*: `scripts/backup-db.cjs` (online backup API, keeps 30, verified
    against the local web DB); `deploy/` = Caddyfile (auto-HTTPS), hardened
    systemd unit, env template, step-by-step DEPLOY.md, and
    TESTING_CHECKLIST.md for the pre-client smoke pass.
  - *Verified*: **116 tests green** (adds 3 migration-adoption + 5
    production-readiness: bootstrap create/idempotence/never-on-populated-DB,
    session survives an app restart, 429 after limit, no-oracle responses),
    tsc + eslint clean, both bundles build.

- 2026-08-10 — **Adversarial review round 6 (readiness batch): 11 findings, 10
  confirmed, 1 refuted — all fixed same-day.** The round earned its keep:
  **(blocker)** the 0001 tasks rebuild silently wiped EVERY attachment on legacy
  databases — drizzle's migrator runs the batch in one transaction where SQLite
  ignores `PRAGMA foreign_keys`, so `DROP TABLE tasks` fired the attachments
  cascade with FKs still ON (empirically reproduced by two independent
  verifiers). Fix: `openDb` turns FKs off around `migrate()` (outside any
  transaction, where the pragma works) and runs `PRAGMA foreign_key_check`
  afterwards, failing loudly on real orphans; the legacy test fixture now
  carries attachments on a city task AND a phase task as the regression guard.
  **(should-fix)** `stampBaseline` was two autocommit statements — a crash
  between them left an empty journal that bricked every later boot (baseline
  replay into existing tables); now a single IMMEDIATE transaction, and
  `isLegacyDb` treats an empty journal beside real tables as legacy
  (crash recovery, test-proven). **(should-fix)** behind Caddy `req.ip` was
  always 127.0.0.1 — the per-IP rate limit was one shared bucket (anyone could
  lock everyone out); `trust proxy: 'loopback'` fixes it. Also: the server now
  binds 127.0.0.1 by default (HOST to override), reset-complete no longer
  distinguishes unknown emails (BAD_CODE), login burns equal bcrypt work for
  unknown emails (timing oracle), stale schema comment removed, legacy fixture
  gained the i_col/opm columns real installs have, and `busy_timeout=5000`
  softens concurrent-open races. Accepted residuals (documented): signup still
  reports "account exists" (needed UX; rate-limited), PENDING/REJECTED login
  outcomes stay distinguishable (real accounts must see them).
  - *Verified*: **117 tests green** (adds the crashed-stamp recovery test;
    attachment-survival assertions), tsc + eslint clean, both bundles build.

- 2026-08-12 — **Ernest's review screen + export completeness (client feedback:
  "exactly the screen I was mentioning").**
  - *Data*: tasks gained `moved_from_phase_id` (migration 0002, plain ALTER) —
    set by submit-with-move, so moved WIP rows remember the phase they left.
    Latest move wins: a row moved again later points at its most recent origin
    (the earlier phase's review drops it — accepted, single-level history).
  - *Review screen*: on a submitted or approved list the locked task list (and
    the old review-docs strip) is replaced by `ReviewPanel` — row by row,
    blok-grouped: completed rows green with their documents clickable, N.v.t.
    rows greyed/struck, and a "Verplaatst naar volgende fase (WIP)" section at
    the bottom with struck-through rows whose documents travelled along.
    Reached exactly the way Ernest works: dashboard approval queue → Open
    project → approve/reject sits directly above the rows. Desktop + web (same
    renderer). New i18n keys: reviewDone/reviewNa/reviewOpen/reviewMoved/
    exportLegendMoved (NL+EN, 214 keys, still zero dead).
  - *Exports*: both formats already carried every row + attachments; what was
    missing was the moved rows (they only appeared in the NEXT phase under WIP,
    unmarked) and an explicit N.v.t. treatment. Excel: N.v.t. rows now struck
    grey (theme knob), each phase sheet ends with a struck-through moved-out
    section, Overzicht legend explains it. PDF: moved rows render struck at the
    bottom of their origin phase's table with a "moved" pill and their document
    links.
  - *Verified*: **122 tests green** (review/export end-to-end suite: provenance
    + docs travel with moved rows, ExcelJS read-back finds the moved section +
    strike fonts + legend, PDF html carries the moved markers; ReviewPanel
    component tests; migration-count updates), tsc + eslint clean, both bundles
    build. Live check on the web app against the real pre-migration DB (which
    took the legacy-adoption path in production conditions): submit-with-move →
    dashboard queue → review screen shows green/N.v.t./moved correctly, and the
    downloaded Excel contains the moved section, legend and document links.

- 2026-08-13 — **Client feedback round 2: file uploads, add-row for everyone,
  WIP governed by the approval flow.**
  - *File attachment from the computer* (Ernest: "like an email attachment"):
    new FILE_UPLOAD attachment kind; bytes live in `<dataDir>/files/<attachmentId>`
    (`desktop/main/files.ts`, shared by both targets, 25 MB cap). Desktop:
    native open-dialog via IPC, opens with the OS default app. Web: raw-body
    upload route (no multipart dependency) + access-checked download at
    `/api/files/:id`; anonymous → 401, no access → 403. Removing the
    attachment deletes the file. Exports/emails render uploads by name
    ("(bijlage)") — never the internal upload:// url. The attach dialog offers
    both paths: file from computer, or Drive-link paste as before.
  - *Add row for all users* (Ernest was explicit): `addCustomRow` no longer
    owner-gated — any ACTIVE user with list access may add rows (lock + phase
    gate + server-side access still enforced). "+ Regel toevoegen" now shows
    for everyone on unlocked lists; reorder and delete-custom stay admin-mode.
  - *WIP through the approval flow* (was: moved rows went to the next phase
    silently and stayed there even on reject): migration 0003 stores the moved
    row's original step/blok/position; **reject or withdraw now pulls moved
    rows back** to their origin with those fields restored (both lists
    re-compacted); only an APPROVED submission lets them stay. WIP rows in the
    next phase carry a visible WIP badge. Rows moved before this deploy lack
    stored origins and fall back to a WIP group at the origin on pull-back
    (pre-0003 data only, verified live against the dev web DB).
  - *Verified*: **124 tests green** (WIP lifecycle: reject returns rows with
    original step/blok + dense positions, approve keeps them; HTTP upload →
    world kind/name → byte-exact download → 401 anonymous → file deleted on
    remove; add-row open to any active user), tsc + eslint clean, both bundles
    build. Live browser pass as Pia (PM, no admin): add-row buttons on every
    blok, attach dialog with the file button, reject pull-back on the real DB.

- 2026-08-13 — **Google Drive export (client ask: "export completed project to
  Drive").** `desktop/main/drive-export.ts`: zero-dependency OAuth
  (authorization-code; web redirect + desktop loopback via the system browser)
  and Drive v3 multipart upload with the least-privilege `drive.file` scope.
  Credential-gated like SMTP: `<dataDir>/google-oauth.json` (client id/secret
  from Ernest's Workspace — DEPLOY.md §7b) flips the feature from invisible to
  connectable; the refresh token lives in `google-drive-token.json` (delete =
  disconnect). Owner-only end to end (web routes 403 non-owners; files land in
  the connected account's "1828 Fasedocument Tracker" folder, named
  "<project> — fasedocument <date>.xlsx"; the app opens the returned
  webViewLink). Export dialog shows connect/export buttons by live status;
  per-project scope only. *Verified*: **128 tests green** (mocked-Google unit
  suite: status walk, one-shot anti-CSRF state, connect, folder find-or-create
  + multipart upload with link, NOT_CONNECTED path; route tests: status for
  all, connect/export owner-gated, unconfigured → 400/NOT_CONNECTED), tsc +
  eslint clean, both bundles build. Activates the moment the client's OAuth
  file lands — no code changes needed then.

## 7. Post-parity follow-ups (for the web phase or hardening)

- drizzle-kit migrations when real user data exists; move the tasks XOR CHECK into schema.ts after upgrading drizzle ≥0.36 (comment in schema.ts).
- Web version: swap `services/api.ts` for fetch, `/shared` unchanged; move access enforcement server-side; real session auth.
- Consider a wasm SQLite driver or Electron-run integration tests to end the dual-ABI rebuild dance.
- Ask Ernest for the final WIP headline title (`WIP_STEP` in shared/business-logic/unfinished.ts) and RASCI cleanup of `DENISE`/`PP` in the source workbook.
- Distribution signing: a real Developer ID (+ notarization) once the client wants to hand the DMG around; until then recipients right-click-open the ad-hoc build.
