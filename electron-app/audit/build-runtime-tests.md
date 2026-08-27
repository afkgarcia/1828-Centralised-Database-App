# Audit: `desktop-app` (Kotlin/JavaFX) — migration baseline for Electron + TypeScript + React

Audited at `/Users/alessandrogarcia/Desktop/GarciaGaspar/1828/desktop-app`, version `0.9.0`, group `nl.eighteen28`, Gradle project name `fasedocument-tracker`. All statements below come from reading the actual code, not the README.

---

## 1. Build, toolchain and dependencies

### Toolchain

| Item | Value | Source |
|---|---|---|
| Kotlin (JVM + serialization plugins) | **1.9.22** | `build.gradle.kts` `plugins` block |
| JDK toolchain | **Java 17** (both `java.toolchain` and `kotlin.jvmToolchain(17)`) | `build.gradle.kts` |
| JavaFX | **21.0.2**, modules = `["javafx.controls"]` only | `org.openjfx.javafxplugin` **0.1.0** |
| Gradle wrapper | **8.7** (`gradle-8.7-bin.zip`) | `gradle/wrapper/gradle-wrapper.properties` |
| Toolchain auto-download | `org.gradle.toolchains.foojay-resolver-convention` **0.8.0** | `settings.gradle.kts` |
| Gradle JVM args | `-Xmx2g -Dfile.encoding=UTF-8`; `kotlin.code.style=official` | `gradle.properties` |

### Dependencies (all `implementation`)

| Library | Version | Used for |
|---|---|---|
| `org.jetbrains.kotlinx:kotlinx-serialization-json` | 1.6.3 | Decoding `src/main/resources/phases.json` into `List<PhaseTemplate>` (`app/data/PhaseData.kt`, `Json { ignoreUnknownKeys = true }`) |
| `org.apache.poi:poi` | 5.2.5 | `.xlsx` export (`app/export/ExcelExport.kt`, XSSFWorkbook) |
| `org.apache.poi:poi-ooxml` | 5.2.5 | OOXML part of the POI export |
| `org.apache.logging.log4j:log4j-core` | 2.22.1 | POI runtime logging dependency only |
| `org.apache.logging.log4j:log4j-api` | 2.22.1 | POI runtime logging dependency only |
| `jakarta.mail:jakarta.mail-api` | 2.1.3 | SMTP send API (`EmailService.sendSmtpIfConfigured`) |
| `org.eclipse.angus:angus-mail` | 2.0.3 | Jakarta Mail implementation (Angus) |

### Build / run entry points

- `application.mainClass = "app.MainKt"`; jar manifest `Main-Class: app.MainKt`.
- `./gradlew run` — launches the JavaFX app (`app.Main.kt` → `FasedocumentTrackerApp`, 1280×840 scene, loads classpath `app.css`).
- `./gradlew accessCheck` — custom `JavaExec` task (group `verification`), mainClass `app.AccessCheckKt`, classpath = `main` runtime classpath + `test` output. Runs the whole auth/access/notification logic headless (no JavaFX toolkit).
- `./gradlew installDist` / `distZip` — standard application-plugin distributions.
- Test source set: only `src/test/kotlin` added as a Kotlin srcDir; **there is no JUnit dependency and no `test` framework** — `AccessCheck.kt` is a plain `fun main()` smoke script that *prints* results (it does not assert/fail; see §3).

---

## 2. `Main.kt` seed data — exact

`FasedocumentTrackerApp.start(stage)` performs, in order:

1. `WebOpen.host = hostServices` (URL opening via JavaFX HostServices).
2. **Cities** (order matters — `AppState.cityOrder` is insertion-ordered):
   - `AppState.addCity("Leiden")`
   - `AppState.addCity("Amsterdam")`
   - `AppState.addCity("Utrecht")`
   - Each `addCity(name)` instantiates the city's task list from `PhaseData.cityPhase` (= `phases.json[0]`, sheet **"Gemeenteontwikkeling"**, **26 tasks**), with task ids `city_<name>_b_<idx>`.
3. **Projects** (each gets 9 phases from `PhaseData.projectPhases` = `phases.json[1..9]`; task ids `proj_<name>_p<phaseIdx>_b_<taskIdx>`):
   - `addProject("Pieterskwartier", parentCity = "Leiden")`
   - `addProject("Sloterdijk Noord", parentCity = "Amsterdam")`
   - `addProject("Utrecht Oost", parentCity = "Utrecht")`
4. **Seeded attachments** (via `Attachment.from(url, name, addedBy)`):

| Target task | URL | Name | addedBy (display name) | Detected kind |
|---|---|---|---|---|
| `cities["Leiden"].tasks[0]` | `https://docs.google.com/spreadsheets/d/1G40LijstVerrijkt2026/edit` | `G40 lijst verrijkt` | `Ernest` | GOOGLE_SHEET |
| `cities["Leiden"].tasks[1]` | `https://docs.google.com/document/d/1AnalyseWoonvisieLeiden/edit` | `Analyse woonvisie Leiden` | `Pia (PM)` | GOOGLE_DOC |
| `projects["Pieterskwartier"].phases[0].tasks[0]` (phase 0 = Acquisitiefase) | `https://drive.google.com/drive/folders/1PieterskwartierAcquisitie` | `Acquisitie-map` | `Pia (PM)` | DRIVE_FOLDER |
| `projects["Pieterskwartier"].phases[0].tasks[1]` | `https://docs.google.com/presentation/d/1PitchGemeenteLeiden/edit` | `Pitch gemeente Leiden` | `Pia (PM)` | GOOGLE_SLIDES |

   Note: these are *in addition to* auto-migrated attachments — `Task.fromTemplate` converts any non-blank `existingLink` from `phases.json` into an `Attachment` with `addedBy = "Fasedocument"` (302 of the 338 template rows carry an `existingLink`).
5. **Leiden pre-approved state**: every task in `cities["Leiden"].tasks` set to `TaskStatus.DONE`, then `leiden.approved = true` (`submitted` stays `false`). Amsterdam and Utrecht remain unsubmitted/unapproved, so their projects demonstrate the city gate (project phase 0 locked).
6. Mount loop: root font-size `13.0 * AppState.zoomFactor` px (Locale.ROOT formatting), stage title `Strings.t("appTitle")`, shows `LoginView` when `AppState.currentUser == null` else `MainView`; re-mounts on every `AppState.notifyChanged()`.

**Users implied by the seed** (actually created in `AuthService.init { seed() }`, not Main.kt — but Main.kt's seed data references their display names):

| Email | Password (SHA-256-hashed) | displayName | Role | Status | Access |
|---|---|---|---|---|---|
| `ernest@1828.nl` | `ernest` | `Ernest` | OWNER | ACTIVE | `accessAllCities = true` |
| `pia@1828.nl` | `test` | `Pia (PM)` | PM | ACTIVE | `cityAccess = {"Leiden"}` |
| `niels@1828.nl` | `test` | `Niels (OM)` | OM | **PENDING** | none |

`phases.json` ground truth (loaded lazily, classpath): 10 sheets, 338 tasks total — Gemeenteontwikkeling 26, Acquisitiefase 27, Haalbaarheidsfase 22, Ontwikkelfase VO 49, Ontwikkelfase DO 52, Ontwikkelfase TO 33, Ontwikkelfase UO 26, Verkoopfase 26, Realisatiefase 51, Garantiefase 26. `TaskTemplate` fields: `row:Int, step, blok, deliverable, existingLink, r, a, s, c, i, opm` (all String, defaulted).

---

## 3. `AccessCheck.kt` — complete invariant enumeration (parity acceptance suite)

Setup: deletes `build/tmp/tracker-check` recursively, sets system property `tracker.data.dir` to it (redirects `.eml` output away from `~/.1828-tracker`), then seeds the **same 3 cities + 3 projects as Main.kt but with NO attachments seeded and NO Leiden pre-approval**. Important caveat: the script **prints values via `line(label, value)` — it never asserts or exits non-zero**. The expected values below (derived from the code) are what the Electron parity suite must assert.

### 3.1 OWNER (Ernest)
| Check | Expected |
|---|---|
| `AuthService.login("ernest@1828.nl","ernest")` | `LoginResult.Ok(user)`; then `AppState.login(ernest)` |
| `AppState.accessibleCities()` | `[Leiden, Amsterdam, Utrecht]` (cityOrder order; owner sees all via `accessAllCities`/OWNER role) |
| `AppState.projectsForCity("Leiden").map{name}` | `[Pieterskwartier]` |
| `AppState.isApprover()` | `true` (defined as `isOwner()`, i.e. `currentUser?.role == UserRole.OWNER`) |

### 3.2 PM (Pia, scoped to Leiden)
| Check | Expected |
|---|---|
| login `pia@1828.nl`/`test` | `Ok` |
| `accessibleCities()` | `[Leiden]` only |
| `projectsForCity("Leiden")` | `[Pieterskwartier]` (project access granted transitively: `proj.parentCity ∈ cityAccess`) |
| `projectsForCity("Amsterdam")` | `[]` (filtered by `canAccessProject`) |
| `canAccessProject("Pieterskwartier")` | `true` |
| `canAccessProject("Sloterdijk Noord")` | `false` |
| `isApprover()` | `false` |

Access-rule semantics to replicate exactly (`AppState`):
- `userCanAccessCity(u, name)`: true if `u.accessAllCities || u.role == OWNER`, OR `name ∈ u.cityAccess`, OR the user has `projectAccess` to **any project whose `parentCity == name`** (project grant makes the parent city visible).
- `userCanAccessProject(u, name)`: false if project unknown; true if owner/allCities, OR `proj.parentCity ∈ u.cityAccess`, OR `proj.name ∈ u.projectAccess`.
- `canAccessCity`/`canAccessProject` = same for `currentUser`, `false` when logged out.

### 3.3 Login failure paths
| Input | Expected `LoginResult` subclass |
|---|---|
| `niels@1828.nl` / `test` (status PENDING, correct password) | `Pending` |
| `ernest@1828.nl` / `wrong` | `BadPassword` |
| `ghost@1828.nl` / `x` | `UnknownEmail` |

(Order of checks in `AuthService.login`: email lowercased+trimmed → unknown; then hash mismatch → BadPassword; then status: PENDING→Pending, REJECTED→Rejected, ACTIVE→Ok. Rejected path exists but is not exercised here.)

### 3.4 Approval flow (phase gate within a project)
With ernest logged in, `proj = projects["Pieterskwartier"]`:
| Step | Expected |
|---|---|
| Set `phases[0].submitted = true`; `isPhaseUnlocked("Pieterskwartier", 1)` | `false` (phase i>0 unlocked iff `phases[i-1].approved`) |
| `pendingPhaseSubmissions().size` | `1` (all phases across all projects where `submitted && !approved`, as `Triple<Project, Int, Phase>` in projectOrder order) |
| Set `phases[0].submitted = false; phases[0].approved = true`; `isPhaseUnlocked("Pieterskwartier", 1)` | `true` |

### 3.5 Signup
| Step | Expected |
|---|---|
| `signup("test@1828.nl","test","Test User", UserRole.PO)` | `SignupResult.Ok` (rules: email lowercased/trimmed, must contain `@` else `InvalidEmail`; password length ≥ 4 else `WeakPassword`; duplicate email → `AlreadyExists`; blank displayName falls back to local-part; new user status = PENDING) |
| login immediately after signup | `Pending` |
| `AuthService.approve("test@1828.nl")` then login | `Ok` (approve sets status ACTIVE) |

### 3.6 Email notifications (routing + outbox visibility)
With **pia** logged in:
- `Notifications.deliverablesSubmitted("Leiden — Gemeenteontwikkeling", [first Leiden task])` → recipients = **active OWNERs** (`role==OWNER && status==ACTIVE`).
- `Notifications.approvalRequested("Pieterskwartier", 1)` → recipients = active owners; body includes project, parent city, phase label `"{idx+1}. {sheet}"`, timestamp `dd-MM-yyyy HH:mm`, and a documents list if any attachments exist in the phase.

| Check | Expected |
|---|---|
| `EmailService.outbox.size` after the two PM actions | `2` (outbox is **newest-first**: `add(0, msg)`) |
| `outbox[1].to` (deliverable mail) | `[ernest@1828.nl]` |
| `outbox[0].to` (approval request) | `[ernest@1828.nl]` |

With **ernest** logged in, `Notifications.phaseApproved("Pieterskwartier", 1)`:
| Check | Expected |
|---|---|
| `outbox[0].to` (approved mail → team) | `[pia@1828.nl]` — team = ACTIVE, non-OWNER users with `userCanAccessProject` (test@1828.nl is active but has no grants; niels pending). Falls back to active owners if team empty. |
| `outbox[0].subject` | NL `subjApproved` string with `{project}`→Pieterskwartier, `{phase}`→`2. Haalbaarheidsfase` |
| `.eml` files in `EmailService.outboxDir()` | `3` (one per send) |
| `EmailService.visibleTo("pia@1828.nl", false).size` | `1` (non-owner sees only mail where their email ∈ `to`) |
| `EmailService.visibleTo("ernest@1828.nl", true).size` | `3` (owner sees everything) |

Full recipient-routing matrix (`Notifications`):
| Event composer | `NotifyEvent` | From | To |
|---|---|---|---|
| `deliverablesSubmitted(contextLabel, tasks)` (no-op if tasks empty/no user/no owners) | DELIVERABLE_SUBMITTED | actor email | active owners |
| `approvalRequested(project, phaseIdx)` | APPROVAL_REQUESTED | actor email | active owners |
| `phaseApproved`/`phaseRejected` → `phaseDecision` | PHASE_APPROVED / PHASE_REJECTED | actor email | project team (active non-owner with project access), fallback active owners; approved body names the next phase or a "last phase" line |
| `cityApprovalRequested(city)` | APPROVAL_REQUESTED | actor email | active owners (body lists all city-task attachments) |
| `cityDecision(city, approved)` | PHASE_APPROVED / PHASE_REJECTED | actor email | active non-owner users with `userCanAccessCity`, fallback active owners |
| `passwordReset(user, code)` | PASSWORD_RESET | **`noreply@1828.nl`** (no actor; user logged out) | `[user.email]` only |

### 3.7 Google Drive attachment detection
| Check | Expected |
|---|---|
| `Attachment.from("https://docs.google.com/document/d/1XyZ/edit", null, "Check").kind` | `GOOGLE_DOC` |
| its `.name` (null name → default per kind) | `"Google Doc"` |
| `Attachment.from("docs.google.com/spreadsheets/d/1Abc/edit", "G40 lijst", …).url.startsWith("https://")` | `true` (scheme auto-prepended when `"://"` absent) |
| its `.name` | `"G40 lijst"` |
| `DriveKind.detect("https://drive.google.com/drive/folders/1Xyz")` | `DRIVE_FOLDER` |
| `DriveKind.detect("https://example.com/rapport.pdf")` | `WEB_LINK` |

Detection order (case-insensitive substring, `DriveKind.detect`): `docs.google.com/document`→GOOGLE_DOC; `docs.google.com/spreadsheets`→GOOGLE_SHEET; `docs.google.com/presentation`→GOOGLE_SLIDES; `docs.google.com/forms` or `forms.gle`→GOOGLE_FORM; `drive.google.com` + `/folders/`→DRIVE_FOLDER; any other `drive.google.com`→DRIVE_FILE; else WEB_LINK. Default names: "Google Doc" / "Google Sheet" / "Google Slides" / "Google Form" / "Drive folder" / "Drive file"; WEB_LINK default name = URL host (via `java.net.URI`) or `"Link"`.

Then: attach `docAtt` to `projects["Pieterskwartier"].phases[2].tasks[0]` (Ontwikkelfase VO), pia sends `approvalRequested("Pieterskwartier", 2)` → **invariant: mail body contains the docs label ("Documenten") and `docAtt.url`** (approval-request emails enumerate every attachment in the phase as `• name — url`).

### 3.8 Password reset (self-service)
| Check | Expected |
|---|---|
| `requestPasswordReset("ghost@1828.nl")` | `null` (unknown email) |
| `requestPasswordReset("pia@1828.nl")` | non-null 6-digit code (random `100000..999999`, stored in `resetCodes[email]`) |
| `outbox[0].event` | `PASSWORD_RESET` |
| `outbox[0].to` | `[pia@1828.nl]` |
| `completePasswordReset("pia@1828.nl","000000","nieuw")` | `ResetResult.BadCode` |
| `completePasswordReset(email, correctCode, "nieuw")` | `Ok` (also requires new password length ≥ 4 else `WeakPassword`; unknown email → `UnknownEmail`; code compared after `.trim()`) |
| login with old password `test` | `BadPassword` |
| login with `nieuw` | `Ok` |
| reuse of same code | `BadCode` — **codes are single-use** (removed on success) |

### 3.9 Change password (signed in)
| Check | Expected |
|---|---|
| `changePassword("pia@1828.nl","fout","abcd")` | `ChangeResult.BadCurrent` (also returned for unknown email) |
| `changePassword("pia@1828.nl","nieuw","abcd")` | `Ok` (new password ≥ 4 chars else `WeakPassword`) |
| login with `abcd` | `Ok` |

### 3.10 Remove user with document handover
Setup: attachment `"Pia's analyse"` (`https://docs.google.com/document/d/1PiaDoc/edit`) added to `cities["Leiden"].tasks[3]` with `addedBy = pia.displayName` (`"Pia (PM)"`).
| Check | Expected |
|---|---|
| `AuthService.remove("ernest@1828.nl")` | `false` — **OWNERs can never be removed** |
| `AppState.reassignAttachments("Pia (PM)", "Ernest")` | `1` — walks every city task list AND every project phase task list, rewrites `att.addedBy` where it equals the source displayName, returns count |
| `handoverTask.attachments.last().addedBy` | `"Ernest"` |
| `AuthService.remove("pia@1828.nl")` | `true` (also removes any pending reset code for that email) |
| login as removed user | `UnknownEmail` |
| `AuthService.all().size` | `3` (ernest, niels, test) |

Note: handover matches on **displayName**, not email — displayName is not unique-enforced; preserve or fix consciously in the port.

### 3.11 Unfinished tasks on submit
**N/A path** (`Sloterdijk Noord` phase 0 = Acquisitiefase, 27 tasks; first 5 set DONE):
| Check | Expected |
|---|---|
| open before | `22` |
| `markOpenTasksNa("Sloterdijk Noord", 0)` | `22` (sets every `OPEN` task in that phase to `NA`; returns count; 0 for unknown project/phase) |
| no OPEN tasks remain | `true` |

**Move-to-WIP path** (`Utrecht Oost`: phase 0 all DONE, then first 3 reset to OPEN; phase 0 has 27 tasks, phase 1 = Haalbaarheidsfase has 22):
| Check | Expected |
|---|---|
| `moveOpenTasksToNextPhase("Utrecht Oost", 0)` | `3` |
| phase 0 shrank by | `3` (27→24; moved tasks are **removed** from source) |
| phase 1 grew by | `3` (22→25; inserted with `addAll(0, open)` — **top of next phase**) |
| moved tasks lead next phase with `step == AppState.WIP_STEP` | `true` (`WIP_STEP = "WIP"`, a `const val`; task `blok` set to `""`) |
| moved tasks keep status OPEN (and, per code, keep RASCI fields + attachments — same `Task` objects) | `true` |
| `blokKey` of moved task | `"WIP||"` (`blokKey = "$step||$blok"`) |
| `moveOpenTasksToNextPhase("Utrecht Oost", 8)` (Garantiefase, last of 9 phases) | `0` — no next phase |

### 3.12 City gate (Gemeenteontwikkeling before Acquisitiefase)
| Check | Expected |
|---|---|
| `isPhaseUnlocked("Sloterdijk Noord", 0)` while Amsterdam unapproved | `false` — **phase 0 of any project is unlocked iff `cities[proj.parentCity].approved == true`**; phases i≥1 require `phases[i-1].approved` |
| After all Amsterdam city tasks DONE and `submitted = true`: `pendingCitySubmissions()` | `[Amsterdam]` (cities where `submitted && !approved`, in cityOrder) |
| After `submitted = false; approved = true`: `isPhaseUnlocked("Sloterdijk Noord", 0)` | `true` |
| `isPhaseUnlocked("Sloterdijk Noord", 1)` | `false` — city approval does NOT cascade; phase 1 still needs phase 0 approved |
| `pendingCitySubmissions().size` after decision | `0` |

Also port-relevant from `AppState` though not printed by the check: `progressOf(tasks)` = done / (relevant tasks excluding NA), returns `1.0` when the applicable set is empty; `relevantTasks` filters by RASCI chip (`role == "all"` passes everything; otherwise keeps tasks where any of `r/a/s/c` **contains** the role string — substring match, `i` column not consulted); `isPhaseReady(phase)` = relevant tasks non-empty AND none OPEN; `openTaskCount()` counts OPEN relevant tasks across accessible cities + accessible projects' phases; `isPhaseUnlocked` returns `false` for unknown project. `rasciFilterKey()`: OWNER→`"all"`, others→their enum name (`OM`,`PO`,`PM`,`PPM`,`MT`). Zoom: `ZOOM_LEVELS = [0.9, 1.0, 1.15, 1.3, 1.5]`, `zoomIn`/`zoomOut` step through them. `AppState.login(user)` sets `role = rasciFilterKey()`, `adminMode = false`, `view = Dashboard`; `logout()` resets to `null`/`"all"`/`false`/`Dashboard`.

---

## 4. Persistence: disk vs in-memory

**All domain state is in-memory only.** No database, no JSON save/load, nothing survives process exit: users and password hashes (`AuthService.users: LinkedHashMap`), reset codes, cities/projects/tasks/statuses/attachments (`AppState`), the outbox list, view/zoom/role state. Passwords are unsalted SHA-256 hex digests (`AuthService.hash`, `MessageDigest "SHA-256"`).

Complete inventory of file/disk I/O in `src/main`:

| I/O | Direction | Path | Code |
|---|---|---|---|
| `phases.json` | read (classpath resource, once, lazy) | inside the jar/resources | `PhaseData.load()` |
| `app.css` | read (classpath resource) | resources | `Main.kt` scene stylesheet |
| `.eml` files | **write** — one per sent email, best-effort (`runCatching`) | `<dataDir>/outbox/<yyyyMMdd_HHmmss_SSS>_<subject-slug ≤40 chars>.eml`; dataDir = system property `tracker.data.dir`, else `~/.1828-tracker` | `EmailService.writeEml` (RFC-2047 Base64-encoded UTF-8 subject, CRLF headers, text/plain 8bit body) |
| `smtp.properties` | read (lazy, cached once per process) | `<dataDir>/smtp.properties` | `EmailService.smtpConfig`; keys: `enabled` (default false), `host` (default localhost), `port` (default 587), `username` (presence toggles auth), `password`, `from` (default = actor), `starttls` (default true). Send runs on a daemon `Thread`; `EmailMessage.deliveredVia` is `@Volatile var`, transitions `"outbox"` → `"SMTP…"` → `"SMTP ✓"` / `"SMTP ✗ (<first 60 chars of exception>)"`, then triggers a UI refresh via `Platform.runLater` guarded for headless callers |
| Excel export | **write** — user-initiated only | user-chosen path via `FileChooser` (`ExportPanel`) | `ExcelExport.write(target)`: Overview sheet (city + project name lists), one sheet per city (`City_<name>`), one sheet per project phase (`<proj≤10>_P<n>_<phaseTitle>`, sheet names sanitized to ≤31 chars); columns Step, Blok, Deliverable, Status ("Klaar / Done" / "N.v.t. / N/A" / "Open"), Documents (`name — url` joined by `; `), R, A, S, C, I, Custom ("yes"/""); dark-blue bold-white header row |
| check scratch dir | delete + write | `build/tmp/tracker-check` (via `tracker.data.dir`) | `AccessCheck.kt` only |
| Folder/URL opening | shell out | n/a | `WebOpen.open/openFolder` — HostServices when available, else `open` / `cmd /c start` / `explorer` / `xdg-open` via ProcessBuilder |

So the only writes beyond the user-driven Excel export are the `.eml` files, and the only config read is `smtp.properties` — confirmed by grep across `src/main`. The README's "Limitations" section is accurate on this point: persistence is the acknowledged next major piece, which the Electron port must design (the port cannot rely on any existing storage format or migration path — there is none).

### Model reference (mutability matters for the TS port)

| Type | Fields (mutability) |
|---|---|
| `Task` (class) | `id: String` (val), `step/blok/deliverable/r/a/s/c/iCol/opm: String` (all **var**), `status: TaskStatus` (var, default OPEN), `attachments: MutableList<Attachment>` (val, mutable list), `custom: Boolean` (val, default false; custom rows deletable, base rows not). `blokKey` computed `"$step||$blok"`. Factory `fromTemplate(tmpl, prefix, idx)` (id `<prefix>_b_<idx>`, migrates `existingLink` → attachment owned by `"Fasedocument"`); `Task.custom(blokKey, deliverable)` builds id `c_<epochMillis>_<counter>` splitting blokKey on `"||"` |
| `City` (class) | `name: String` (val), `tasks: MutableList<Task>` (val), `submitted: Boolean` (var), `approved: Boolean` (var) |
| `Phase` (class) | `template: PhaseTemplate` (val), `tasks: MutableList<Task>` (val), `submitted` (var), `approved` (var) |
| `Project` (class) | `name` (val), `parentCity: String` (**var**), `phases: MutableList<Phase>` (val) |
| `User` (class) | `email` (val), `passwordHash` (var), `displayName` (val), `role: UserRole` (var), `status: UserStatus` (var, default PENDING), `accessAllCities: Boolean` (var, default false), `cityAccess: MutableSet<String>` (val), `projectAccess: MutableSet<String>` (val) |
| `Attachment` (class) | `id` (val, `att_<epochMillis>_<counter>`), `name` (var), `url` (var), `kind: DriveKind` (val), `addedBy: String` (**var** — rewritten on handover), `addedAt: LocalDateTime` (val, now()) |
| Enums | `TaskStatus { OPEN, DONE, NA }`; `UserRole { OWNER, PM, OM, PO, PPM, MT }`; `UserStatus { PENDING, ACTIVE, REJECTED }`; `DriveKind { GOOGLE_DOC, GOOGLE_SHEET, GOOGLE_SLIDES, GOOGLE_FORM, DRIVE_FOLDER, DRIVE_FILE, WEB_LINK }`; `NotifyEvent { DELIVERABLE_SUBMITTED, APPROVAL_REQUESTED, PHASE_APPROVED, PHASE_REJECTED, PASSWORD_RESET }` |
| `View` (sealed) | `Dashboard`, `CityDetail(name)`, `ProjectView(projectName, var phaseIdx = 0)`, `Approvals`, `UserAdmin`, `Outbox` |
| `EmailMessage` (class) | `event, from: String, to: List<String>, subject, body` (val), `timestamp: LocalDateTime` (val, now()), `deliveredVia: String` (@Volatile var, default `"outbox"`) |

Key files: `/Users/alessandrogarcia/Desktop/GarciaGaspar/1828/desktop-app/src/main/kotlin/app/Main.kt`, `src/test/kotlin/app/AccessCheck.kt`, `src/main/kotlin/app/state/AppState.kt`, `app/auth/AuthService.kt`, `app/notify/{Notifications,EmailService}.kt`, `app/model/{Models,User,Attachment}.kt`, `app/data/PhaseData.kt`, `app/export/ExcelExport.kt`, `src/main/resources/phases.json`.