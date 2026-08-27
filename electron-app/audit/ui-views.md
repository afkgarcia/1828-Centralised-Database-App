# UI Audit — 1828 Fasedocument Tracker desktop app (Kotlin/JavaFX, v0.9)

Scope: every file in `/Users/alessandrogarcia/Desktop/GarciaGaspar/1828/desktop-app/src/main/kotlin/app/ui/`, cross-read against `app/state/AppState.kt`, `app/Main.kt`, `app/auth/AuthService.kt`, `app/model/*.kt`, `app/notify/*` signatures, and `src/main/resources/app.css`.

---

## 0. Rendering & navigation model (context for everything below)

- **Entry point** (`app/Main.kt`, `class FasedocumentTrackerApp : Application`): builds a `StackPane` root, loads the single stylesheet `app.css`, injects `hostServices` into `WebOpen.host`, seeds demo data (cities Leiden/Amsterdam/Utrecht; projects Pieterskwartier/Sloterdijk Noord/Utrecht Oost; 4 demo attachments; Leiden's city tasks all `DONE` + `approved = true`).
- **The `mount` closure** is the entire render loop: `root.children.clear()`, sets inline root style `-fx-font-size: ${13.0 * AppState.zoomFactor}px` (formatted with `Locale.ROOT`), sets `stage.title = Strings.t("appTitle")`, then mounts `LoginView.build()` if `AppState.currentUser == null` else `MainView.build()`. Registered once via `AppState.onChange(mount)` and invoked immediately.
- **`AppState.notifyChanged()`** (called at the end of essentially every event handler) runs all listeners → **the whole scene graph is thrown away and rebuilt from scratch on every state change**. There is no diffing, no per-node binding (except a handful of local toggles like the Outbox mail-body expander, which survive only until the next `notifyChanged`).
- **Navigation** = `sealed class View` in `app/state/AppState.kt`:
  | Variant | Payload | Screen |
  |---|---|---|
  | `View.Dashboard` | `object` | `DashboardView` |
  | `View.CityDetail` | `data class (val name: String)` | `CityDetailView` |
  | `View.ProjectView` | `data class (val projectName: String, var phaseIdx: Int = 0)` — note **mutable** `phaseIdx` | `ProjectView` |
  | `View.Approvals` | `object` | `ApprovalsView` (owner-only) |
  | `View.UserAdmin` | `object` | `UserAdminView` (owner-only) |
  | `View.Outbox` | `object` | `OutboxView` |
  Navigating = assigning `AppState.view = …; AppState.notifyChanged()`. There is **no history stack**; "Back" is computed structurally (see HeaderBar). Views are keyed by **name strings**, not ids.
- **AppState fields the UI reads/writes** (all on `object AppState`, all mutable): `currentUser: User?`, `role: String` (RASCI filter chip, `"all"`/`"OM"`/`"PO"`/`"PM"`/`"PPM"`/`"MT"`), `adminMode: Boolean`, `zoomFactor: Double`, `view: View`, `cityOrder: MutableList<String>`, `cities: MutableMap<String, City>`, `projectOrder: MutableList<String>`, `projects: MutableMap<String, Project>`.
- **AppState functions used by the UI** (exact semantics):
  - `login(user)` — sets `currentUser`, `role = user.rasciFilterKey()` (OWNER→`"all"`), `adminMode = false`, `view = Dashboard`.
  - `logout()` — nulls user, `role = "all"`, `adminMode = false`, `view = Dashboard`.
  - `addCity(name): Boolean` — false on duplicate key; instantiates tasks from `PhaseData.cityPhase` template (ids `city_<name>_b_<i>`), appends to `cityOrder`.
  - `addProject(name, parentCity): Boolean` — false on duplicate or unknown city; builds all phases from `PhaseData.projectPhases` (ids `proj_<name>_p<pi>_b_<ti>`).
  - `isOwner()` = `currentUser?.role == UserRole.OWNER`; `isApprover()` = `isOwner()` (**MT is NOT an approver despite UI copy — see §3**).
  - `canAccessCity/userCanAccessCity` — true if `accessAllCities` or OWNER, or name in `cityAccess`, or user has `projectAccess` to any project under the city.
  - `canAccessProject/userCanAccessProject` — true if `accessAllCities`/OWNER, or `parentCity in cityAccess`, or name in `projectAccess`.
  - `openTaskCount(): Int` — OPEN tasks across accessible cities + accessible projects' phases, **after RASCI filter** (`relevantTasks`).
  - `accessibleCities(): List<String>`, `projectsForCity(cityName): List<Project>` (order-preserving, access-filtered).
  - `relevantTasks(tasks)` — identity if `role == "all"`, else tasks where any of `r/a/s/c` **contains** the role substring.
  - `progressOf(tasks): Double` — done/applicable over filtered tasks, N/A removed from denominator; returns **1.0 when applicable is empty**.
  - `isPhaseUnlocked(projectName, phaseIdx)` — phase 0 requires `cities[parentCity].approved == true` (the "city gate"); phase i>0 requires `phases[i-1].approved`.
  - `pendingCitySubmissions(): List<City>` — `submitted && !approved`, in `cityOrder`.
  - `pendingPhaseSubmissions(): List<Triple<Project, Int, Phase>>` — every `submitted && !approved` phase in `projectOrder`.
  - `isPhaseReady(phase)` — filtered tasks non-empty and none OPEN.
  - `markOpenTasksNa(projectName, phaseIdx): Int` — sets every OPEN task to NA, returns count.
  - `moveOpenTasksToNextPhase(projectName, phaseIdx): Int` — removes OPEN tasks, sets `step = WIP_STEP` (`"WIP"` const) and `blok = ""`, **prepends** (`addAll(0, …)`) to next phase's task list; statuses/RASCI/attachments travel; returns 0 on last phase.
  - `reassignAttachments(fromDisplayName, toDisplayName): Int` — rewrites `attachment.addedBy` across all city + project tasks (matching by **display name**, not email).
  - `ZOOM_LEVELS = listOf(0.9, 1.0, 1.15, 1.3, 1.5)` (val), `zoomIn()`/`zoomOut()` step through discrete levels with a ±0.001 epsilon.
- **Model mutability** (all plain classes, mutated in place by UI handlers): `Task(id: val String, step/blok/deliverable/r/a/s/c/iCol/opm: var String, status: var TaskStatus, attachments: val MutableList<Attachment>, custom: val Boolean)` with computed `blokKey = "$step||$blok"`; `TaskStatus { OPEN, DONE, NA }`; `City(name: val, tasks: val MutableList<Task>, submitted: var Boolean, approved: var Boolean)`; `Phase(template: val PhaseTemplate, tasks: val MutableList<Task>, submitted: var, approved: var)`; `Project(name: val, parentCity: var String, phases: val MutableList<Phase>)`; `Attachment(id: val, name: var, url: var, kind: val DriveKind, addedBy: var String, addedAt: val LocalDateTime)`; `User(email: val, passwordHash: var, displayName: val, role: var UserRole, status: var UserStatus, accessAllCities: var Boolean, cityAccess: val MutableSet<String>, projectAccess: val MutableSet<String>)` with `rasciFilterKey()`. `UserRole { OWNER, PM, OM, PO, PPM, MT }`, `UserStatus { PENDING, ACTIVE, REJECTED }`. `Task.custom(blokKey, deliverable)` factory produces deletable admin rows (`id = "c_<millis>_<counter>"`); `Task.fromTemplate` auto-converts a non-blank `existingLink` into an attachment with `addedBy = "Fasedocument"`. `Attachment.from(rawUrl, name?, addedBy)` trims, prefixes `https://` when no `://`, detects `DriveKind` (`GOOGLE_DOC/SHEET/SLIDES/FORM`, `DRIVE_FOLDER`, `DRIVE_FILE`, `WEB_LINK`) by substring match, and default-names by kind (WEB_LINK → URI host).
- **No persistence**: everything is in-memory (`AuthService` users included); only `.eml` files hit disk.

---

## 1. Screen inventory

### 1.1 `MainView` (object, `build(): Parent`)
Shell for all authenticated screens. Renders `headerBar(showBack=true, showAdminToggle=true, showAuthControls=true)`, then a `when` over `AppState.view` to pick the content view, wraps it in a `.main` card, appends `ExportPanel.build(stage)` below it, all inside a vertical `ScrollPane` (h-bar never, fit-to-width). **Bug worth knowing for the port:** `val stage = (mainCard.scene?.window as? Stage)` is evaluated before the node is attached to a scene, so it is always `null` — `ExportPanel`'s `FileChooser.showSaveDialog(null)` still works but is never parented to the window. The Export panel is visible on **every** authenticated screen for **every** user.

### 1.2 `headerBar(...)` (top-level function in HeaderBar.kt, params `showBack/showAdminToggle/showAuthControls: Boolean = true`)
Persistent navy app bar. Left: hard-coded title label `"1828 · Fasedocument Tracker"` (does **not** use `t("appTitle")`), `"v0.9 desktop"` badge (`.v-badge`), and, if signed in, `"{loggedInAs}: {displayName} ({role})"` meta label. Right side, in order:
| Element | Visible when | Action |
|---|---|---|
| `Admin` badge (`.admin-badge`) | `AppState.adminMode` | none (label) |
| open-task badge `"{n} open"` (`.badge-open`) | `openTaskCount() > 0` | none |
| 🏠 Dashboard button | signed in and `view !is Dashboard` | `view = Dashboard` |
| ✉ Notifications button, label `"✉ Meldingen (n)"` when n>0 | signed in | `view = Outbox`. Count = `EmailService.visibleTo(user.email, isOwner()).size` |
| 📥 Approvals button `(n)`, `.btn-highlight` (gold) when n>0 | **owner only** | `view = Approvals`. n = `pendingPhaseSubmissions().size + pendingCitySubmissions().size + AuthService.pending().size` |
| 👥 Users button | **owner only** | `view = UserAdmin` |
| ← Back button | `showBack` && not Dashboard && signed in | Structural: `ProjectView` → `CityDetail(project.parentCity)` (or Dashboard if project vanished); `CityDetail` → Dashboard; else Dashboard |
| ⚙ Admin / Admin off toggle | `showAdminToggle` && **owner** | `adminMode = !adminMode` |
| 🔑 button (tooltip "Wachtwoord wijzigen") | signed in | opens change-password dialog (§2.4) |
| Uitloggen button | signed in | `AppState.logout()` |
| `zoomControl()` | always (also on login screen) | §5 |
| `langToggle()` | always | NL/EN pills (`.lang-btn`, `.active`); clicking a different one sets `Strings.lang` + `notifyChanged()` |
All nav buttons are styled `btn outline tiny`.

### 1.3 `LoginView` (object; unauthenticated shell)
Module-level **persistent private state** (survives full re-renders because the object is a singleton): `enum Mode { LOGIN, SIGNUP, RESET }`, `var mode = Mode.LOGIN`, `var resetStep = 1`, `var resetEmail = ""`. `build()` renders `headerBar(false, false, false)` + one centered card (`.setup-card`, maxWidth 420/440/460).
- **Login card**: email `TextField`, `PasswordField`, inline error `Label` (`.form-error`, `isVisible/isManaged` toggled by `showError`), "Inloggen →" button. Enter in email focuses password; Enter in password submits. Submit → `AuthService.login(email, password)`; on `Ok` → `AppState.login(result.user)`; `UnknownEmail/BadPassword/Pending/Rejected` map to keys `loginFailUnknown/loginFailPassword/loginFailPending/loginFailRejected`. Below: "Wachtwoord vergeten?" hyperlink (→ `mode = RESET`, `resetStep = 1`, `resetEmail = ""`), "Nog geen account? / Account aanvragen" hyperlink (→ `mode = SIGNUP`), demo hint label (`Demo: ernest@1828.nl / ernest`).
- **Signup card**: name/email/password fields + requested-role `ChoiceBox<Pair<UserRole, String>>` with a `StringConverter`; choices PM (default), OM, PO, PPM, MT — **OWNER not offered**. Submit → `AuthService.signup(email, password, name, role)`; errors `InvalidEmail/WeakPassword(<4 chars)/AlreadyExists` → keys `signupFailEmail/signupFailWeak/signupFailExists`; on `Ok` → `showSubmittedConfirm(card)` which **mutates the card's children in place** (no `notifyChanged`): ✅ "Aanvraag ingediend" + description + back-to-login button. New accounts are `PENDING` until owner approval.
- **Reset card**: two steps (§2.5).
- Helpers: `labelled(label, node)` (field-label + control VBox), `showError(label, text)`.

### 1.4 `DashboardView` (object; the Drive-style landing page)
- Header row: page title + sub; **owner-only** "+ Stad" button → `promptAddCity()` (§2.6).
- **Stats strip** (`statTile(value, label, highlight)` → `.stat-tile`, value `.stat-val` + `.red`/`.highlight` when highlighted): accessible-city count, visible-project count (`projectOrder.count { canAccessProject(it) }`), `openTaskCount()`, and **owner-only** pending-approvals tile (`pendingPhaseSubmissions().size + pendingCitySubmissions().size`, highlighted when > 0).
- **Owner approval queue** (only if owner && pendingTotal > 0): up to 4 pending city submissions (🏙️ `{name} · {cityPhase.sheet}` + "Open project" button → `View.CityDetail(name)`), then up to 4 pending phase submissions (🏗️ `{proj} · Fase {i+1}: {sheet} ({parentCity})` + "Open project" → `View.ProjectView(proj.name, idx)`), then "Bekijk alles →" hyperlink → `View.Approvals`.
- **City grid** (`FlowPane`, wrap 980): `cityCard(name)` per accessible city — icon ✅ if `city.approved`, 🟡 if `city.submitted`, else 🏙️ (inline style `-fx-font-size: 2.3em`); city name; `{n} projecten/project` (singular key `projectCountOne`); hard-coded prefix label `"Gemeenteontwikkeling · {done}/{applicable}"` (done/applicable computed over `relevantTasks` minus NA); thin `ProgressBar` (`.progress-bar-thin.city`) fed by `progressOf(tasks)`. **Whole card is clickable** → `View.CityDetail(name)`. Empty state: `noCities` if no cities exist or user is owner, else `noAccessibleCities`.
- **Recent notifications** (any signed-in user, only if non-empty): latest 5 of `EmailService.visibleTo(email, isOwner())`; each row = event chip (`eventLabel`/`eventCss` from OutboxView.kt: `.event-chip` + `chip-submitted/chip-approval/chip-approved/chip-rejected/chip-reset`), subject, timestamp (`dd-MM HH:mm`); "Bekijk alles →" → `View.Outbox`.

### 1.5 `CityDetailView` (object, `build(name: String)`)
Fallback `Label(t("cityNotFound"))` if city missing. `locked = city.submitted || city.approved`.
- Crumbs `"Dashboard / {name}"`; title `"🏙️ {name}"`; sub = `PhaseData.cityPhase.sheet`; `markAllControls(TaskCtx.CityCtx(name))` in the header **only when not locked**.
- **City approval banner** (`buildCityBanner`, §2.1 lifecycle): approved → ✅ banner (`.approval-banner.approved`) + approver-only "Heropen fase" (sets `approved = false; submitted = false`); submitted → 🟡 banner (`.submitted`) + approver: "✓ Fase goedkeuren" (`submitted=false; approved=true;` `Notifications.cityDecision(name, approved=true)`) and "✗ Afwijzen" (`submitted=false`; `cityDecision(false)`); non-approver: "Intrekken" (`submitted = false`) + muted `needsApprover` label; else → readiness banner (`.ready` when 0 OPEN tasks with `readyTitle+readyDesc`, `.open` otherwise with `notReadyBanner {n}`) + always-visible "Indienen ter goedkeuring" → `trySubmitCity` (§2.2).
- When locked and any task has attachments: `reviewDocsStrip(all attachments)` (§1.11).
- `roleFilterBar()` + `TaskListView.build(city.tasks, CityCtx)`.
- **Projects section**: heading `"Projecten in {name}"`; when `!city.approved` a muted `"🔒 {cityGateHint}"` line; "+ Project" button (**not permission-gated — every user sees it**) → `promptAddProject(name)` (§2.6). Grid of `projectCard(proj, cityApproved)`: icon 🔒 (city not approved) / 🏁 (all phases approved) / 🔵 (some approved) / 🏗️; meta `"{approved}/{total} fase(n) · {done}/{applicable} taken"` aggregated over all phases with `relevantTasks` minus NA; thin progress bar; **card click always navigates** to `View.ProjectView(proj.name, 0)` even when the city gate is closed (the phase view itself shows the locked state); tooltip `cityLockedMsg {city}` when locked. Empty state `noProjectsInCity`.

### 1.6 `ProjectView` (object, `build(name: String, phaseIdx: Int)`)
Fallback `projectNotFound`. `safeIdx = phaseIdx.coerceIn(0, phases.size-1)`; if clamped, **mutates** `(AppState.view as? View.ProjectView)?.phaseIdx = safeIdx` in place. `ctx = TaskCtx.ProjectCtx(name, safeIdx)`; `phaseLocked = ctx.isLocked()` (submitted || approved); `unlocked = AppState.isPhaseUnlocked(name, safeIdx)`.
- Crumbs `"Projecten / {name}"`; title `"🏗️ {name} — Fase {i+1}: {sheet}"`; meta = `lockedTitle` when locked-by-gate, else `phaseMeta(phase)` = `"{done} van {applicable} van toepassing · {na} N.v.t."`. `markAllControls(ctx, parentDisabled = phaseLocked)` shown only when `unlocked && !approved && !submitted`.
- **Phase tab strip** (`buildPhaseTabs`, horizontal pannable ScrollPane): one Button per phase, text `"{dot} {i+1}. {sheet}"` where dot = 🔒 not unlocked / ✅ approved / 🟡 submitted / 🟢 `isPhaseReady` / 🔵 any filtered task DONE / ⚪ else. Style classes `ptab` + `active` (current) + `locked` + `approved`; `isDisable = !unlocked`; click → `AppState.view = View.ProjectView(projectName, pi)`.
- **Body when gate-locked**: empty-state (🔒, `lockedTitle`, reason = `cityLockedMsg {parentCity}` for phase 0, else `lockedSub`).
- **Body when unlocked**: `buildApprovalBanner` (§2.1, same three-state shape as the city banner but for `Phase`; approve/reject route through `approve()`/`reject()` which re-check `isApprover()` and show a WARNING alert `needsApprover` otherwise; approve → `submitted=false; approved=true; Notifications.phaseApproved(name, idx)`; reject → `submitted=false; Notifications.phaseRejected(...)`; withdraw → `submitted=false`; reopen → both flags false); `reviewDocsStrip` when (submitted || approved) && docs exist; `roleFilterBar()`; `TaskListView.build(phase.tasks, ctx)`. Submit button → `trySubmit` (§2.2).

### 1.7 `ApprovalsView` (object; owner-only inbox)
Non-owners get a bare `needsApprover` label. Sections:
1. **Fase-goedkeuringen**: pending **city** submissions first (they gate everything): 🏙️ row with `cityGateHint` meta, non-removable `docChip`s for every attachment in the city's tasks, and three buttons — "Open project" → `View.CityDetail(name)`; "Goedkeuren" (`.btn.success.tiny`) → `submitted=false; approved=true; Notifications.cityDecision(name, true)`; "Afwijzen" (`.btn.danger.tiny`) → `submitted=false; cityDecision(name, false)`. Then pending **phase** submissions: 🏗️ `{proj} · Fase {i+1}: {sheet}` + `"Steden: {parentCity}"` meta + doc chips + Open (`View.ProjectView(proj, idx)`) / Approve (`Notifications.phaseApproved`) / Reject (`Notifications.phaseRejected`). Empty state ✅ `noPhaseSubmissions`.
2. **Account-aanvragen** (`AuthService.pending()`): 👤 displayName + `"{email} · Rol: {role}"`; Approve → `AuthService.approve(email)`; Reject → `AuthService.reject(email)`. Empty state ✅ `noPendingSignups`.
Note: approval logic here **duplicates** the banner logic in CityDetailView/ProjectView (same mutations + notifications in two places).

### 1.8 `UserAdminView` (object; owner-only)
Non-owners get `needsApprover` label. One `.list-row` per `AuthService.all()` user (`userRow(u)`):
- Identity: displayName + status chip (`.status-chip` + `status-active/status-pending/status-rejected`, labels via `statusLabel()`), email.
- **Role `ChoiceBox<UserRole>`**: all six enum values **including OWNER**; `isDisable = (u == AppState.currentUser)` (owner can't demote self); value listener → `AuthService.setRole(u.email, newRole)` + `notifyChanged()` (fires immediately on selection).
- **Access chips** (`accessChips(u)`, FlowPane of `.role-chip` buttons, `.active-chip` when on): first an "Alles" chip — active if `u.accessAllCities || u.role == OWNER`, disabled for OWNER (implies all), click toggles `u.accessAllCities`; then one chip per `AppState.cityOrder` city — active if accessAll/OWNER/`city in u.cityAccess`, disabled when accessAll or OWNER, click toggles membership in `u.cityAccess`. Hint line `managerAccessHint` above the list.
- **Actions** by status: PENDING → Approve + Reject buttons (`AuthService.approve/reject`); REJECTED → Approve only; ACTIVE → none. Plus a red "Verwijderen" button when `u.role != OWNER && u != currentUser` → `promptRemoveUser(u)` (§2.7).

### 1.9 `OutboxView` (object) + shared helpers
Top-level internal helpers used by both Outbox and Dashboard: `eventLabel(e: NotifyEvent): String` (maps `DELIVERABLE_SUBMITTED/APPROVAL_REQUESTED/PHASE_APPROVED/PHASE_REJECTED/PASSWORD_RESET` → keys `evSubmitted/evApprovalRequested/evApproved/evRejected/evReset`) and `eventCss(e)` (→ `chip-submitted/chip-approval/chip-approved/chip-rejected/chip-reset`).
`build()`: requires `currentUser` (else empty label). `mails = EmailService.visibleTo(user.email, isOwner())` — owner sees all mail, colleagues only mail addressed to them. Crumbs, title, sub (explains .eml fallback without SMTP), "📂 Open e-mailmap" button → `WebOpen.openFolder(EmailService.outboxDir())`. Each `mailRow(msg: EmailMessage)`: event chip + subject + meta line `"Aan: {to.joinToString} · Van: {from} · {dd-MM-yyyy HH:mm} · via {deliveredVia}"`, plus a hidden `.mail-body` label; **clicking the row toggles** `isVisible/isManaged` on the body (purely local node state — collapses again on any `notifyChanged`). Empty state `outboxEmpty`.

### 1.10 `TaskListView` (object) + top-level `roleFilterBar()` / `markAllControls()` + `TaskCtx` + `TaskRow`
- **`sealed class TaskCtx`** (in TaskRow.kt): `CityCtx(cityName)` / `ProjectCtx(projectName, phaseIdx)`; `list(): MutableList<Task>` resolves the live task list (`!!` on the maps); `isLocked(): Boolean` = city/phase `submitted || approved`; `label(): String` = email context (`"{city} — {sheet}"` or `"{proj} — Fase {i+1}: {sheet} ({parentCity})"`).
- **`TaskListView.build(tasks: MutableList<Task>, ctx)`**: groups tasks by `blokKey` (`"step||blok"`) in a `LinkedHashMap` preserving insertion order, each with original indexes. Per group: applies the RASCI filter (`AppState.role`, substring match on r/a/s/c) and **skips the whole group** if filtered empty and role ≠ "all". Renders a `.blok-header` toolbar (step label `.blok-step`, blok name `.blok-name`), and when `adminMode && !locked`: ▲/▼ blok-reorder buttons (`moveBlok` swaps adjacent keys in the distinct-blokKey order and rebuilds the entire list by regrouping — first/last hidden at edges) and "+ Regel toevoegen" (`promptAddRow`, §2.8). Rows via `TaskRow.build(task, originalIdx, ctx, tasks.size)`.
- **`roleFilterBar()`**: `.role-bar` with label + chips `Alle`(value `"all"`) + `OM/PO/PM/PPM/MT`; active chip has `.active-chip`; click sets `AppState.role` (global — also changes progress math, open-task counts, and Export panel stats).
- **`markAllControls(ctx, parentDisabled = false)`**: "Alles ✓" / "Alles ✗" buttons → `applyMarkAll(ctx, DONE|OPEN)`: for each `relevantTasks` entry (matched back by id), skips NA rows, sets status; collects tasks that flipped OPEN→DONE and sends **one digest** `Notifications.deliverablesSubmitted(ctx.label(), completed)`.
- **`TaskRow.build(task, idx, ctx, totalCount)`**: 
  - **Tri-state button** (`.tri-btn` + `.checked`/`.na`): shows ✓ / ⊘ / empty; click cycles DONE→OPEN, NA→OPEN, OPEN→DONE; on any transition **into** DONE fires `Notifications.deliverablesSubmitted(ctx.label(), listOf(task))` (one email per checkmark). Disabled when locked.
  - **"N.v.t." pill** (`.na-toggle` + `.on`): toggles NA↔OPEN, no email. Disabled when locked.
  - Name label (`.task-name` + `.done`/`.na` strike styles), "eigen" badge (`.custom-tag`) for custom rows, RASCI tag labels `R:`/`A:`/`S:`/`C:` (`.rasci-tag.rasci-R` etc.) shown only when non-blank — `iCol` and `opm` are **not rendered**.
  - Attachment cell (fixed 260px, §1.11).
  - Admin aside (when `adminMode && !locked`): per-task ▲/▼ (`moveTask` swaps adjacent tasks, **only within the same blokKey**; disabled at blok boundaries); when `adminMode && task.custom`: 🗑 delete (`deleteCustom`, OK/Cancel confirm `deleteRowConfirm`, then `arr.removeAt(idx)`). Row classes: `task-row` + `custom`/`done`/`na`.

### 1.11 `AttachmentUi.kt` (internal top-level functions, shared)
- `kindIcon(kind)` → 📄/📊/📽/📝/📁/🗂/🔗; `kindLabel(kind)` → "Google Doc"/"Google Sheet"/"Google Slides"/"Google Form" (hard-coded EN) or localized `kindFolder/kindFile/kindLink`.
- `docChip(att, removable, onRemove)`: `.doc-chip` HBox (icon + name + optional ✕ `.doc-chip-x` which `consume()`s the event and calls `onRemove`); tooltip `"{kindLabel} · {url}\n{addedBy}"`; **clicking the chip opens the URL in the system browser** (`WebOpen.open`).
- `attachmentCell(task, locked)`: FlowPane of chips (removable iff `!locked`; removal mutates `task.attachments` + `notifyChanged`); "+ 📎 Document" add button (`.attach-add-btn`) only when `!locked` → `promptAttach(task)` (§2.3). Chips stay clickable when locked so reviewers keep one-click access.
- `reviewDocsStrip(docs)`: "📎 Documenten voor review (n)" heading + flow of non-removable chips; shown on locked city pages, submitted/approved phases, and Approvals rows.

### 1.12 `ExportPanel` (object)
`data class Counts(done, na, open, link: Int)`. `aggregate()`: walks all cities (`cityOrder`) and all phases of all projects (`projectOrder`) — **no access filtering, but it does apply `relevantTasks`**, so the active RASCI chip changes the displayed stats; `link` counts tasks with ≥1 attachment. `build(stage: Stage?)`: left title/desc; right stat mini-tiles (done=green, na=grey, open=red, link uncolored) + "⬇ Exporteer Excel" (`.btn.success`) → `runExport`: `FileChooser` (filter `*.xlsx`, initial name `fasedocument_{LocalDate.now()}.xlsx`) → `ExcelExport.write(target)` → INFO alert `"{exportSuccess} {path}"` or ERROR alert `"{exportFailed} {message}"`.

### 1.13 `WebOpen` (object)
`var host: HostServices?` injected by Main. `open(url)`: `host.showDocument(url)` when present, else OS-specific `ProcessBuilder` (`open` / `cmd /c start` / `xdg-open`), all failures swallowed via `runCatching`. `openFolder(dir: File)`: same pattern (macOS `open`, Windows `explorer`, else `xdg-open`). Electron equivalent: `shell.openExternal` / `shell.openPath`.

---

## 2. Dialogs and flows (all JavaFX modal `showAndWait`, i.e. synchronous/blocking — a React port needs async modal state)

### 2.1 Approval banner lifecycle (city and phase, identical shape)
Three states rendered from two booleans: `approved` → green banner + approver-only Reopen; `submitted && !approved` → yellow banner + approver Approve/Reject or non-approver Withdraw + hint; neither → readiness banner (`.ready`/`.open`) + Submit button (always enabled).

### 2.2 Submit with unfinished tasks (two-step prompt)
**Project phase** (`ProjectView.trySubmit(projectName, phaseIdx, phase)`):
1. If no OPEN tasks → `doSubmit` immediately (`phase.submitted = true`; `Notifications.approvalRequested`).
2. Else **Step 1**: CONFIRMATION alert, text `unfinishedPrompt` with `{n}` replaced; buttons = custom "Ga verder" (`ButtonData.OK_DONE`) + CANCEL. Cancel/dismiss aborts.
3. **Step 2**: CONFIRMATION alert, text `unfinishedChoice {n}`; buttons = "Markeer als n.v.t." (`ButtonData.LEFT`), "Verplaats naar volgende fase (WIP)" (`ButtonData.OK_DONE`) **only if a next phase exists** (`hasNext`), + CANCEL. N/A choice → `AppState.markOpenTasksNa`; move choice → `AppState.moveOpenTasksToNextPhase` (open tasks get `step = "WIP"`, `blok = ""`, prepended to the next phase so they render as a WIP group at the top). Cancel aborts without submitting. Then `doSubmit`.

**City** (`CityDetailView.trySubmitCity(city)`): same step 1; step 2 offers **only** the N/A option (cities have no next phase); on confirm, sets each OPEN task to NA inline (`open.forEach { it.status = TaskStatus.NA }`) then `doSubmitCity` (`city.submitted = true`; `Notifications.cityApprovalRequested(city.name)`).

### 2.3 Attach document (`promptAttach(task)` in AttachmentUi.kt)
`Dialog<ButtonType>` titled `attachDialogTitle`; GridPane with URL `TextField` (prompt `https://docs.google.com/…`, prefWidth 380) and optional name `TextField`; OK/CANCEL. On OK: trim; validation = reject if blank or contains no `"."` → WARNING `attachInvalidUrl`. Else `task.attachments += Attachment.from(url, name, currentUser?.displayName ?: "?")` (auto `https://` prefix, DriveKind detection, default name per kind) + `notifyChanged()`.

### 2.4 Change password (`changePasswordDialog(email)` in HeaderBar.kt, 🔑 button)
`Dialog<ButtonType>` with three `PasswordField`s (current/new/confirm) in a GridPane; OK/CANCEL. On OK: client-side mismatch check (`pwMismatch` WARNING); then `AuthService.changePassword(email, current, new)` → `Ok` (INFO `changePwSuccess`) / `BadCurrent` (WARNING `changePwFailCurrent`) / `WeakPassword` (<4 chars, WARNING `signupFailWeak`).

### 2.5 Password reset (LoginView RESET mode, two steps, not a modal — a card swap)
Step 1: email field + "Stuur code" → `AuthService.requestPasswordReset(email)` (generates 6-digit code, stores it in `resetCodes`, emails via `Notifications.passwordReset`; returns null for unknown email → `loginFailUnknown`). Success stores `resetEmail`, `resetStep = 2`. Step 2: info text `resetCodeSent`, "📂 Open e-mailmap" button (opens the `.eml` outbox dir — the demo's email inbox), code field (prompt `123456`), new + confirm password fields; Enter on confirm submits. Client mismatch check, then `AuthService.completePasswordReset(resetEmail, code, newPw)` → `Ok` (INFO alert `resetSuccess`, back to LOGIN) / `BadCode` (`resetFailBadCode`) / `WeakPassword` / `UnknownEmail`. "Terug naar inloggen" hyperlink resets `mode`/`resetStep`.

### 2.6 Add city / add project / add row (all `TextInputDialog`, title "1828", headerText null)
- **Add city** (Dashboard, owner-only button): prompt `namePromptCity`; trimmed/blank→abort; `AppState.addCity(name)` false → WARNING `duplicateName`; success navigates to `View.CityDetail(name)`.
- **Add project** (CityDetail, un-gated button): prompt `namePromptProject`; `AppState.addProject(name, parentCity)` false → `duplicateName`; success → `View.ProjectView(name, 0)`. (The `pickCityForProject` string exists but is unused — parent city is implicit from the page.)
- **Add row** (blok toolbar, admin mode only): prompt `addRowPrompt`; inserts `Task.custom(blokKey, name)` **after the last task of that blok** (scan from the end for matching `blokKey`, insert at i+1, else append).

### 2.7 Remove user with replacement picker (`UserAdminView.promptRemoveUser(u)`)
Candidates = all ACTIVE users except the target, sorted **owner-first** (`sortedByDescending { it.role == UserRole.OWNER }` — Ernest is the default hand-over target); abort silently if none. `Dialog<ButtonType>` titled `removeUserTitle`; wrapped prompt `removeUserPrompt {user}`; `ChoiceBox<User>` with converter `"{displayName} ({role})"`, default first (owner); confirm button "Verwijder en draag over" (`OK_DONE`) + CANCEL. On confirm: `moved = AppState.reassignAttachments(u.displayName, replacement.displayName)` (rewrites `addedBy` everywhere), then `AuthService.remove(u.email)` — false (owner) → WARNING `cannotRemoveOwner` and return (**note: attachments are reassigned before the removal check, so a failed removal still reassigns — port should reorder**); success → INFO alert `removedInfo` with `{user}/{n}/{to}` replaced. The Remove button is already hidden for OWNER and self, so the guard is a backstop.

### 2.8 Delete custom row (`TaskRow.deleteCustom`)
CONFIRMATION alert `deleteRowConfirm` OK/CANCEL → `arr.removeAt(idx)`. Only reachable for `task.custom == true` in admin mode.

---

## 3. Role/permission-driven UI differences

Two orthogonal axes: **account role** (`UserRole`) and the **RASCI letter filter** (`AppState.role` string, initialized from `rasciFilterKey()` — OWNER logs in as `"all"`, everyone else as their role letter, freely changeable via the chip bar).

| Capability | Owner (Ernest) | Everyone else (PM/OM/PO/PPM/MT) |
|---|---|---|
| Approvals (📥) + Users (👥) header buttons | yes, with pending-count highlight | hidden |
| `ApprovalsView` / `UserAdminView` content | full | `needsApprover` stub (defense-in-depth) |
| Admin-mode toggle (⚙) | yes | hidden (`showAdminToggle && isOwner()`) |
| Admin mode features (blok/task reorder, add custom row, delete custom row, Admin badge) | when toggled on | never |
| "+ Stad" on Dashboard | yes | hidden |
| "+ Project" on CityDetail | yes | **also yes — not gated** |
| Approve / Reject / Reopen buttons (city + phase banners, Approvals rows) | yes (`isApprover() == isOwner()`) | see Withdraw + `needsApprover` note instead |
| Withdraw a submission | n/a (sees approve/reject) | yes (`submitted = false`) |
| Pending-approvals stat tile + approval queue on Dashboard | yes | hidden |
| Outbox contents | all mail (`visibleTo(email, isOwner=true)`) | only mail addressed to them |
| City/project visibility | everything (`accessAllCities`/OWNER short-circuit) | filtered by `accessAllCities` flag, `cityAccess` set, `projectAccess` set |
| Dashboard empty state | `noCities` | `noAccessibleCities` (when cities exist but none granted) |
| Role ChoiceBox in UserAdmin | can change anyone except self | n/a |
| Removable | never (`AuthService.remove` refuses OWNER; button hidden) | yes, by owner |

**Copy/code mismatch to resolve in the port:** the string `needsApprover` ("Alleen MT (goedkeurder) of admin kan een fase goedkeuren" / "Only MT (approver) or admin can approve") and the MT role description ("goedkeurder") claim MT can approve, but `AppState.isApprover()` is `isOwner()` only — MT users see Withdraw, not Approve. Signup also cannot request OWNER.

---

## 4. i18n mechanism

- `object Strings` in `Strings.kt`: `enum class Lang { NL, EN }`; **`var lang: Lang = Lang.NL`** (global mutable, default Dutch); `private val tables: Map<Lang, Map<String, String>>` — two flat inline string maps; `fun t(key: String): String` with fallback chain **current lang → NL → the key itself**.
- **Exactly 222 keys per language** (verified by count; NL and EN key sets are identical — 444 entries total). Categories: login/signup/reset (~40), header/nav/roles (~20), city+project structure and task board (~45), approvals/user admin (~25), outbox/notifications (~15), email subjects/bodies (~20), attachments (~10), password flows (~20), remove-user (~6), unfinished-submit (~6), city gate (~12), zoom (1).
- **Interpolation is manual**: templates hold `{n}`, `{user}`, `{city}`, `{project}`, `{phase}`, `{task}`, `{ctx}`, `{to}` and call sites do chained `String.replace("{x}", …)`. Pluralization is ad hoc: dedicated keys (`projectCount` vs `projectCountOne`) or string surgery (`"${t("phaseLabel")}n"` appends `n` to "fase" to make "fasen" — breaks in EN where it produces "phasen").
- **Language switch**: the NL/EN pill toggle in the header sets `Strings.lang` and calls `AppState.notifyChanged()`; because every render re-calls `t()`, the full-tree rebuild re-localizes everything, including the stage title (set in `mount`).
- **Email language caveat**: notification subjects/bodies use `t()` at send time, so stored emails are frozen in whatever language was active when sent.
- **Strings that bypass `t()`** (must be added to the catalogue in the port): header title `"1828 · Fasedocument Tracker"`, `"v0.9 desktop"`, `"Gemeenteontwikkeling · "` prefix in the dashboard city card, `TextInputDialog` titles `"1828"`, `kindLabel`'s four Google-type names, the demo-account names, and the `WIP` step headline (`AppState.WIP_STEP`, flagged in code as pending a final title).
- Unused key noted: `pickCityForProject` (defined, never referenced).

---

## 5. Zoom mechanism and CSS em-sizing

- **State**: `AppState.ZOOM_LEVELS = listOf(0.9, 1.0, 1.15, 1.3, 1.5)` (immutable `val`), `var zoomFactor: Double = 1.0`. `zoomIn()` = first level `> zoomFactor + 0.001`; `zoomOut()` = last level `< zoomFactor - 0.001` (epsilon guards float equality); both no-op at the ends.
- **Control** (`zoomControl()` in HeaderBar.kt, present on every screen including login): `🔍  −  {pct}%  +` inside `.zoom-box`. Minus disabled at the bottom level, plus at the top (same epsilon comparisons). Clicking the percentage label resets `zoomFactor = 1.0`. Tooltip `zoomTooltip`. Every interaction calls `notifyChanged()`.
- **Application point**: in `Main.kt`'s `mount`, the root pane gets an inline style `-fx-font-size: {13.0 * zoomFactor}px` (`String.format(Locale.ROOT, "%.2fpx", …)` — Locale.ROOT forces a dot decimal separator so it works on Dutch systems).
- **Why it works**: `app.css` declares `.root { -fx-font-size: 13px; }` as the fallback and — per the stylesheet's own header comment — **ALL other font sizes are em** (56 `em;` occurrences; the only `px` font size in the file is that root 13px). JavaFX resolves `em` against the inherited font size, so the single root value rescales every label, button, chip and badge. Caveats for the port: code-side geometry (`Insets`, `minWidth = 260.0`, `prefWrapLength`, spacing values, the fixed 260px attachment column) is in px and does **not** scale — only text and em-based CSS padding do; the emoji icons sized `2.3em` inline do scale.
- **React/Electron equivalent**: set `font-size` on `html`/`:root` (13px × factor, or a CSS custom property) and use `rem` throughout; keep the discrete 5-level stepper + click-to-reset behavior.

---

## 6. UI architecture patterns — replicate vs replace in the React port

**Replace:**
1. **Full-tree re-render via manual listener** — `AppState` is a mutable singleton with a hand-rolled observer (`onChange`/`notifyChanged`); every handler mutates shared objects then triggers a total rebuild. Consequences the current app lives with (and a port must consciously fix or accept): scroll positions reset, the Outbox expanded-mail state collapses, in-progress text inputs are destroyed on any change, and the phase tab strip's scroll offset resets. React equivalent: a store (Zustand/Redux/immer) with immutable updates; React's reconciliation gives per-component preservation for free — but note the app *depends* on global re-render for language and zoom changes, which map naturally to context/CSS.
2. **Deep in-place model mutation** — `Task.status`, `Phase.submitted/approved`, `City` flags, `User.cityAccess`, `Attachment.addedBy` are all mutated directly from event handlers, sometimes bypassing helper functions (e.g. `trySubmitCity` sets statuses inline; Approvals rows duplicate the banner mutations). Port should route every mutation through named store actions (submitPhase, approvePhase, rejectPhase, withdrawPhase, reopenPhase, toggleTask, setNa, attach/removeAttachment, addCity/Project/Row, moveTask/Blok, reassignAndRemoveUser, …) so notifications fire in exactly one place — today `Notifications.*` calls are duplicated between ProjectView/CityDetailView banners and ApprovalsView.
3. **Blocking modal dialogs** — `Alert`/`Dialog`/`TextInputDialog.showAndWait()` everywhere; multi-step flows (§2.2) are sequential blocking prompts. React needs a promise-based or state-machine modal system; the two-step submit flow is the main one to model carefully (Cancel at either step must abort without side effects).
4. **String-keyed navigation and identity** — views reference cities/projects by display name; renames would orphan navigation and `parentCity` references; `reassignAttachments` matches users by `displayName`. Port to stable ids.
5. **Singleton `object` views with hidden module state** — `LoginView.mode/resetStep/resetEmail` persist across renders (and across logouts!) because the object never dies. Port to component state with explicit reset on unmount/logout.
6. **Known quirks not to copy**: MainView's null `stage` for the FileChooser; remove-user reassigning attachments before the removal-success check; `needsApprover` copy vs `isApprover()` mismatch; "+ Project" not permission-gated; "fasen" pluralization by appending "n"; `View.ProjectView.phaseIdx` being a `var` mutated during render; export stats silently affected by the RASCI filter chip.

**Replicate:**
1. **Single source of truth + derive-everything rendering** — every badge, count, banner state, tab dot and progress bar is computed on render from the model (`openTaskCount`, `pendingPhaseSubmissions`, `progressOf`, `isPhaseUnlocked`, `isPhaseReady`). These become selectors; keep the exact math (N/A out of the denominator, empty ⇒ 1.0, RASCI substring filter, city-gate rule for phase 0).
2. **styleClass-based styling** — the app is styled almost entirely through semantic CSS classes on a single stylesheet (`btn/outline/tiny/success/danger`, `tile-card`, `list-row(-title/-meta)`, `approval-banner approved|submitted|ready|open`, `ptab active|locked|approved`, `role-chip/active-chip`, `event-chip chip-*`, `status-chip status-*`, `rasci-tag rasci-R…`, `tri-btn checked|na`, `doc-chip`, `stat-tile`, `zoom-box`, `lang-toggle`). This maps 1:1 to CSS-module/utility classes; the palette and the "Google Drive-familiar" design language are documented in the CSS header comment (ink #202124, ground #F8F9FA, brand navy #1A1A2E, teal #2A9D8F, cyan #0E7490, gold #F0C040, red #D93025).
3. **em-relative typography with one root knob** for zoom (§5) — port as rem.
4. **Composable shared fragments** — `headerBar`, `roleFilterBar`, `markAllControls`, `docChip`/`attachmentCell`/`reviewDocsStrip`, `statTile`, `eventLabel/eventCss`, and the `TaskCtx` abstraction (one task-board component serving both the city list and project phases, parameterized by context providing `list/isLocked/label`) are already clean component boundaries — mirror them as React components/hooks.
5. **The flat i18n table with `t(key)`** ports directly (i18next or a typed 222-key record per language); upgrade `{placeholder}`-replace to proper interpolation and fix pluralization.
6. **The approval state machine** (two booleans → three banner states, gate rules, withdraw/reopen) and the **two-step unfinished-submit flow** including the WIP-move semantics (step="WIP", blok="", prepend to next phase) are core business behavior — replicate exactly.