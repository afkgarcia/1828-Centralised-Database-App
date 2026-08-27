# 1828 Fasedocument Tracker — desktop (Kotlin + JavaFX)

Standalone desktop app for the 1828 phase-document workflow.

## Stack
- **Kotlin 1.9** on JVM 17
- **JavaFX 21** (Controls) via the OpenJFX Gradle plugin
- **Apache POI 5** for `.xlsx` export
- **kotlinx.serialization** for loading `phases.json`
- **Gradle Kotlin DSL** with the foojay-resolver-convention so Gradle
  auto-downloads the right JDK toolchain

## Run

```bash
./gradlew run                # launches the desktop app
./gradlew accessCheck        # headless logic sanity-check (no UI)
./gradlew installDist        # exploded dist under build/install/
./gradlew distZip            # zipped distribution
```

## Demo accounts (seeded in-memory)

| Email | Password | Role | Access |
|---|---|---|---|
| `ernest@1828.nl` | `ernest` | OWNER | All cities, all projects, sole approver |
| `pia@1828.nl` | `test` | PM (active) | Leiden only |
| `niels@1828.nl` | `test` | OM (PENDING) | Login blocked until Ernest approves |

New users self-register via the "Account aanvragen" link on the login screen;
they sit at `Pending` until Ernest (or any OWNER) approves them from the
Goedkeuringen inbox or the Gebruikers admin page.

## Application architecture

```
src/main/kotlin/app/
├── Main.kt                  # JavaFX entry; seeds demo cities + projects
├── auth/AuthService.kt      # in-memory accounts: login/signup/approve/reject
├── notify/
│   ├── EmailService.kt      # outbox + .eml files + optional SMTP delivery
│   └── Notifications.kt     # event composers + recipient resolution
├── data/PhaseData.kt        # loads phases.json from resources
├── model/
│   ├── Models.kt            # Task/City/Phase/Project (+ parentCity) + TaskStatus
│   └── User.kt              # User, UserRole, UserStatus
├── state/AppState.kt        # singleton with currentUser, View, access checks
├── export/ExcelExport.kt    # Apache POI workbook writer
└── ui/
    ├── Strings.kt           # NL/EN string tables + active language
    ├── HeaderBar.kt         # user chip, logout, dashboard/approvals/admin nav
    ├── LoginView.kt         # login + inline signup card
    ├── OutboxView.kt        # sent notifications (expandable bodies)
    ├── DashboardView.kt     # stats strip, approval queue, city grid, activity feed
    ├── CityDetailView.kt    # city's Gemeenteontwikkeling + projects grid
    ├── ProjectView.kt       # phase tabs + approval banner + task list
    ├── ApprovalsView.kt     # owner inbox: phase submissions + signups
    ├── UserAdminView.kt     # owner: role + per-city access toggles
    ├── TaskListView.kt      # blok grouping, role filter, mark-all
    ├── TaskRow.kt           # tri-state row + custom row delete
    └── ExportPanel.kt       # stats + save-dialog Excel export

src/main/resources/
├── phases.json              # extracted from the Excel phase document
└── app.css                  # JavaFX stylesheet

src/test/kotlin/app/
└── AccessCheck.kt           # runnable end-to-end auth/access check
```

## Feature coverage

- **Login / signup** — replaces the previous role-picker setup screen.
  Login validates against `AuthService`; pending and rejected accounts get
  specific error messages. Signup captures name + email + password +
  requested role; the account stays `Pending` until an owner approves.
- **Role-based views** — `AppState.canAccessCity()` / `canAccessProject()`
  drive both the dashboard grid and the per-city projects grid. Owners see
  everything; PMs/colleagues see only the cities and projects in their
  access grants.
- **Dashboard (Drive-style)** — `Dashboard` shows a tile per accessible
  city with project count + Gemeenteontwikkeling progress. Clicking a
  city opens `CityDetail`: the city's ongoing Gemeenteontwikkeling task
  list followed by a grid of project tiles. Clicking a project tile opens
  the project phase view.
- **Approval flow** — any team member with project access can submit a
  ready phase. Only the owner sees the approve/reject controls and the
  Approvals inbox. Phases stay locked until the previous phase is
  formally approved by the owner (`isPhaseUnlocked` checks
  `phases[i-1].approved`).
- **Three-state tasks**, **custom rows**, **NL/EN toggle**, **Excel
  export** — preserved from the v0.2 prototype.

## Email notifications (v0.4)

Automatic emails fire on three workflow events:

| Event | Trigger | Recipients |
|---|---|---|
| Deliverable submitted | Task checked off (mark-all sends one digest) | Active owners |
| Approval requested | "Indienen ter goedkeuring" on a completed phase | Active owners |
| Phase approved / rejected | Owner decision (banner or Approvals inbox) | Active project team members |

Every email always lands in two places, no configuration needed:

1. **In-app outbox** — ✉ Meldingen in the header. Owners see all mail;
   colleagues only see mail addressed to them. Click a row to expand the body.
2. **`.eml` files** — `~/.1828-tracker/outbox/` (double-click to open in
   Mail/Outlook). The outbox view has an "Open e-mailmap" button.

Real SMTP delivery activates when `~/.1828-tracker/smtp.properties` exists:

```properties
enabled=true
host=smtp.office365.com
port=587
username=tracker@1828.nl
password=<secret>
from=tracker@1828.nl
starttls=true
```

Delivery status per message (`outbox`, `SMTP ✓`, `SMTP ✗ …`) is shown in the
outbox row. Sending happens on a daemon thread so the UI never blocks.

The dashboard now opens with a stats strip (cities / projects / open tasks /
awaiting approval), the owner's approval queue, and a recent-notifications
feed that links to the outbox.

## Google Drive integration (v0.5)

Supporting documents are linked directly to their task, so everything a
reviewer needs is one click away:

- **Document chips per task** — the free-text link field is replaced by
  attachment chips. Each chip shows a type icon + name; clicking opens the
  document in the system browser. `+ 📎 Document` opens a dialog that takes a
  Google Drive link (or any URL) and an optional name.
- **Drive type detection** — Docs, Sheets, Slides, Forms, Drive folders and
  files are recognised from the URL and get matching icons (📄 📊 📽 📝 📁 🗂);
  anything else becomes a generic 🔗 link named after its host.
- **Review surfaces** — once a phase is submitted, a "📎 Documenten voor
  review" strip lists every document in the phase, and the owner's Approvals
  inbox shows the same chips on each pending row. Locked phases keep chips
  clickable (review needs access) but block add/remove.
- **Everywhere else** — approval-request emails list all phase documents
  (name + URL), deliverable digests list each task's attachments, the Excel
  export writes a Documents column, and links already present in the phase
  document are migrated to attachments automatically.

Real OAuth-based Drive browsing (picking files from a Drive account instead
of pasting links) is a follow-up once the client provides a Google Cloud
project; the `Attachment`/`DriveKind` model is ready for it.

## Password reset & user removal (v0.6)

**Self-service password reset** — "Wachtwoord vergeten?" on the login screen
asks for the account email, generates a 6-digit code and emails it through the
regular notification pipeline (outbox + `.eml`; real SMTP when configured —
the reset card has an "Open e-mailmap" button for the demo). Entering the code
plus a new password completes the reset; codes are single-use. Signed-in users
change their password any time via the 🔑 button in the header (current
password required).

**Admin remove-user with document handover** — in Gebruikers, every non-owner
account (except yourself) gets a "Verwijderen" button. A dialog picks who
takes over — any active user, with Ernest (owner) as the default — then every
document the removed user had linked is reassigned to the replacement before
the account is deleted, so nothing dangles. The owner can never be removed.
The confirmation reports how many documents were handed over.

## Unfinished-task handling on submit (v0.7)

"Indienen ter goedkeuring" is now **always visible** on an active phase — the
banner switches between amber ("everything done") and neutral slate showing
the open-task count. Submitting with open tasks walks through two prompts:

1. *"Er zijn nog onafgeronde taken (n) — wil je toch indienen?"* — cancel or
   proceed.
2. *"Wat moet er gebeuren met de n open taken?"* — **Markeer als n.v.t.**
   (marks them not-applicable, keeping the progress math honest) or
   **Verplaats naar volgende fase (WIP)**.

Moved tasks land at the **top of the next phase under a "WIP" headline**
(placeholder title — final wording pending from Ernest), keeping their
status, RASCI tags and attached documents. The move option is hidden on the
last phase (Garantiefase). After either choice the phase submits and the
owner-approval flow proceeds as usual.

## Phase-document verification & city gate (v0.8)

**Re-verified against the source documents.** All 338 task rows in
`phases.json` match Ernest's definitive spreadsheet (260320 fasedocument
Vdef) exactly — sheet order, step numbers, blok names, deliverables and
RASCI columns; zero mismatches. The step numbering confirms the intended
order: Gemeenteontwikkeling is steps **1.1–1.3** and the Acquisitiefase
continues **1.4–1.12** in the same sequence.

**Gemeenteontwikkeling now gates the Acquisitiefase.** It is completed once
per city, and no project in that city can start until it is done:

- The city page has the same lifecycle as a phase: always-visible
  **"Indienen ter goedkeuring"** (with the unfinished-task prompt; N/A-only —
  there is no next phase to move to), then owner approve/reject, with the
  task list frozen while in review and a reopen option for the owner.
- **Phase 1 of every project stays locked** until its parent city is
  approved, with an explicit explanation on the locked phase and 🔒 icons +
  tooltips on the project tiles.
- City submissions appear in the owner's **Approvals inbox** (listed above
  phase submissions — they gate everything else), in the dashboard approval
  queue, and in the header badge. Request/approve/reject emails go out like
  any other approval.
- Demo seed: **Leiden is pre-approved** (its project Pieterskwartier is
  workable); Amsterdam and Utrecht are not — their projects demonstrate the
  gate.

## Readability, polish & text zoom (v0.9)

**Contrast bugs fixed.** Header buttons rendered navy-on-navy (invisible) and
the gold badges rendered white-on-gold due to a stylesheet specificity clash —
both root causes of "text the same colour as the background." Locked phase
tabs also stacked two opacity fades (≈18% visible); they now use a single
legible fade.

**Docs-familiar design language.** The stylesheet was rewritten on Google
Workspace neutrals (ink `#202124`, secondary `#5F6368`, ground `#F8F9FA`,
borders `#DADCE0`) under the existing 1828 brand anchors (navy app bar +
primary buttons, teal progress, cyan cities, gold admin). Controls follow
Docs conventions: filled primary / quiet outlined secondary buttons, pill
chips, subtle hover states, one consistent radius scale. Small-text contrast
was raised throughout and ~80 lines of dead CSS from removed views deleted.

**Text zoom (magnifier).** Every font size in the stylesheet is em-based off
a 13px root, so the 🔍 − 100% + control in the header scales the entire UI
(90–150%). Click the percentage to reset. The control also works on the
login screen, and the tri-state checkboxes scale with the text.

## Limitations / next steps

- State is in-memory only. Persistence (JSON-on-disk per user, or a real
  backend) is the next major piece.
- Password storage is SHA-256 without salting. Suitable for a prototype
  only; replace with a proper KDF before any production use.
- Owner reset / password recovery flows are out of scope here.
- The per-task RASCI filter (R/A/S/C chips) defaults to the user's role
  but remains user-selectable. Owners default to "All".
