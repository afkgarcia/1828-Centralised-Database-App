# Migration Audit — 1828 Fasedocument Tracker (Kotlin/JavaFX v0.9.0 → Electron + TypeScript + React)

Audited tree: `/Users/alessandrogarcia/Desktop/GarciaGaspar/1828/desktop-app` (all 25 Kotlin files under `src/main/kotlin`, the `AccessCheck` harness under `src/test/kotlin`, `phases.json`, `app.css`, Gradle build files). Every claim below was verified against the actual code; line numbers are exact for the current tree.

Stack: Kotlin 1.9.22 / JVM 17, JavaFX 21.0.2 (controls only), Apache POI 5.2.5, kotlinx-serialization 1.6.3, jakarta.mail 2.1.3 + angus-mail 2.0.3, log4j 2.22.1 (`build.gradle.kts:1-40`, version `0.9.0` at line 9).

---

## Part 1 — Complete inventory (classes, fields, functions, rules)

### 1.1 `app/model/Models.kt`

| Construct | Members (type, mutability) | Semantics |
|---|---|---|
| `enum TaskStatus` | `OPEN, DONE, NA` | Tri-state task lifecycle. UI cycles OPEN→DONE→OPEN and NA→OPEN via the checkbox; a separate N/A pill toggles NA↔OPEN. |
| `@Serializable data class TaskTemplate` | `row: Int = 0`, `step: String`, `blok: String`, `deliverable: String`, `existingLink: String`, `r/a/s/c/i: String`, `opm: String` (all `val`, defaulted `""`/`0`) | Raw row from `phases.json`, mirrors the client's xlsx. `row` and `opm` are **never used at runtime** (see Findings 11.3, 11.4). |
| `@Serializable data class PhaseTemplate` | `sheet: String`, `tasks: List<TaskTemplate>` | One sheet of the phase document. |
| `class Task` (lines 31–84) | `id: String` (val), `step/blok/deliverable/r/a/s/c/iCol/opm: String` (all **var**), `status: TaskStatus` (var, default OPEN), `attachments: MutableList<Attachment>` (val list, mutable contents), `custom: Boolean` (val, default false) | Live mutable task. `custom=true` rows are admin-created and deletable; base rows are not. |
| `Task.blokKey: String` (get, line 48) | — | Grouping key `"$step||$blok"` — **magic `"||"` delimiter** (Finding 12.1). |
| `Task.fromTemplate(tmpl, prefix, idx): Task` (51–65) | — | `id = "${prefix}_b_$idx"` (prefix embeds the city/project **name**). If `tmpl.existingLink` is non-blank it becomes an `Attachment` with `addedBy = "Fasedocument"` (hardcoded, line 63) — see Finding 9.1 for why this produces 302 garbage attachments. |
| `Task.custom(blokKey, deliverable): Task` (67–82) | `private var counter = 0` (companion, mutable, not thread-safe) | `id = "c_${System.currentTimeMillis()}_$counter"` (line 74). Splits `blokKey` on `"||"` with a fallback for malformed keys. |
| `class City` (89–94) | `name: String` (val), `tasks: MutableList<Task>` (val), `submitted: Boolean` (var), `approved: Boolean` (var) | One Gemeenteontwikkeling checklist per city; gates all projects in the city. |
| `class Phase` (97–102) | `template: PhaseTemplate` (val), `tasks: MutableList<Task>` (val), `submitted: Boolean` (var), `approved: Boolean` (var) | Project phase with formal approval flags. |
| `class Project` (104–109) | `name: String` (val), `parentCity: String` (**var** — mutable but nothing ever mutates it), `phases: MutableList<Phase>` (val) | Projects always live under a city, referenced **by city name string**. |

### 1.2 `app/model/User.kt`

| Construct | Members | Semantics |
|---|---|---|
| `enum UserRole` | `OWNER, PM, OM, PO, PPM, MT` | Account role. Comment says "OWNER — Ernest… only approver"; `MT` comment says "Management team member", but the UI string calls MT "goedkeurder/approver" (contradiction — Finding 4.4). |
| `enum UserStatus` | `PENDING, ACTIVE, REJECTED` | Signup pipeline states. |
| `class User` | `email: String` (val, canonical lowercase), `passwordHash: String` (**var**), `displayName: String` (val), `role: UserRole` (**var**), `status: UserStatus` (var), `accessAllCities: Boolean` (var), `cityAccess: MutableSet<String>` (val set of **city names**), `projectAccess: MutableSet<String>` (val set of **project names**; never populated by any UI — write-only feature) | No user ID: **email is the primary key, displayName is the attachment-ownership key** (Finding 3.1). No `equals` override → identity comparisons are reference equality (`UserAdminView.kt:57,93`). |
| `User.rasciFilterKey(): String` | — | OWNER→`"all"`, otherwise the enum name (`"OM"/"PO"/"PM"/"PPM"/"MT"`). Used to preset `AppState.role` at login. |

### 1.3 `app/state/AppState.kt` — singleton mutable global state

`sealed class View` (12–25): `Dashboard` (object), `CityDetail(name: String)`, `ProjectView(projectName: String, var phaseIdx: Int = 0)` (**mutable `var` inside a data class**, mutated in place at `ProjectView.kt:24`), `Approvals`, `UserAdmin`, `Outbox` (objects). Routing = a single `var view: View` (line 45). Navigation is by **name strings**, not IDs.

`object AppState` fields (all mutable, in-memory only):
- `currentUser: User?` (29), `role: String` (32, RASCI chip: `"all"` or a letter key), `adminMode: Boolean` (35), `view: View` (45)
- `ZOOM_LEVELS = listOf(0.9, 1.0, 1.15, 1.3, 1.5)` (40), `zoomFactor: Double = 1.0` (41), `zoomIn()/zoomOut()` (42–43, epsilon `0.001` comparisons)
- `cityOrder: MutableList<String>` (47), `cities: MutableMap<String, City>` (48), `projectOrder: MutableList<String>` (50), `projects: MutableMap<String, Project>` (51) — order lists + maps keyed by name, kept in sync by hand
- `listeners: MutableList<() -> Unit>` (53), `onChange(block)` (54), `notifyChanged()` (55) — the entire reactivity system: one global callback list, never deregistered

Functions and exact rules:
- `login(user)` (57–63): sets `currentUser`, presets `role = user.rasciFilterKey()`, `adminMode = false`, `view = Dashboard`. `logout()` (65–70) resets those (but **not** `LoginView`'s static card state — Finding 5.3).
- `addCity(name): Boolean` (72–80): rejects duplicate key (case-sensitive — `"leiden"` and `"Leiden"` coexist), instantiates `PhaseData.cityPhase` tasks with prefix `"city_$name"`.
- `addProject(name, parentCity): Boolean` (82–94): rejects duplicates **globally** — two different cities cannot both have a project called "Centrum" (implementation detail leaking into business rules); prefix `"proj_${name}_p$pi"`.
- `isOwner()` (98), `isApprover() = isOwner()` (100) — despite UI text claiming MT approves.
- `canAccessCity/userCanAccessCity` (102–111): true if `accessAllCities` or OWNER; or name ∈ `cityAccess`; or the user can access any project under the city. `canAccessProject/userCanAccessProject` (113–122): OWNER/all-cities; or `parentCity ∈ cityAccess`; or name ∈ `projectAccess`. Also drives notification recipient resolution.
- `openTaskCount(): Int` (125–139): full scan of every accessible city + project, **filtered by the active RASCI chip** (`relevantTasks`) — so the header badge changes when the user clicks a filter chip. Recomputed on every render.
- `accessibleCities()` (141), `projectsForCity(cityName)` (142–145).
- `relevantTasks(tasks)` (150–153): if `role == "all"` all; else keeps tasks where any of `r,a,s,c` **`.contains(role)`** — substring matching. **Bug: `"PPM".contains("PM") == true`**, so the PM filter also matches all 36 PPM-tagged tasks (Finding 9.2). The `i` column is deliberately excluded from filtering.
- `progressOf(tasks)` (156–162): done / applicable, N/A excluded from denominator; **empty ⇒ 1.0** (100 % progress for a phase with no applicable tasks).
- `isPhaseUnlocked(projectName, phaseIdx)` (167–171): phase 0 requires `cities[parentCity].approved == true` (city gate); phase i>0 requires `phases[i-1].approved`.
- `pendingCitySubmissions()` (174–175): `submitted && !approved`.
- `isPhaseReady(phase)` (177–181): relevant tasks non-empty and none OPEN.
- `const val WIP_STEP = "WIP"` (184) — **placeholder headline, final title explicitly "pending from Ernest"** (comment line 183, Finding 4.1).
- `markOpenTasksNa(projectName, phaseIdx): Int` (187–192): flips every OPEN task to NA, returns count.
- `moveOpenTasksToNextPhase(...): Int` (197–207): removes OPEN tasks from phase i, sets `step = WIP_STEP; blok = ""` (**destructive — original step/blok lost forever**, line 204), prepends to phase i+1. Returns 0 on last phase.
- `reassignAttachments(fromDisplayName, toDisplayName): Int` (211–226): scans every task list in every city and project phase and rewrites `attachment.addedBy` **matched by displayName string** (Finding 3.1).
- `pendingPhaseSubmissions(): List<Triple<Project, Int, Phase>>` (229–238).

### 1.4 `app/auth/AuthService.kt` — singleton, in-memory, self-declared prototype-only

Header comment (lines 8–9): *"Suitable for the prototype only — no persistence, passwords stored as SHA-256 (not salted). Wire to a real backend before deploying."*

- `users: LinkedHashMap<String, User>` (11) keyed by lowercase email; `init { seed() }`.
- `seed()` (15–42): **three demo accounts with plaintext-derivable passwords**: `ernest@1828.nl` / `"ernest"` (OWNER, ACTIVE, `accessAllCities=true`), `pia@1828.nl` / `"test"` (PM, ACTIVE, `cityAccess={"Leiden"}`), `niels@1828.nl` / `"test"` (OM, PENDING).
- `login(email, password): LoginResult` (46–55): lowercases/trims email, compares `hash(password)` string equality, then maps status → `Ok(user) | Pending | Rejected`; plus `UnknownEmail | BadPassword`. **Distinguishes unknown-email from bad-password** (account enumeration).
- `signup(email, password, displayName, requestedRole): SignupResult` (57–71): email valid iff non-blank and contains `"@"`; **password policy = length ≥ 4** (line 60); duplicate check; new user is PENDING. displayName defaults to the email local part. Any role incl. MT can be requested (OWNER excluded only by the UI choice list). **No displayName uniqueness check.**
- `all()` (73), `pending()` (74).
- `approve/reject/setRole(email…)` (76–78): mutate status/role. **These do NOT lowercase/trim the email**, unlike `login`/`remove`/reset — inconsistent canonicalization (safe today only because callers pass `u.email`).
- Password reset (80–100): `resetCodes: MutableMap<String, String>` (82). `requestPasswordReset(email): String?` (85–91): 6-digit code via `(100000..999999).random()` — **kotlin.random.Random, not SecureRandom** (line 87); stores code, emails it via `Notifications.passwordReset`, and **returns the code to the caller "(for tests)"** (doc line 84) — Finding 2.4. `completePasswordReset(email, code, newPassword): ResetResult` (93–100): exact string match on trimmed code, min length 4, single-use (code removed). **No expiry, no attempt limit, no rate limiting** — a 6-digit code with unlimited tries is brute-forceable.
- `changePassword(email, current, newPassword): ChangeResult` (102–109): verifies current, min length 4. Returns `BadCurrent` for unknown email too.
- `remove(email): Boolean` (114–121): refuses OWNER ("Ernest is the safety anchor"), removes user + any reset code.
- Sealed results: `ResetResult{Ok,UnknownEmail,BadCode,WeakPassword}`, `ChangeResult{Ok,BadCurrent,WeakPassword}`, `LoginResult{Ok(user),UnknownEmail,BadPassword,Pending,Rejected}`, `SignupResult{Ok(user),InvalidEmail,WeakPassword,AlreadyExists}` (123–148).
- `hash(s): String` (150–153): **unsalted single-round SHA-256**, hex via `"%02x".format` — Finding 2.1.

### 1.5 `app/notify/EmailService.kt`

- `enum NotifyEvent` (11): `DELIVERABLE_SUBMITTED, APPROVAL_REQUESTED, PHASE_APPROVED, PHASE_REJECTED, PASSWORD_RESET`.
- `class EmailMessage` (13–21): `event`, `from: String`, `to: List<String>`, `subject`, `body`, `timestamp: LocalDateTime = now()` (no timezone), `@Volatile var deliveredVia: String = "outbox"` — delivery status modeled as a **display string mutated cross-thread**: `"outbox"` → `"SMTP…"` → `"SMTP ✓"` / `"SMTP ✗ (${e.message.take(60)})"` (lines 79, 104, 106), emoji baked into data.
- `object EmailService`: `outbox: MutableList<EmailMessage>` (28, newest first via `add(0, …)`); `dataDir` (30–32) = `-Dtracker.data.dir` or `~/.1828-tracker`; `outboxDir()` (34) = `<dataDir>/outbox`, `mkdirs()` on access.
- `visibleTo(userEmail, isOwner)` (36–37): **owner sees the entire outbox including other users' password-reset emails** (Finding 2.3); others see mail where `userEmail in it.to` (exact case-sensitive match).
- `send(event, from, to, subject, body)` (39–45): appends to outbox, `runCatching { writeEml(msg) }` (**silently swallows I/O errors**), then `sendSmtpIfConfigured`.
- `writeEml` (51–67): filename `yyyyMMdd_HHmmss_SSS` + 40-char subject slug (same-millisecond duplicate subject silently overwrites); hand-rolled RFC 822 with RFC 2047 Base64-encoded subject (emoji-safe); body plaintext UTF-8. **Reset codes land as plaintext .eml files on disk.**
- `smtpConfig` (71–74): `by lazy` read of `<dataDir>/smtp.properties` — **read once per process; edits require restart; SMTP password stored in plaintext on disk** and loaded into memory (line 91).
- `sendSmtpIfConfigured` (76–111): fire-and-forget **raw daemon `Thread` per email** (no queue, no retry, no shutdown handling); auth iff `username` present; `starttls` default `"true"`, host default `"localhost"`, port default `"587"`, `from` overridable by config; after send mutates `deliveredVia` and refreshes UI via `try { Platform.runLater { AppState.notifyChanged() } } catch (_: Throwable) {}` (line 109) — **catch-Throwable guard for headless callers** (Finding 7.2).

### 1.6 `app/notify/Notifications.kt`

- `stamp = DateTimeFormatter.ofPattern("dd-MM-yyyy HH:mm")` (18) — hardcoded NL-style timestamp, no locale/zone (Finding 6.2).
- Recipient rules: `activeOwners()` (20–24) = ACTIVE OWNERs; `projectTeam(projectName)` (26–31) = ACTIVE non-OWNERs with project access. **The RASCI `i` (informed) column plays no part in recipients** — recipients derive purely from access grants.
- `deliverablesSubmitted(contextLabel, tasks)` (33–61): to owners; subject singular/plural templates; body lists tasks + attachments; sent when a checkbox flips to DONE (`TaskRow.kt:66-68` — **one email per checkbox tick**; re-ticking re-sends) or as one digest from "mark all" (`TaskListView.kt:143`). Requires `AppState.currentUser` (silently no-ops otherwise).
- `approvalRequested(projectName, phaseIdx)` (63–87): to owners; includes every attachment in the phase.
- `phaseApproved/phaseRejected` → `phaseDecision` (161–188): to project team, falling back to owners; on approve names the next unlocked phase or "last phase".
- `cityApprovalRequested(cityName)` (93–114), `cityDecision(cityName, approved)` (117–139): city-gate equivalents; city team = ACTIVE non-OWNERs with city access.
- `passwordReset(user, code)` (142–159): from hardcoded **`"noreply@1828.nl"`** (line 154); body contains the code in plaintext (line 146).

### 1.7 `app/data/PhaseData.kt` + `phases.json`

`object PhaseData`: `all: List<PhaseTemplate> by lazy` from classpath `phases.json` (`Json { ignoreUnknownKeys = true }`); `cityPhase = all[0]` (Gemeenteontwikkeling); `projectPhases = all.drop(1)` (Acquisitiefase → Garantiefase). Hard assumption: element 0 is the city phase.

`phases.json`: 10 phases, 338 tasks — Gemeenteontwikkeling 26, Acquisitiefase 27, Haalbaarheidsfase 22, Ontwikkelfase VO 49, DO 52, TO 33, UO 26, Verkoopfase 26, Realisatiefase 51, Garantiefase 26. Raw RASCI values found: `OM, PM, PO, PPM, MT, MT/PO, PO/MT, PP, DENISE + PO` — includes a **personal name ("DENISE")**, a probable typo (`PP`), and inconsistent separators (Finding 9.3). All 338 `opm` fields are empty. 302 of 338 `existingLink` fields contain **Dutch descriptions, not URLs** (Finding 9.1).

### 1.8 `app/export/ExcelExport.kt`

`object ExcelExport.write(target: File)`: POI workbook with an Overview sheet (date + city/project name lists, mixed-language "Steden:"/"Projecten:" labels, lines 26–27), one sheet per city (`"City_$name"`), one sheet per project phase (`"${pname.take(10)}_P${pi+1}_$phaseTitle"` → `WorkbookUtil.createSafeSheetName(...).take(31)` — **duplicate sheet names throw** if two projects share their first 10 chars, Finding 12.4). Columns (69–72): Step, Blok, Deliverable, Status, Documents (name — url joined by `"; "`), R, A, S, C, I, Custom; **`opm` is not exported**. Status labels bilingual hardcoded `"Klaar / Done"`, `"N.v.t. / N/A"`, `"Open"` (98–102). Column widths magic list `[8,32,46,14,36,6,6,6,6,6,8]` (105). Header style: white bold on `IndexedColors.DARK_BLUE`. **Exports every city and project regardless of the current user's access grants** (30–63) — Finding 2.6.

### 1.9 UI layer (`app/ui`) — all singleton `object`s building fresh scene graphs

- **`Main.kt`** (`FasedocumentTrackerApp`): 1280×840 scene; seeds 3 cities + 3 projects and 4 demo attachments **with hardcoded owner displayName strings `"Ernest"` / `"Pia (PM)"`** (lines 24–48); marks Leiden fully DONE + approved. `mount` (50–63): `root.children.clear()` + full rebuild of either `LoginView` or `MainView` on **every** `notifyChanged()`; root font size `String.format(Locale.ROOT, "-fx-font-size: %.2fpx;", 13.0 * zoomFactor)` (55) — `Locale.ROOT` is deliberate (decimal point, not comma). Registered once via `AppState.onChange(mount)`.
- **`MainView`**: routes on `AppState.view`; wraps content + `ExportPanel` in a `ScrollPane` (rebuilt every render → **scroll position resets on every state change**). Line 25: `val stage = (mainCard.scene?.window as? Stage)` — `mainCard` is not yet in a scene, so this is **always null**; the file chooser is always unparented (latent dead code).
- **`LoginView`**: static mutable UI state `mode: Mode {LOGIN, SIGNUP, RESET}` (24), `resetStep: Int` (27), `resetEmail: String` (28) — survives logout (Finding 5.3). Login card shows **`demoHint` = "Demo: ernest@1828.nl / ernest"** — live credentials printed on the login screen (Finding 2.2). Reset step 2 offers an **"Open e-mailmap" button pre-authentication** (133–136) that opens the outbox folder containing everyone's reset codes (Finding 2.5). Signup role choices exclude OWNER (184–190).
- **`HeaderBar.kt`** (`headerBar(showBack, showAdminToggle, showAuthControls)`): title `Label("1828 · Fasedocument Tracker")` **hardcoded, not `t("appTitle")`** (21) so the NL/EN toggle never translates it; version badge `Label("v0.9 desktop")` hardcoded (22), duplicating `build.gradle.kts` version. Open-task badge, outbox button with count, owner-only Approvals (count = phases + cities + signups) and Users buttons, back button with parent-city routing, admin toggle, change-password dialog (`changePasswordDialog`, 120–154), logout, `zoomControl()` (157–178), `langToggle()` (181–196, flips `Strings.lang` global).
- **`DashboardView`**: private `stamp = "dd-MM HH:mm"` (26) — a **second, different** hardcoded date format. Stats strip (`statTile`, duplicated with `ExportPanel.stat`); owner approval queue capped at `take(4)` cities + `take(4)` phases (62, 81); city grid (`cityCard` hardcodes the string `"Gemeenteontwikkeling · …"` at 188 — untranslated); activity feed `take(5)` (126). `promptAddCity` dialog title hardcoded `"1828"`.
- **`CityDetailView`**: city banner (approve/reject/withdraw/reopen — logic **duplicated** from ProjectView and ApprovalsView, Finding 10.1); `trySubmitCity` (167–194) duplicates `ProjectView.trySubmit` minus the move-to-next option; **pluralization hack** line 212: `if (phases.size == 1) t("phaseLabel") else "${t("phaseLabel")}n"` — appends `"n"` to make Dutch "fasen", producing **"phasen"** in English (Finding 6.4).
- **`ProjectView`**: phase tab strip with status emoji (🔒 ✅ 🟡 🟢 🔵 ⚪, lines 87–94); mutates `View.ProjectView.phaseIdx` in place (24); approval banner state machine (119–181); `trySubmit` two-step dialogs (184–224) → `markOpenTasksNa` or `moveOpenTasksToNextPhase`; `approve`/`reject` (232–249) re-check `isApprover` and send notifications.
- **`ApprovalsView`** (owner-gated at build, line 21): city submissions then phase submissions with doc chips, Approve/Reject/Open buttons whose handlers **duplicate** the banner handlers; signup approvals section.
- **`UserAdminView`** (owner-gated): per-user row with status chip; role `ChoiceBox` fed `UserRole.values()` — **includes OWNER**, so the owner can mint additional owners, contradicting the "Ernest is the only owner" seed comment; self-demotion prevented only by reference equality `u == AppState.currentUser` (57). Access chips: "All" toggle + one chip per city name (mutates `u.accessAllCities` / `u.cityAccess` directly, no service layer). `promptRemoveUser` (143–196): choose ACTIVE replacement (owner sorted first) → `AppState.reassignAttachments(u.displayName, replacement.displayName)` → `AuthService.remove`.
- **`OutboxView`**: third private `stamp = "dd-MM-yyyy HH:mm"` (36); rows expand on click to reveal the **full body — including password-reset codes — to the owner** (62–88).
- **`TaskListView`**: groups tasks by `blokKey` in a LinkedHashMap; per-blok admin toolbar (reorder ▲▼ via full-list regroup, `+ Regel toevoegen`); `roleFilterBar()` chips `all/OM/PO/PM/PPM/MT` — the chip values must match RASCI cell substrings; `markAllControls`/`applyMarkAll` (115–145) set all relevant non-NA tasks and send one digest email. **Unused import `javafx.scene.control.Alert` (line 8)**. Contains a re-implementation of the substring filter (line 32) duplicating `AppState.relevantTasks`.
- **`TaskRow.kt`**: `sealed class TaskCtx { CityCtx(cityName), ProjectCtx(projectName, phaseIdx) }` with `list()` (non-null asserted map lookups), `isLocked()` (submitted or approved), `label()` for email context. Row = tri-state button + N/A pill + name + RASCI tags (R/A/S/C only — **`iCol` never shown anywhere in the UI**) + attachment cell + admin reorder/delete. Checking a box fires `Notifications.deliverablesSubmitted` immediately (66–68).
- **`AttachmentUi.kt`**: `kindIcon`/`kindLabel` (Google kinds untranslated by design); `docChip` (46–62) click-to-open, ✕ remove when not locked — **any user may delete any attachment; no ownership check**; `attachmentCell` fixed 260 px column; `promptAttach` (84–112) URL validation is literally `url.isBlank() || "." !in url` (line 104) — `javascript:alert(1).x` passes; `addedBy = user?.displayName ?: "?"` (109); `reviewDocsStrip` for submitted/approved phases.
- **`ExportPanel`**: aggregate counts use `relevantTasks` (RASCI-filtered) while the actual export is unfiltered — the numbers shown next to the button don't describe the file; `runExport` via `FileChooser`, `initialFileName = "fasedocument_${LocalDate.now()}.xlsx"` (ISO date). Unused import `Region` (line 14). Rendered for **every** user.
- **`WebOpen`**: `var host: HostServices?` injected by Main; fallback `ProcessBuilder` per OS — Windows branch `cmd /c start <url>` is **command-injection-prone** with attacker-controlled URLs (line 21) and all failures are swallowed by `runCatching`.
- **`Strings.kt`**: `object Strings`, `var lang: Lang = Lang.NL` (global mutable, default NL), two ~240-key string tables, `t(key)` falls back EN→NL→raw key. Templating is naive `String.replace("{n}", …)`. Keys of note: `demoHint` (credentials), `needsApprover` ("Only MT (approver) or admin can approve" — **false**, only OWNER can), `roleMT` ("— goedkeurder/approver" — also false), `optMoveNext` exposes the "WIP" wording, `resetCodeSent` admits "in this demo: the outbox folder".
- **`app.css`** (537 lines): documented palette (navy `#1A1A2E`, teal `#2A9D8F`, cyan `#0E7490`, gold `#F0C040`, red `#D93025`, Google-ish greys); all font sizes `em` off a single 13 px root (the zoom mechanism); light theme only.

### 1.10 Test harness — `src/test/kotlin/app/AccessCheck.kt`

Not a test framework: a `main()` run by the custom Gradle task `accessCheck` (`build.gradle.kts:53-58`) that **prints** ~60 labeled values with zero assertions — regressions are only caught by a human reading the output. It logs in with the seeded plaintext passwords, exercises reset (using the code returned by `requestPasswordReset`), removal/handover, WIP moves, and the city gate. Sets `-Dtracker.data.dir` to `build/tmp/tracker-check` to protect the real outbox.

---

## Part 2 — Findings: what must NOT be carried over as-is

Legend for the recommendation column: **FIX** = redesign during migration; **CARRY** = port knowingly as an accepted interim behavior (documented); **DROP** = delete, do not port.

### 2. Security

| # | Location | Issue | Why fragile | Rec |
|---|---|---|---|---|
| 2.1 | `AuthService.kt:150-153` (+ header 8–9) | Passwords hashed with **unsalted, single-iteration SHA-256** | Rainbow-table/brute-forceable; identical passwords share hashes; the code itself says "prototype only". Also string-equality compare (`:49,105`) is trivially timing-observable. | **FIX**: argon2id/bcrypt server-side; never hash in the renderer. |
| 2.2 | `AuthService.kt:17-41`; `LoginView.kt:92` + `Strings.kt:36,272`; `README.md` demo table | Seeded accounts `ernest/ernest`, `pia/test`, `niels/test`; the login screen **prints the owner's credentials** (`demoHint`) | Guessable owner credentials shipped in-product and documented. | **DROP** the seeds and `demoHint` key entirely; seed via a first-run/admin provisioning flow. |
| 2.3 | `EmailService.kt:36-37` + `OutboxView.kt:62-88` + `Notifications.kt:142-159` | **Password-reset codes are visible in the owner-facing outbox**: `visibleTo(_, isOwner=true)` returns the whole outbox, and clicking a row reveals the body with the 6-digit code | The owner (or anyone at the owner's screen) can hijack any account mid-reset. Codes are additionally written as plaintext `.eml` files in `~/.1828-tracker/outbox`. | **FIX**: exclude `PASSWORD_RESET` from any in-app mailbox and from disk; real email delivery only. |
| 2.4 | `AuthService.kt:84-91` | `requestPasswordReset` **returns the reset code** "(for tests)"; `AccessCheck.kt:102-113` depends on it | Any caller of the auth API obtains the secret; the test convenience is an API-shaped backdoor. Code is also generated with `kotlin.random.Random`, has **no expiry and no attempt limit** (`:93-100`). | **FIX**: return only success/failure; CSPRNG; TTL + attempt counter + rate limit. Rewrite tests against an outbox test double. |
| 2.5 | `LoginView.kt:133-136`; `Strings.kt:201,437` | Pre-auth "Open e-mailmap" button opens the on-disk outbox folder from the login screen | Unauthenticated local access to every sent mail, incl. all reset codes. The `resetCodeSent` string institutionalizes it ("in this demo: the outbox folder"). | **DROP** in Electron. |
| 2.6 | `ExcelExport.kt:30-63` + `MainView.kt:26-28` | Excel export dumps **all cities/projects for any logged-in user**, bypassing `canAccessCity/Project`; ExportPanel is rendered for everyone | City/project access control is nullified by one click. Panel stats (`ExportPanel.aggregate` :55–72) are additionally RASCI-filtered while the file is not — misleading. | **FIX**: filter export by the requesting user's grants (or owner-only), align the stats. |
| 2.7 | `AttachmentUi.kt:104` + `WebOpen.kt:10-24` | Attachment URL "validation" = contains a dot; opened via `HostServices`/`ProcessBuilder`; Windows fallback `cmd /c start <url>` | `javascript:`/`file:`/UNC URLs pass; on the fallback path a crafted URL can inject shell metacharacters. In Electron this becomes `shell.openExternal` — a classic RCE-adjacent hole. | **FIX**: parse with the WHATWG URL parser, allowlist `https:`/`http:`, never build shell strings. |
| 2.8 | `AuthService.kt:48` | `login` distinguishes `UnknownEmail` from `BadPassword`; `Strings` has separate user-facing messages (`loginFailUnknown`/`loginFailPassword`) | Account enumeration. | **FIX**: single "invalid credentials" message. |
| 2.9 | `EmailService.kt:71-74,91` | `smtp.properties` holds the SMTP **password in plaintext** in the home dir; loaded once via `lazy` | Secret on disk; config edits need an app restart. | **FIX**: OS keychain via Electron `safeStorage`; hot-reloadable config. |
| 2.10 | `AttachmentUi.kt:46-62` | Any non-locked attachment is deletable by **any** user (`removable = !locked`), no ownership/audit | Silent destruction of colleagues' evidence links; no undo, no log. | **FIX**: permission check + audit trail in migration. |
| 2.11 | `UserAdminView.kt:53-62` | Role dropdown includes `OWNER` (`UserRole.values()`); owner can promote anyone to OWNER; owners can never be removed (`AuthService.kt:117`) | Contradicts the "Ernest is the only owner" invariant; an accidental promotion is irreversible through the UI (unremovable, and only self-demotion is blocked). | **FIX**: exclude OWNER from assignable roles or make ownership transfer an explicit flow. |

### 3. Identity, ID generation, sync implications

| # | Location | Issue | Why fragile | Rec |
|---|---|---|---|---|
| 3.1 | `Attachment.kt:32` (`var addedBy: String` = displayName), `AppState.reassignAttachments:211-226`, `UserAdminView.kt:181`, `Main.kt:32-40` (`"Ernest"`, `"Pia (PM)"` literals), `AttachmentUi.kt:109` (`?: "?"`), `Models.kt:63` (`"Fasedocument"`) | **Attachment ownership keyed by displayName strings**, not user IDs | displayNames are not unique (signup never checks); renaming a user (not supported, but will be) orphans ownership; removal requires a full-tree rewrite scan; two users named "Jan" alias each other; the sentinel owners `"?"` and `"Fasedocument"` collide with any real user of that name and would be mass-reassigned by `reassignAttachments`. | **FIX**: attachments reference `userId`; display name resolved at render time; handover becomes a single FK update. |
| 3.2 | `Models.kt:74` (`"c_${System.currentTimeMillis()}_$counter"`), `Attachment.kt:44` (`"att_${System.currentTimeMillis()}_$counter"`) | IDs from **wall-clock millis + a per-class static counter** that resets to 0 every launch | Collisions across restarts/machines are likely once data persists or syncs (two clients, same millisecond, both counters at 1); counters aren't thread-safe; clock rollback breaks monotonicity. Fine only because nothing is ever persisted today. | **FIX**: UUIDv4/ULID (ULID if sortable IDs wanted for sync). |
| 3.3 | `Models.kt:52` (`"${prefix}_b_$idx"`), `AppState.kt:75,87` (`"city_$name"`, `"proj_${name}_p$pi"`) | Template-task IDs embed **user-entered city/project names** and list position | Renaming a city/project (inevitable feature) would change every task ID; a project named `x_p1` can collide with `x` phase-1 prefixes; index-based suffix breaks if templates are ever versioned/reordered. | **FIX**: opaque entity IDs; store template provenance (`templateRow`) separately. |
| 3.4 | `AppState.kt:47-51`, `View.CityDetail(name)/ProjectView(projectName…)` (`AppState.kt:16-18`), `Project.parentCity: String`, `User.cityAccess/projectAccess: MutableSet<String>` | **All entity references are name strings**: routing, hierarchy, access grants, order lists | No rename ever; case-sensitive duplicates (`addCity("leiden")` vs `"Leiden"`) silently coexist and grants match only exact strings; global project-name uniqueness across cities is an accidental business rule (`AppState.kt:83`); deletion of cities/projects doesn't exist at all (grants/orders would dangle). | **FIX**: IDs + referential integrity in the migrated data model; per-city project-name scoping is a product question to raise. |
| 3.5 | `User.kt` (no id), `UserAdminView.kt:57,93` (`u == AppState.currentUser`) | User identity = email; self-checks use **reference equality** on unhashed `User` class | Works only because the same object instance flows everywhere in-process; breaks the moment users are (de)serialized, fetched, or duplicated. Email-as-PK also blocks email changes. | **FIX**: stable `userId`; compare by ID. |

### 4. "WIP" and other hardcoded labels awaiting client input

| # | Location | Issue | Rec |
|---|---|---|---|
| 4.1 | `AppState.kt:183-184` `const val WIP_STEP = "WIP"`; applied at `:204` (`step = "WIP"; blok = ""`); surfaced via `Strings` `optMoveNext` ("Verplaats naar volgende fase (WIP)") and `AccessCheck.kt:155-157` | Placeholder headline for carried-over tasks; comment says **"Final title pending from Ernest"**. The move is also destructive — original `step`/`blok` are overwritten, so once approved-and-moved twice, provenance is gone. | **FIX**: make the carried-over group label a configurable string (client decision pending); preserve original step/blok in dedicated fields (`carriedFromPhase`, `originalStep`). |
| 4.2 | `HeaderBar.kt:21` (`"1828 · Fasedocument Tracker"` literal, bypasses `t("appTitle")`), `HeaderBar.kt:22` (`"v0.9 desktop"`), `DashboardView.kt:188` (`"Gemeenteontwikkeling · …"`), `TaskListView.kt:73` / `DashboardView.kt:206` / `CityDetailView.kt:244` (dialog titles `"1828"`), `ExcelExport.kt:24-27,98-102` (mixed NL/EN sheet labels) | Untranslated/duplicated literals sprinkled outside the string table; version badge duplicates `build.gradle.kts:9`. | **FIX**: single i18n catalog; version injected from package.json at build time. |
| 4.3 | `Notifications.kt:154` `"noreply@1828.nl"` | Hardcoded sender address (the only place an email "from" is invented). | **FIX**: config value. |
| 4.4 | `Strings.kt:89,325` (`needsApprover`: "Only MT (approver) or admin can approve"), `Strings.kt:47,283` (`roleMT`: "— goedkeurder/approver") vs `AppState.kt:100` (`isApprover() = isOwner()`) | UI text promises MT approval rights that the code never grants — leftover from a pre-owner-model iteration; a real open product question (who approves?). | **FIX**: resolve with client; align text and rule. |
| 4.5 | `Strings.kt` NL/EN tables (~240 keys, hand-maintained parallel maps), `t()` silently falls back to NL then to the raw key | Missing-key typos ship silently as raw keys; `{n}`-style replace has no plural rules (see 6.4). | **FIX**: typed i18n lib (e.g. i18next + TS key types, ICU plurals). |

### 5. In-memory / singleton global state

| # | Location | Issue | Rec |
|---|---|---|---|
| 5.1 | `AuthService.users` (`:11`), `AppState.cities/projects/orders` (`:47-51`), `EmailService.outbox` (`:28`), all task status/attachments | **Zero persistence** — every account, city, project, tick, approval and attachment vanishes on exit. Only `.eml` files survive. All views, `AccessCheck`, and Main's seeding assume a fresh empty world each launch. | **FIX**: this is the core of the migration — real persistence (SQLite/backend) with the entities from §1.1–1.3 as the schema starting point. |
| 5.2 | `object AppState`, `object AuthService`, `object EmailService`, `Strings.lang` (`Strings.kt:7`), `WebOpen.host` | Singleton mutable globals mutated directly by views (e.g. `UserAdminView` writes `u.cityAccess` in a click handler with no service call, `:127`; banners flip `phase.approved` inline) | **FIX**: central store (Redux/Zustand) with actions; keep all mutations behind a service/IPC boundary — do not port the "views poke model fields" pattern. |
| 5.3 | `LoginView.kt:24-28` (`mode`, `resetStep`, `resetEmail` are `private var` on a singleton object) | Static UI state survives logout: log out after starting (or abandoning) a reset and the login screen resumes at reset step 2 with the stale email. | **FIX**: component-local state in React; reset on unmount. |
| 5.4 | `AppState.kt:53-55` listeners list; `Main.kt:64` | Observer list is append-only, never deregistered (safe now with one listener; a leak pattern if copied). | **DROP** — replaced by React reactivity. |
| 5.5 | `AppState.zoomFactor`, `Strings.lang` | User preferences (zoom, language) reset every launch. | **FIX**: persist in `localStorage`/settings file. |

### 6. Locale / format

| # | Location | Issue | Rec |
|---|---|---|---|
| 6.1 | `Main.kt:54-56` | `String.format(Locale.ROOT, "-fx-font-size: %.2fpx", …)` — **correct and deliberate** (prevents `13,00px` on NL systems). | Note only; in Electron use rem-based scaling, no locale-sensitive number formatting for CSS. |
| 6.2 | `Notifications.kt:18` and `OutboxView.kt:36` (`"dd-MM-yyyy HH:mm"`), `DashboardView.kt:26` (`"dd-MM HH:mm"`), `EmailService.kt:49` (`"yyyyMMdd_HHmmss_SSS"`) | Three separately hardcoded date formats, NL convention, `LocalDateTime`/no timezone (`EmailMessage.timestamp`, `Attachment.addedAt`) — ambiguous the moment data syncs across machines/DST. | **FIX**: store UTC ISO-8601; format with `Intl.DateTimeFormat` per UI locale; one shared formatter module. |
| 6.3 | `Strings.kt:7` (`lang = NL` default) whole app NL-first; Excel export and Overview sheet mixed-language | NL-only defaults fine for the client, but make default locale a setting, and choose one language per export file. | **CARRY** (NL default) + FIX export consistency. |
| 6.4 | `CityDetailView.kt:212` | Pluralization by appending `"n"`: `"${t("phaseLabel")}n"` → "fasen" (NL, correct) but **"phasen"** (EN, wrong); elsewhere plurals are separate keys (`projectCount/projectCountOne`) — two ad-hoc schemes. | **FIX**: ICU plural rules in the i18n layer. |

### 7. Blocking / threading

| # | Location | Issue | Rec |
|---|---|---|---|
| 7.1 | `EmailService.kt:80-110` | Raw daemon `Thread` per SMTP send; no queue/retry/backoff; result recorded only by mutating `deliveredVia` (a `@Volatile` display string); failure detail truncated to 60 chars; app exit can silently kill in-flight sends (daemon). | **FIX**: main-process mail queue (persisted), typed delivery status enum + error field, retry policy. |
| 7.2 | `EmailService.kt:109` | `try { Platform.runLater { AppState.notifyChanged() } } catch (_: Throwable) {}` — swallowing `Throwable` to survive headless runs | Pattern hides real errors; encodes "is the UI toolkit up?" as exception control-flow. | **DROP** — in Electron, main-process events go over IPC; no equivalent needed. |
| 7.3 | `EmailService.kt:42` (`writeEml` on caller thread), every `Alert/Dialog.showAndWait()` (`LoginView`, `HeaderBar`, `TaskListView`, `TaskRow`, `ProjectView`, `CityDetailView`, `UserAdminView`, `AttachmentUi`, `ExportPanel`), `ExcelExport.write` on the FX thread | Blocking disk I/O, blocking modal dialogs, and a full POI workbook write all on the UI thread — acceptable in JavaFX desktop, a jank/renderer-freeze source if literally translated. | **FIX**: async dialogs, file writes in main process via IPC, export with progress. |
| 7.4 | `EmailService.kt:71` | `smtpConfig by lazy` — config immutable per process (restart to apply). | **FIX**: read-on-send or watched config. |

### 8. Rendering / performance ceiling

| # | Location | Issue | Rec |
|---|---|---|---|
| 8.1 | `Main.kt:50-64` (`mount` = `root.children.clear()` + rebuild), invoked by every one of the ~60 `AppState.notifyChanged()` call sites | **Every state change rebuilds the entire scene graph**: one checkbox tick re-creates the header, dashboard/project view (hundreds of task rows across 338 template tasks), export panel, and a new `ScrollPane` — so **scroll position and focus are lost on every interaction**, and each tick also re-runs `openTaskCount()` (full scan) and re-sends layout. This is the app's hard perf ceiling and a known UX papercut. | **FIX**: React's reconciliation solves this for free — but only if state is normalized (per-entity selectors), not if the port reproduces "one global blob + rerender everything". Keep `ScrollPane`-equivalent scroll state in layout components. Consider virtualization for 50-row phases (Ontwikkelfase DO = 52 tasks). |
| 8.2 | `TaskRow`/`TaskListView` | A checkbox tick triggers an email compose + `.eml` disk write + optional SMTP thread **synchronously in the click handler** before the re-render (`TaskRow.kt:66-68`). Also fires a fresh email on every re-tick (untick/tick spam). | **FIX**: debounce/digest notifications server-side; decouple side effects from UI events. |

### 9. Data quality (`phases.json`)

| # | Location | Issue | Rec |
|---|---|---|---|
| 9.1 | `phases.json` (302/338 tasks) + `Models.kt:61-65` + `Attachment.kt:38-49` | `existingLink` holds **Dutch descriptions, not URLs** ("Link naar map met gespreksnotities", "Link naar CRM", … — only 1 of 302 even contains a domain). `Task.fromTemplate` converts each into an `Attachment`: `"://" !in url` → prepended `https://` → `url = "https://Link naar map met gespreksnotities"`, kind `WEB_LINK`, default name `"Link"` (URI host parse fails on spaces). Result: **302 seeded attachment chips that open garbage URLs**, all owned by the pseudo-user `"Fasedocument"`. The real hyperlinks were evidently lost when the client's xlsx was flattened to JSON. | **FIX before migration**: re-extract hyperlinks from the source xlsx; model these as `expectedDocument: string` (a label of what should be linked) rather than a fake attachment; do not port the auto-attachment branch as-is. |
| 9.2 | `AppState.kt:152` and duplicate at `TaskListView.kt:32` | RASCI filter uses substring `contains`: role `"PM"` matches every `"PPM"` cell (36 tasks) — the PM chip shows Property-Manager tasks. Conversely the raw value `"PP"` (typo in the source data) matches **no** chip and is reachable only via "all". | **FIX**: normalize RASCI cells to arrays of enum tokens at import time; exact-token matching. |
| 9.3 | `phases.json` RASCI values `DENISE + PO`, `MT/PO`, `PO/MT`, `PP` | Person names and inconsistent separators straight from the client doc; `"DENISE + PO"` renders verbatim in RASCI tags and emails. | **FIX**: data-cleaning pass with the client; separator-agnostic tokenizer. |
| 9.4 | `PhaseData.kt:10-13` | `all[0]` **must** be Gemeenteontwikkeling; no schema validation of `phases.json` beyond kotlinx defaults (`ignoreUnknownKeys`). | **FIX**: explicit template schema + validation (zod) with named phase kinds. |

### 10. Duplicated logic between views

| # | Locations | Duplication | Rec |
|---|---|---|---|
| 10.1 | `ProjectView.approve/reject:232-249` + banner `:119-181` vs `ApprovalsView:107-122` (phases) vs `CityDetailView:119-135` vs `ApprovalsView:64-79` (cities) | Approve/reject/withdraw/reopen state flips + notification calls exist in **four** places with slightly different guards (banner checks `isApprover` per-click; ApprovalsView relies only on the view gate). | **FIX**: single `approvalService.approvePhase/rejectPhase/approveCity/…` used by all surfaces. |
| 10.2 | `ProjectView.trySubmit:184-224` vs `CityDetailView.trySubmitCity:167-194` | Two-step unfinished-tasks dialog flow duplicated (city version lacks move-to-next). | **FIX**: one submit workflow parameterized by "has next phase". |
| 10.3 | `AppState.relevantTasks:150-153` vs `TaskListView.build:31-32` | The RASCI filter predicate implemented twice (bug 9.2 must be fixed in both today). | **FIX**: one selector. |
| 10.4 | `DashboardView.statTile:159-168` vs `ExportPanel.stat:49-53`; three `DateTimeFormatter` copies (6.2); approval-banner construction `ProjectView` vs `CityDetailView` (~90 near-identical lines) | Copy-paste UI helpers. | **FIX**: shared components (`StatTile`, `ApprovalBanner`, `dateFmt`). |
| 10.5 | `Main.kt` seed block vs `AccessCheck.kt:18-21` | Demo world seeded twice, drifting independently. | **DROP** with 2.2 (replace by fixtures). |

### 11. Dead code / unused constructs

| # | Location | Item | Rec |
|---|---|---|---|
| 11.1 | `MainView.kt:25-26` | `mainCard.scene?.window` is evaluated **before the node is in a scene** — always null; `ExportPanel.build(stage)`/`showSaveDialog` always run unparented. Latent bug that never mattered. | **DROP** (Electron dialogs take a `BrowserWindow` explicitly). |
| 11.2 | `TaskListView.kt:8` (`Alert`), `ExportPanel.kt:14` (`Region`) | Unused imports. | DROP. |
| 11.3 | `TaskTemplate.row` (`Models.kt:11`) | Loaded from JSON (65 distinct values = original xlsx row numbers), never read at runtime (`fromTemplate` uses list index). Useful as provenance only. | **CARRY** as `sourceRow` metadata or DROP. |
| 11.4 | `Task.opm` / `TaskTemplate.opm` | All 338 values empty in JSON; never displayed; **not even exported** (no Opm column in `ExcelExport.headerCols:69-72`). | DROP unless the client's next data drop populates it. |
| 11.5 | `Task.iCol` | Loaded and exported (Excel col "I") but **never rendered in any UI** (TaskRow shows R/A/S/C only, `TaskRow.kt:98-101`) and never used for notification recipients — the "Informed" semantics are silently unimplemented. | **FIX**: product decision — either surface I and/or wire it into notification recipients, or drop the column. |
| 11.6 | `User.projectAccess` | Enforced by `userCanAccessProject` but **no UI or code path ever adds to it** (UserAdminView only manages city chips). Write-only feature. | **FIX**: build the per-project grant UI in migration or drop the field. |
| 11.7 | `Strings.kt:108,344` `linkPlaceholder` | Referenced by no view (legacy of the pre-attachment link field). | DROP. |
| 11.8 | `AccessCheck.kt` | Print-only "test" with zero assertions. | **FIX**: convert scenarios into real assertions (vitest/playwright) — the scenario list itself is a good regression catalog. |

### 12. Magic numbers & misc constants

| # | Location | Value(s) | Note |
|---|---|---|---|
| 12.1 | `Models.kt:48,69`, `TaskListView.kt:24,35`, `AppState.kt:204` | `"||"` blok-grouping delimiter; a step/blok containing `"||"` corrupts grouping; WIP tasks get key `"WIP||"` | FIX: structured `{step, blok}` grouping key. |
| 12.2 | `AuthService.kt:60,96,106` (pw length ≥ 4), `:87` (6-digit code range) | Security constants scattered inline | FIX: policy config. |
| 12.3 | `DashboardView.kt:62,81` (`take(4)`), `:126` (`take(5)`), `Notifications.kt:39` (`take(70)` subject truncation), `EmailService.kt:52` (slug `take(40)`), `:106` (error `take(60)`), `ExcelExport.kt:46` (`pname.take(10)`) | Unnamed truncation limits | FIX: named constants. |
| 12.4 | `ExcelExport.kt:31,46-47` | Sheet naming `take(10)`/`take(31)`: two projects sharing a 10-char prefix in the same phase → `createSheet` throws `IllegalArgumentException` (export dies); `createSafeSheetName(...).take(31)` double-truncation | FIX: dedupe sheet names. |
| 12.5 | `AppState.kt:40-43` | Zoom ladder `0.9/1.0/1.15/1.3/1.5`, base 13 px (`Main.kt:55`, `app.css:27`), epsilon `0.001` float compares | CARRY concept (root font-size scaling maps cleanly to `rem`), replace floats with an index into the ladder. |
| 12.6 | `Main.kt:18` (1280×840), `AttachmentUi.kt:80` (260 px attachment column), `LoginView` card widths 420/440/460, `FlowPane` wrap 960/980 | Fixed pixel layout constants | FIX: responsive CSS. |
| 12.7 | Emoji as UI glyphs throughout (`HeaderBar`, phase-tab dots 🔒✅🟡🟢🔵⚪, `Strings` subjects ✅📥🎉↩🔑, `deliveredVia` "SMTP ✓/✗") | Emoji doubles as status data and appears in email subjects (forcing the RFC 2047 workaround at `EmailService.kt:55`) | FIX: icons in UI, plain-text or template-driven subjects; status as enums. |
| 12.8 | `AuthService.kt:76-78` vs `:47,86,94,104,115` | `approve/reject/setRole` skip email canonicalization that every other entry point performs | FIX: canonicalize once at the boundary. |

### 13. Behavioral rules worth carrying over knowingly (the actual spec)

These are correct-by-design and should be ported deliberately: the signup→PENDING→owner-approval pipeline; the city gate (Gemeenteontwikkeling approved ⇒ Acquisitiefase unlocks; phase i ⇒ i+1); submit/withdraw/approve/reject/reopen lifecycle with locking (`TaskCtx.isLocked` = submitted or approved freezes edits but keeps doc chips clickable); N/A dropping out of the progress denominator (but note `progressOf` = 1.0 on empty); unfinished-task submit flow (proceed → N/A or move-to-next-WIP, N/A-only for cities); owner-first handover default on user removal; recipient rules (submissions/requests → active owners; decisions → active non-owner team with access, fallback owners); outbox visibility (owner all vs. own mail — minus finding 2.3); custom rows deletable / base rows not; admin-only reorder within blok boundaries; digest email for mark-all vs. per-task email on individual ticks (rate-limit in migration, see 8.2).

---

## Priority shortlist for the migration document

1. **Replace the entire auth stack** (2.1, 2.2, 2.3, 2.4, 2.5, 2.8) — nothing in `AuthService`/reset flow is salvageable beyond its state machine.
2. **Introduce real IDs everywhere** (3.1–3.5) before persistence/sync exists, or migration data will be built on name-string foreign keys.
3. **Re-extract `phases.json` hyperlinks and normalize RASCI tokens** (9.1–9.3) — this is client-data work with lead time; start early.
4. **Access-control the export** (2.6) and **sanitize URL opening** (2.7) — the two exploitable holes reachable by non-owners.
5. Resolve open product questions with Ernest: the WIP headline text (4.1), who approves (MT vs OWNER, 4.4), the unused I-column/`projectAccess`/`opm` features (11.5, 11.6, 11.4), per-city project-name uniqueness (3.4).
6. Architect the React port around a normalized store + service layer so the full-tree-re-render ceiling (8.1) and four-way approval-logic duplication (10.1) die in the translation rather than being transliterated.