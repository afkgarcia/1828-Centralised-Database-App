# Desktop App Audit — Model & State Layer

Scope: complete read of
- `/Users/alessandrogarcia/Desktop/GarciaGaspar/1828/desktop-app/src/main/kotlin/app/model/Models.kt`
- `/Users/alessandrogarcia/Desktop/GarciaGaspar/1828/desktop-app/src/main/kotlin/app/model/Attachment.kt`
- `/Users/alessandrogarcia/Desktop/GarciaGaspar/1828/desktop-app/src/main/kotlin/app/model/User.kt`
- `/Users/alessandrogarcia/Desktop/GarciaGaspar/1828/desktop-app/src/main/kotlin/app/state/AppState.kt`

External dependency referenced but not in scope: `app.data.PhaseData` (provides `PhaseData.cityPhase: PhaseTemplate` and `PhaseData.projectPhases: List<PhaseTemplate>`, i.e. the templates loaded from `phases.json`).

---

## 1. Entities, enums, and factories

### 1.1 Enums

| Enum | Values | Notes |
|---|---|---|
| `TaskStatus` (Models.kt) | `OPEN`, `DONE`, `NA` | Three-state task lifecycle: Open → Done → N/A. |
| `DriveKind` (Attachment.kt) | `GOOGLE_DOC`, `GOOGLE_SHEET`, `GOOGLE_SLIDES`, `GOOGLE_FORM`, `DRIVE_FOLDER`, `DRIVE_FILE`, `WEB_LINK` | Has companion `detect(url)` — see below. |
| `UserRole` (User.kt) | `OWNER` (Ernest; sees everything, sole approver of phase submissions and signups), `PM` (project manager, submits phases), `OM` (development manager), `PO` (project developer), `PPM` (property manager), `MT` (management team) | Account-level role, explicitly distinct from RASCI letters on tasks. |
| `UserStatus` (User.kt) | `PENDING`, `ACTIVE`, `REJECTED` | Signup lifecycle. |

**`DriveKind.detect(url: String): DriveKind`** — lowercases the URL, then first match wins in this exact order:
1. contains `"docs.google.com/document"` → `GOOGLE_DOC`
2. contains `"docs.google.com/spreadsheets"` → `GOOGLE_SHEET`
3. contains `"docs.google.com/presentation"` → `GOOGLE_SLIDES`
4. contains `"docs.google.com/forms"` **or** `"forms.gle"` → `GOOGLE_FORM`
5. contains `"drive.google.com"` **and** `"/folders/"` → `DRIVE_FOLDER`
6. contains `"drive.google.com"` → `DRIVE_FILE`
7. otherwise → `WEB_LINK`

### 1.2 `TaskTemplate` (Models.kt) — `@Serializable data class`
Raw template row as loaded from `phases.json` (mirrors the prototype's `PHASES_DATA`). All fields are immutable (`val`) with defaults:

| Field | Type | Default |
|---|---|---|
| `row` | `Int` | `0` |
| `step` | `String` | `""` |
| `blok` | `String` | `""` |
| `deliverable` | `String` | `""` |
| `existingLink` | `String` | `""` |
| `r`, `a`, `s`, `c`, `i` | `String` each | `""` |
| `opm` | `String` | `""` |

### 1.3 `PhaseTemplate` (Models.kt) — `@Serializable data class`

| Field | Type | Mutability |
|---|---|---|
| `sheet` | `String` | `val` |
| `tasks` | `List<TaskTemplate>` | `val` |

### 1.4 `Task` (Models.kt) — plain mutable class (NOT serializable, NOT a data class)

| Field | Type | Mutability | Default |
|---|---|---|---|
| `id` | `String` | `val` | — |
| `step` | `String` | `var` | — |
| `blok` | `String` | `var` | — |
| `deliverable` | `String` | `var` | — |
| `r` | `String` | `var` | — |
| `a` | `String` | `var` | — |
| `s` | `String` | `var` | — |
| `c` | `String` | `var` | — |
| `iCol` | `String` | `var` | — (named `iCol` to hold the template's `i` column) |
| `opm` | `String` | `var` | — |
| `status` | `TaskStatus` | `var` | `TaskStatus.OPEN` |
| `attachments` | `MutableList<Attachment>` | `val` (list itself mutable) | `mutableListOf()` |
| `custom` | `Boolean` | `val` | `false` — true for admin-added rows; custom rows can be deleted, base rows cannot |

Computed property: `blokKey: String get() = "$step||$blok"` (grouping key, `||`-joined).

**Companion factories:**
- `Task.fromTemplate(tmpl: TaskTemplate, prefix: String, idx: Int): Task` — id = `"${prefix}_b_$idx"`; copies `step/blok/deliverable/r/a/s/c`, `iCol = tmpl.i`, `opm = tmpl.opm`; `status = OPEN`, `custom = false`. If `tmpl.existingLink` is non-blank, it is converted to an attachment via `Attachment.from(tmpl.existingLink, null, "Fasedocument")` — i.e. pre-existing phase-document links become attachments with `addedBy = "Fasedocument"` (a sentinel display name, not a real user).
- `Task.custom(blokKey: String, deliverable: String): Task` — splits `blokKey` on `"||"` with `limit = 2`: if 2 parts, `step = parts[0]`, `blok = parts[1]`; otherwise `step = ""` and `blok = firstOrNull() ?: ""`. Increments a `private var counter = 0` (companion-level, monotonically increasing, not thread-safe, resets on app restart) and builds id `"c_${System.currentTimeMillis()}_$counter"`. All RASCI fields and `opm` are `""`, `status = OPEN`, `custom = true`.

### 1.5 `City` (Models.kt) — plain class
A city tracks one Gemeenteontwikkeling task list (steps 1.1–1.3 of the phase document). It precedes the Acquisitiefase: projects in the city stay locked until the city list has been submitted and approved by the owner.

| Field | Type | Mutability | Default |
|---|---|---|---|
| `name` | `String` | `val` | — |
| `tasks` | `MutableList<Task>` | `val` | — |
| `submitted` | `Boolean` | `var` | `false` |
| `approved` | `Boolean` | `var` | `false` |

### 1.6 `Phase` (Models.kt) — plain class

| Field | Type | Mutability | Default |
|---|---|---|---|
| `template` | `PhaseTemplate` | `val` | — |
| `tasks` | `MutableList<Task>` | `val` | — |
| `submitted` | `Boolean` | `var` | `false` |
| `approved` | `Boolean` | `var` | `false` |

### 1.7 `Project` (Models.kt) — plain class

| Field | Type | Mutability | Default |
|---|---|---|---|
| `name` | `String` | `val` | — |
| `parentCity` | `String` | `var` | — (mutable: projects can be re-parented; projects always live under a city in the Drive-style hierarchy) |
| `phases` | `MutableList<Phase>` | `val` | — |

### 1.8 `Attachment` (Attachment.kt) — plain class

| Field | Type | Mutability | Default |
|---|---|---|---|
| `id` | `String` | `val` | — |
| `name` | `String` | `var` | — |
| `url` | `String` | `var` | — |
| `kind` | `DriveKind` | `val` | — (kind is frozen even though `url` is mutable — editing the URL does NOT re-detect the kind) |
| `addedBy` | `String` | `var` | — display name of who linked it; mutable specifically so it can be reassigned when that user is removed |
| `addedAt` | `LocalDateTime` | `val` | `LocalDateTime.now()` |

**Companion factory `Attachment.from(rawUrl: String, name: String?, addedBy: String): Attachment`:**
1. `url = rawUrl.trim()`; if non-empty and does not contain `"://"`, prefix with `"https://"`.
2. `kind = DriveKind.detect(url)`.
3. Increments companion `private var counter = 0`; id = `"att_${System.currentTimeMillis()}_$counter"` (same counter caveats as `Task.custom`).
4. `name` = trimmed provided name unless null/blank, else `defaultName(kind, url)`.

`private fun defaultName(kind, url)`: `GOOGLE_DOC → "Google Doc"`, `GOOGLE_SHEET → "Google Sheet"`, `GOOGLE_SLIDES → "Google Slides"`, `GOOGLE_FORM → "Google Form"`, `DRIVE_FOLDER → "Drive folder"`, `DRIVE_FILE → "Drive file"`, `WEB_LINK → java.net.URI(url).host` (wrapped in `runCatching`; on parse failure or null host → `"Link"`).

### 1.9 `User` (User.kt) — plain class

| Field | Type | Mutability | Default |
|---|---|---|---|
| `email` | `String` | `val` | — |
| `passwordHash` | `String` | `var` | — |
| `displayName` | `String` | `val` | — |
| `role` | `UserRole` | `var` | — |
| `status` | `UserStatus` | `var` | `UserStatus.PENDING` |
| `accessAllCities` | `Boolean` | `var` | `false` — blanket access regardless of the city/project sets |
| `cityAccess` | `MutableSet<String>` | `val` | `mutableSetOf()` — cities the user may see; implies access to every project under each |
| `projectAccess` | `MutableSet<String>` | `val` | `mutableSetOf()` — additional fine-grained project grants outside `cityAccess` |

**`rasciFilterKey(): String`** — maps account role to the RASCI filter chip value: `OWNER → "all"`, `OM → "OM"`, `PO → "PO"`, `PM → "PM"`, `PPM → "PPM"`, `MT → "MT"`.

---

## 2. `View` sealed class (AppState.kt) — navigation states

| State | Kind | Payload | Purpose |
|---|---|---|---|
| `View.Dashboard` | `object` | — | Drive-style root: grid of cities. |
| `View.CityDetail` | `data class` | `val name: String` | City detail page: its Gemeenteontwikkeling + projects grid. |
| `View.ProjectView` | `data class` | `val projectName: String`, `var phaseIdx: Int = 0` | Project's phase view. **`phaseIdx` is a `var` inside a data class** — the current phase tab is mutated in place on the view object rather than by replacing the view (a wart to normalize in the React port; `equals`/`hashCode` include `phaseIdx` since it's a constructor property). |
| `View.Approvals` | `object` | — | Owner-only inbox: pending phase submissions + pending signups. |
| `View.UserAdmin` | `object` | — | Owner-only user management. |
| `View.Outbox` | `object` | — | Sent email notifications (owner sees all; colleagues see their own). |

---

## 3. `AppState` — singleton `object`, every member with exact semantics

### 3.1 State fields

| Field | Type | Mutability | Default | Semantics |
|---|---|---|---|---|
| `currentUser` | `User?` | `var` | `null` | Signed-in user; `null` = login screen. |
| `role` | `String` | `var` | `"all"` | Active RASCI-letter filter chip; defaults from the logged-in user's `rasciFilterKey()`. |
| `adminMode` | `Boolean` | `var` | `false` | Toggles row reorder + custom-row UI; available to owners only (enforced by UI, not here). |
| `ZOOM_LEVELS` | `List<Double>` | `val` | `[0.9, 1.0, 1.15, 1.3, 1.5]` | Discrete text-size steps. Multiplies root font size; all stylesheet sizes are em-based so this scales the whole UI. |
| `zoomFactor` | `Double` | `var` | `1.0` | Current zoom step. |
| `view` | `View` | `var` | `View.Dashboard` | Current navigation state. |
| `cityOrder` | `MutableList<String>` | `val` | empty | Display ordering of cities (source of truth for iteration order everywhere). |
| `cities` | `MutableMap<String, City>` | `val` | empty | Keyed by city name (names are unique IDs). |
| `projectOrder` | `MutableList<String>` | `val` | empty | Display ordering of projects. |
| `projects` | `MutableMap<String, Project>` | `val` | empty | Keyed by project name — project names are **globally unique across all cities**, not per-city. |
| `listeners` | `MutableList<() -> Unit>` | `private val` | empty | Re-render callbacks (see section 4). |
| `WIP_STEP` | `const String` | const | `"WIP"` | Placeholder headline for tasks carried into the next phase; final title pending from Ernest. |

### 3.2 Zoom
- `zoomIn()`: `zoomFactor = ZOOM_LEVELS.firstOrNull { it > zoomFactor + 0.001 } ?: zoomFactor` — smallest level strictly greater than current (with 0.001 epsilon for float comparison); clamps at max (no-op at 1.5).
- `zoomOut()`: `zoomFactor = ZOOM_LEVELS.lastOrNull { it < zoomFactor - 0.001 } ?: zoomFactor` — largest level strictly smaller; clamps at min (no-op at 0.9).

### 3.3 Session
- `login(user: User)`: sets `currentUser = user`; `role = user.rasciFilterKey()` (so an owner logs in with the "all" chip, everyone else with their own letter); `adminMode = false` (owners default to admin mode off and flip it manually); `view = View.Dashboard`. **Does not touch `zoomFactor`** and **does not call `notifyChanged()`** — the caller must trigger the re-render.
- `logout()`: `currentUser = null`; `role = "all"`; `adminMode = false`; `view = View.Dashboard`. Same caveats: zoom preserved, no notify.

### 3.4 Creation
- `addCity(name: String): Boolean` — returns `false` if `cities` already contains the key (duplicate name), else instantiates tasks from `PhaseData.cityPhase.tasks` via `Task.fromTemplate(t, prefix = "city_$name", idx = i)` (so task ids look like `city_Amsterdam_b_0`), creates `City(name, tasks)` with `submitted=false, approved=false`, puts it in `cities`, appends name to `cityOrder`, returns `true`. No access-control check, no notify.
- `addProject(name: String, parentCity: String): Boolean` — returns `false` if the project name already exists **or** the parent city does not exist. Otherwise builds one `Phase` per entry in `PhaseData.projectPhases`, instantiating each task via `Task.fromTemplate(t, prefix = "proj_${name}_p$pi", idx = ti)` (ids like `proj_Zuidas_p0_b_3`); each `Phase` keeps a reference to its `PhaseTemplate` and starts `submitted=false, approved=false`. Registers in `projects` and appends to `projectOrder`; returns `true`. No notify.

### 3.5 Access control
- `isOwner(): Boolean` = `currentUser?.role == UserRole.OWNER` (false when logged out).
- `isApprover(): Boolean` = `isOwner()` — only the owner can approve/reject phases or new signups (kept as a separate function so the rule has one home).
- `canAccessCity(name)` = `userCanAccessCity(currentUser, name)`, `false` if logged out.
- `userCanAccessCity(u: User, name: String): Boolean` (also drives notification-recipient resolution), in order:
  1. `u.accessAllCities || u.role == UserRole.OWNER` → `true`.
  2. `name in u.cityAccess` → `true`.
  3. **Upward implication:** `true` if any project has `parentCity == name` **and** its name is in `u.projectAccess` — a project grant makes the parent city visible.
  4. else `false`.
- `canAccessProject(name)` = `userCanAccessProject(currentUser, name)`, `false` if logged out.
- `userCanAccessProject(u: User, name: String): Boolean`:
  1. `projects[name]` missing → `false` (nonexistent projects are inaccessible to everyone, including owners).
  2. `u.accessAllCities || u.role == UserRole.OWNER` → `true`.
  3. **Downward implication:** `proj.parentCity in u.cityAccess` → `true` — a city grant implies all its projects.
  4. `proj.name in u.projectAccess` → `true`; else `false`.

### 3.6 Derived listings
- `accessibleCities(): List<String>` = `cityOrder.filter { canAccessCity(it) }` — preserves `cityOrder` ordering.
- `projectsForCity(cityName): List<Project>` = walk `projectOrder`, `mapNotNull` into `projects`, keep those with `parentCity == cityName`, then keep those passing `canAccessProject` — ordered by `projectOrder`.

### 3.7 Task math
- `relevantTasks(tasks: List<Task>): List<Task>` — if `role == "all"` returns the list unchanged; otherwise keeps tasks where **any of the four fields `r`, `a`, `s`, `c` contains `role` as a substring** (`v.contains(role)`). Two critical semantics to preserve (or consciously fix) in the port: (a) the `iCol` ("I" of RASCI) and `opm` columns are **excluded** from the filter — being merely Informed does not make a task "yours"; (b) it is a **substring** match, so the `"PM"` chip also matches cells containing `"PPM"` (and any comma-separated multi-role cell works by the same mechanism).
- `progressOf(tasks: List<Task>): Double` — take `relevantTasks(tasks)`, drop `NA` tasks to form `applicable` (N/A leaves the denominator entirely); **if `applicable` is empty return `1.0`** (a fully-N/A or empty-for-this-role list counts as 100% complete); else `count(DONE) / applicable.size` as a Double in [0, 1].
- `isPhaseReady(phase: Phase): Boolean` — `rel = relevantTasks(phase.tasks)`; **empty → `false`** (a phase with nothing relevant can never be "ready"/submittable — note the asymmetry with `progressOf`, which reports 100% in the same situation); otherwise `true` iff no relevant task has `status == OPEN` (every one is DONE or NA). Because it uses `relevantTasks`, readiness depends on the currently selected role chip, not on all tasks.
- `openTaskCount(): Int` — header badge + dashboard stat. `0` when logged out. Sums `status == OPEN` counts over `relevantTasks(...)` of: (a) every accessible city's task list (iterating `accessibleCities()`, dereferencing `cities[name]!!` with a non-null assertion), then (b) every phase of every accessible project (walking `projectOrder`, filtering by `canAccessProject`). Respects both the access grants and the active RASCI chip.

### 3.8 Phase gating
- `isPhaseUnlocked(projectName: String, phaseIdx: Int): Boolean` — unknown project → `false`. **Phase index 0 (Acquisitiefase) is gated on the parent city:** returns `cities[proj.parentCity]?.approved == true` — the city's Gemeenteontwikkeling must be approved before any project work can start (municipality development precedes acquisition and happens once per city; missing city → locked). For `phaseIdx >= 1`: returns `proj.phases[phaseIdx - 1].approved` — a phase unlocks iff the previous phase is approved (note: direct index, will throw `IndexOutOfBoundsException` for out-of-range `phaseIdx` rather than returning false; callers only pass valid tab indices).

### 3.9 Phase-close helpers (used when submitting/closing a phase with open tasks)
- `markOpenTasksNa(projectName, phaseIdx): Int` — resolve phase via `getOrNull` (missing project/phase → `0`); collect all tasks with `status == OPEN`; set each to `TaskStatus.NA` in place; return the number changed.
- `moveOpenTasksToNextPhase(projectName, phaseIdx): Int` — resolve project, current phase, and next phase all via `getOrNull`; **returns `0` on the last phase** (no next) and `0` when there are no open tasks. Otherwise, WIP semantics:
  1. `open` = current phase's tasks with `status == OPEN`, in their current order.
  2. `phase.tasks.removeAll(open)` — removed from the source phase.
  3. Each moved task is mutated: `step = "WIP"` (the `WIP_STEP` const) and `blok = ""` — so all carried tasks regroup under one WIP headline in the next phase (their `blokKey` becomes `"WIP||"`). **Nothing else changes**: `status` stays OPEN, `id`, `deliverable`, RASCI fields (`r/a/s/c/iCol`), `opm`, `custom`, and the whole `attachments` list travel with the task object (same instance, no copy).
  4. `next.tasks.addAll(0, open)` — inserted as a block **at the top** of the next phase, preserving their relative order.
  5. Returns `open.size`.
- `reassignAttachments(fromDisplayName: String, toDisplayName: String): Int` — user-offboarding helper. Iterates **every** task list in the app: all `cities.values` task lists plus every phase's task list of every project (both maps are `LinkedHashMap`s, so insertion order). For every attachment on every task, if `att.addedBy == fromDisplayName` (exact string match on display name — attachments have no user-id foreign key), set `att.addedBy = toDisplayName` and count it. Returns total reassigned.

### 3.10 Approval inbox queries
- `pendingCitySubmissions(): List<City>` — walk `cityOrder`, `mapNotNull` into `cities`, keep those with `submitted && !approved`. (Cities awaiting the owner.)
- `pendingPhaseSubmissions(): List<Triple<Project, Int, Phase>>` — walk `projectOrder`; for each project, `forEachIndexed` over its phases; append `Triple(proj, idx, ph)` for every phase with `ph.submitted && !ph.approved`. Ordered by project order, then phase index. (The `Int` is the phase index, needed for navigation/labels.)

Note: nothing in these files ever *sets* `submitted`/`approved` — the submit/approve/reject mutations live elsewhere (UI/controller layer); `AppState` only stores the flags and derives from them.

---

## 4. Listener / re-render mechanism

- `private val listeners: MutableList<() -> Unit>` on `AppState`.
- `fun onChange(block: () -> Unit)` — appends a zero-arg callback; **no unsubscribe API**, listeners live for the process lifetime.
- `fun notifyChanged()` — synchronously invokes every listener in registration order.

This is a bare pub/sub with **manual** invalidation: none of the `AppState` mutators (`login`, `logout`, `addCity`, `addProject`, `markOpenTasksNa`, `moveOpenTasksToNextPhase`, `reassignAttachments`, `zoomIn`/`zoomOut`, direct field writes) call `notifyChanged()` themselves. The convention is: mutate state (often directly on the public mutable fields/collections), then the caller fires `notifyChanged()` once, and the registered listener(s) re-render the whole UI from state. In the Electron/React port this maps naturally to a single store (e.g. Zustand/Redux) where every mutation shown above becomes an action and the manual `notifyChanged` discipline disappears; the fine-grained mutability documented per-field above tells you exactly which properties must live in the store versus which are immutable identifiers.

---

## 5. Cross-cutting migration notes (facts observed in code, not opinions)

1. **Identity is name-based everywhere**: cities and projects are keyed by display name; `Attachment.addedBy` and `reassignAttachments` match on user display name; renames would orphan references. No numeric/UUID keys except generated task/attachment ids.
2. **ID generation** relies on `System.currentTimeMillis()` + an in-memory counter that resets each launch (`Task.custom`, `Attachment.from`); `Task.fromTemplate` ids are deterministic (`prefix_b_idx`), which means two projects with the same name (prevented) or re-created entities would reuse ids.
3. **Persistence surface**: only `TaskTemplate`/`PhaseTemplate` are `@Serializable`; all live state (`Task`, `City`, `Phase`, `Project`, `Attachment`, `User`, `AppState`) is plain in-memory mutable objects — these files contain no save/load.
4. **Substring RASCI matching** (`"PM"` matches `"PPM"`) and the **empty-list asymmetry** (`progressOf` → 1.0 but `isPhaseReady` → false) are load-bearing rules to replicate or deliberately change.
5. `Attachment.kind` is computed once at creation and never re-derived even though `url` is mutable.
6. `View.ProjectView.phaseIdx` is a mutable `var` on a data class — replace with immutable navigation state in React.