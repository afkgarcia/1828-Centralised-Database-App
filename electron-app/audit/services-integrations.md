# Audit: Kotlin/JavaFX "1828 Fasedocument Tracker" — services, data, and integrations

Scope: `/Users/alessandrogarcia/Desktop/GarciaGaspar/1828/desktop-app`. All findings below are read directly from source. Supporting models (`User.kt`, `Models.kt`, `Attachment.kt`, `AppState.kt`, `Strings.kt`, `WebOpen.kt`, `Main.kt`) were read where the audited services depend on them.

---

## 1. AuthService — `/Users/alessandrogarcia/Desktop/GarciaGaspar/1828/desktop-app/src/main/kotlin/app/auth/AuthService.kt`

`object AuthService` (Kotlin singleton). Entirely **in-memory** — no persistence of any kind; the KDoc itself says "Suitable for the prototype only — no persistence, passwords stored as SHA-256 (not salted). Wire to a real backend before deploying."

### Storage

| Field | Type | Mutability | Semantics |
|---|---|---|---|
| `users` | `LinkedHashMap<String, User>` | `private val` (map contents mutable) | Keyed by email; insertion order preserved (matters for `all()` listing order). |
| `resetCodes` | `mutableMapOf<String, String>()` | `private val` | Canonical email → active 6-digit reset code. |

### Seeded users (`init { seed() }`)

| Email | Password (plaintext) | Stored as | Display name | Role | Status | Access grants |
|---|---|---|---|---|---|---|
| `ernest@1828.nl` | `ernest` | SHA-256 hex | `Ernest` | `OWNER` | `ACTIVE` | `accessAllCities = true` |
| `pia@1828.nl` | `test` | SHA-256 hex | `Pia (PM)` | `PM` | `ACTIVE` | `cityAccess = mutableSetOf("Leiden")` |
| `niels@1828.nl` | `test` | SHA-256 hex | `Niels (OM)` | `OM` | `PENDING` | none (seeded pending so the demo approval inbox isn't empty) |

Comment in code: "Ernest is the only owner. He approves new accounts and unlocks phases."

### Password hashing

`private fun hash(s: String): String` — `MessageDigest.getInstance("SHA-256")` over the UTF-8 bytes, output as lowercase hex via `joinToString("") { "%02x".format(it) }`. **No salt, no iterations, no pepper.** Comparison is plain string equality of hex digests.

### Functions

| Function | Signature | Exact semantics |
|---|---|---|
| `register` | `private fun register(u: User)` | `users[u.email] = u` (overwrites silently if key exists; only reachable via seed/signup which pre-checks). |
| `login` | `fun login(email: String, password: String): LoginResult` | Key = `email.lowercase().trim()`. Unknown key → `UnknownEmail`. Hash mismatch → `BadPassword`. Then by status: `PENDING → Pending`, `REJECTED → Rejected`, `ACTIVE → Ok(u)`. |
| `signup` | `fun signup(email, password, displayName, requestedRole: UserRole): SignupResult` | Key = lowercased/trimmed. `InvalidEmail` if key blank or lacks `"@"` (that is the *entire* email validation). `WeakPassword` if `password.length < 4`. `AlreadyExists` if key present. Otherwise creates `User(status = PENDING)`; `displayName` trimmed, falls back to `key.substringBefore("@")` if blank; role is whatever was requested (owner approval gates activation, not role choice). Returns `Ok(u)`. |
| `all` | `fun all(): List<User>` | Snapshot copy of all users in insertion order. |
| `pending` | `fun pending(): List<User>` | Users with `status == PENDING`. |
| `approve` | `fun approve(email: String)` | Sets `status = ACTIVE` if user found. **Note:** no lowercase/trim normalization here (nor in `reject`/`setRole`) — works only because stored keys are already canonical. |
| `reject` | `fun reject(email: String)` | Sets `status = REJECTED`. |
| `setRole` | `fun setRole(email: String, role: UserRole)` | Mutates `role` in place. |
| `requestPasswordReset` | `fun requestPasswordReset(email: String): String?` | Normalizes email; returns `null` if unknown (no user enumeration protection beyond that — the UI decides). Code = `(100000..999999).random().toString()` (6 digits, `kotlin.random`, not `SecureRandom`). Stored in `resetCodes[u.email]` (overwrites any previous code — only the latest is valid). Sends the email via `Notifications.passwordReset(u, code)`. **Returns the code** (doc: "for tests"). |
| `completePasswordReset` | `fun completePasswordReset(email, code, newPassword): ResetResult` | `UnknownEmail` if no user. `BadCode` if no stored code or `stored != code.trim()`. `WeakPassword` if `< 4` chars. Success: `u.passwordHash = hash(newPassword)`, code removed (single-use). **Codes have no time expiry** — they live until used, replaced, or the account is removed. |
| `changePassword` | `fun changePassword(email, current, newPassword): ChangeResult` | For signed-in users. `BadCurrent` covers *both* unknown email and wrong current password (deliberately conflated). `WeakPassword` if `< 4`. Success mutates `passwordHash`, returns `Ok`. |
| `remove` | `fun remove(email: String): Boolean` | Normalizes key. `false` if unknown. **Guard: `if (u.role == UserRole.OWNER) return false`** — owners can never be removed (doc: "Ernest is the safety anchor"). Otherwise removes from `users` *and* `resetCodes`, returns `true`. (Attachment `addedBy` handover on removal is handled elsewhere, see §6.) |

### Result sealed classes (all nested in `AuthService`)

| Sealed class | Variants |
|---|---|
| `LoginResult` | `data class Ok(val user: User)`, `object UnknownEmail`, `object BadPassword`, `object Pending`, `object Rejected` |
| `SignupResult` | `data class Ok(val user: User)`, `object InvalidEmail`, `object WeakPassword`, `object AlreadyExists` |
| `ResetResult` | `object Ok`, `object UnknownEmail`, `object BadCode`, `object WeakPassword` |
| `ChangeResult` | `object Ok`, `object BadCurrent`, `object WeakPassword` |

### Supporting model — `/Users/alessandrogarcia/Desktop/GarciaGaspar/1828/desktop-app/src/main/kotlin/app/model/User.kt`

- `enum class UserRole { OWNER, PM, OM, PO, PPM, MT }` — comments: OWNER = Ernest, sees everything, only approver of phase submissions and signups; PM = project manager (submits phases); OM = development manager; PO = project developer; PPM = property manager; MT = management team. Account role is explicitly *distinct* from the RASCI letters on tasks.
- `enum class UserStatus { PENDING, ACTIVE, REJECTED }`
- `class User`: `val email: String`, `var passwordHash: String`, `val displayName: String`, `var role: UserRole`, `var status: UserStatus = PENDING`, `var accessAllCities: Boolean = false` (owners get blanket access), `val cityAccess: MutableSet<String>` (city grant implies every project under it), `val projectAccess: MutableSet<String>` (fine-grained project grants outside cityAccess).
- `fun rasciFilterKey(): String` — `OWNER → "all"`, otherwise the role name as string (`"OM"`, `"PO"`, `"PM"`, `"PPM"`, `"MT"`); drives the task-level RASCI filter.

---

## 2. EmailService — `/Users/alessandrogarcia/Desktop/GarciaGaspar/1828/desktop-app/src/main/kotlin/app/notify/EmailService.kt`

Top-level declarations in the same file:

- `enum class NotifyEvent { DELIVERABLE_SUBMITTED, APPROVAL_REQUESTED, PHASE_APPROVED, PHASE_REJECTED, PASSWORD_RESET }`
- `class EmailMessage(val event: NotifyEvent, val from: String, val to: List<String>, val subject: String, val body: String, val timestamp: LocalDateTime = LocalDateTime.now(), @Volatile var deliveredVia: String = "outbox")` — everything immutable except `deliveredVia`, which is `@Volatile var` because the SMTP thread mutates it while the UI thread reads it.

`object EmailService`. Design (from KDoc): every message *always* lands in the in-app outbox and as an `.eml` file on disk; real SMTP delivery happens only when `smtp.properties` is present and enabled.

### Outbox semantics

- `val outbox: MutableList<EmailMessage>` — public, **newest first** (`send` does `outbox.add(0, msg)`). In-memory only; not persisted or reloaded.
- `fun visibleTo(userEmail: String, isOwner: Boolean): List<EmailMessage>` — owner sees everything (`outbox.toList()`); any other user only sees messages where `userEmail in it.to`.
- `fun send(event, from, to, subject, body): EmailMessage` — constructs the message, prepends to outbox, `runCatching { writeEml(msg) }` (disk failure silently swallowed), then `sendSmtpIfConfigured(msg)`, returns the message.

### Data directory & the `tracker.data.dir` override

```
private val dataDir: File
    get() = File(System.getProperty("tracker.data.dir")
        ?: (System.getProperty("user.home") + File.separator + ".1828-tracker"))
```

- JVM system property `tracker.data.dir` overrides the root; default is `~/.1828-tracker`. Evaluated on every access (it's a getter, not a cached val) — so tests/headless runs can point it at a temp dir.
- `fun outboxDir(): File = File(dataDir, "outbox").apply { mkdirs() }` — creates on demand. Opened in the OS file manager from LoginView (line 135) and OutboxView (line 47) via `WebOpen.openFolder`.

### .eml file format (exact)

`private val fileStamp = DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss_SSS")`

- Filename: `<timestamp>_<slug>.eml`, where slug = subject with every non-`[A-Za-z0-9]` run replaced by `_` (`Regex("[^A-Za-z0-9]+")`), `.take(40)`, `.trim('_')`.
- File body (written as one UTF-8 string, **CRLF** line endings between headers):
  1. `From: <from>`
  2. `To: <to joined with ", ">`
  3. `Subject: =?UTF-8?B?<Base64 of UTF-8 subject bytes>?=` — **RFC 2047 encoded-word, always applied** (unconditionally, not just for non-ASCII), because subjects contain emoji (✅ 📥 🎉 ↩ 🔑) and mail clients garble raw UTF-8 subjects. Uses `java.util.Base64.getEncoder()`.
  4. `Date: <DateTimeFormatter.RFC_1123_DATE_TIME of ZonedDateTime.now()>`
  5. `MIME-Version: 1.0`
  6. `Content-Type: text/plain; charset=UTF-8`
  7. `Content-Transfer-Encoding: 8bit`
  8. blank line (`\r\n`), then the raw body (body's own line endings are whatever `buildString`/`appendLine` produced, i.e. `\n`).

The files are intentionally double-clickable in Mail/Outlook.

### smtp.properties convention

`private val smtpConfig: Properties? by lazy { ... }` — loaded **once** (lazy) from `<dataDir>/smtp.properties`; `null` if the file doesn't exist.

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `"false"` | Must parse to `true` or SMTP is skipped entirely. |
| `host` | `"localhost"` | → `mail.smtp.host` |
| `port` | `"587"` | → `mail.smtp.port` |
| `username` | absent | Presence toggles `mail.smtp.auth=true` and installs an `Authenticator`. |
| `password` | `""` | Used with `username` in `PasswordAuthentication`. |
| `starttls` | `"true"` | → `mail.smtp.starttls.enable` |
| `from` | falls back to `msg.from` | Envelope/header From override. |

### jakarta.mail API calls (exact, all fully-qualified in source)

- `jakarta.mail.Session.getInstance(props, object : jakarta.mail.Authenticator() { override fun getPasswordAuthentication() = jakarta.mail.PasswordAuthentication(username, password) })` when `username` set, else `jakarta.mail.Session.getInstance(props)`.
- `jakarta.mail.internet.MimeMessage(session)` with: `setFrom(jakarta.mail.internet.InternetAddress(cfg.getProperty("from", msg.from)))`; `setRecipients(jakarta.mail.Message.RecipientType.TO, jakarta.mail.internet.InternetAddress.parse(msg.to.joinToString(",")))`; `setSubject(msg.subject, "UTF-8")`; `setText(msg.body, "UTF-8")`.
- `jakarta.mail.Transport.send(mime)`.

### Threading model & delivery status

- `send()` + `.eml` write are synchronous on the caller (JavaFX UI) thread.
- SMTP runs on a **new daemon `Thread` per message** (`Thread { ... }.apply { isDaemon = true }.start()`). Before spawning, `deliveredVia` is set to `"SMTP…"` (in-flight marker).
- On success: `deliveredVia = "SMTP ✓"`. On exception: `deliveredVia = "SMTP ✗ (<e.message truncated to 60 chars>)"`. Default when SMTP never runs: `"outbox"`.
- After either outcome the thread attempts `Platform.runLater { app.state.AppState.notifyChanged() }` inside `try/catch (Throwable)` — headless callers (no JavaFX toolkit started) just skip the UI refresh.

Electron-port note: the equivalents are a per-send async job, an observable `deliveredVia` status field, and an event-bus refresh.

---

## 3. Notifications — `/Users/alessandrogarcia/Desktop/GarciaGaspar/1828/desktop-app/src/main/kotlin/app/notify/Notifications.kt`

`object Notifications`. Timestamp format used in *every* body: `private val stamp = DateTimeFormatter.ofPattern("dd-MM-yyyy HH:mm")`. All strings via `app.ui.Strings.t(key)` with manual `{placeholder}` `.replace()` substitution.

### Recipient helpers

- `private fun activeOwners(): List<String>` — users with `role == OWNER && status == ACTIVE`, mapped to email.
- `private fun projectTeam(projectName: String): List<String>` — `ACTIVE` users, `role != OWNER`, passing `AppState.userCanAccessProject(user, projectName)`, mapped to email.

Access rules these depend on (`/Users/alessandrogarcia/Desktop/GarciaGaspar/1828/desktop-app/src/main/kotlin/app/state/AppState.kt`, lines 106–122):

- `userCanAccessCity(u, name)`: true if `u.accessAllCities || u.role == OWNER`; or `name in u.cityAccess`; or **any project whose `parentCity == name` is in `u.projectAccess`** (project grant makes the parent city visible).
- `userCanAccessProject(u, name)`: false if project unknown; true if `accessAllCities || OWNER`; or `proj.parentCity in u.cityAccess` (city grant covers all its projects); or `proj.name in u.projectAccess`.
- `isApprover() == isOwner()` — only the owner approves.

### Event composers (all six)

Common guard pattern: return silently if `AppState.currentUser == null` or the recipient list resolves empty (except `passwordReset`, which has no actor because the user is logged out).

| Composer | Trigger (call sites) | Event enum | From | Recipients | Subject key | Body construction |
|---|---|---|---|---|---|---|
| `deliverablesSubmitted(contextLabel: String, tasks: List<Task>)` | Task marked done: single — `TaskRow.kt:67`; batch (all tasks completed in a submit flow) — `TaskListView.kt:143`. Returns if `tasks` empty. | `DELIVERABLE_SUBMITTED` | actor email | **Active owners** | 1 task: `subjSubmitted1` with `{task}` = `deliverable.take(70)`; N: `subjSubmittedN` with `{n}`, `{ctx}` = contextLabel | Intro `mailSubmittedIntro1` / `mailSubmittedIntroN{n}`; blank; `lblContext: <contextLabel>`; `mailBy: <displayName> <email>`; `mailWhen: <now>`; blank; per task `• <deliverable>` then per attachment `   ↳ <name> — <url>` |
| `approvalRequested(projectName: String, phaseIdx: Int)` | PM submits a project phase — `ProjectView.kt:228`. Returns if project unknown. | `APPROVAL_REQUESTED` | actor email | **Active owners** | `subjApproval` `{project}` `{phase}`; phaseLabel = `"${phaseIdx+1}. ${PhaseData.projectPhases[phaseIdx].sheet}"` | `mailApprovalIntro{user}`; blank; `lblProject: <name> (<parentCity>)`; `lblPhase`; `mailWhen`; then **all attachments across the phase's tasks** (`phases[phaseIdx].tasks.flatMap { it.attachments }`): if non-empty, blank + `mailDocs (n):` + `• name — url` each; blank; `mailAction` |
| `phaseApproved(projectName, phaseIdx)` / `phaseRejected(...)` → `private phaseDecision(projectName, phaseIdx, approved: Boolean)` | Owner decision — `ApprovalsView.kt:111/119`, `ProjectView.kt:238/247` | `PHASE_APPROVED` / `PHASE_REJECTED` | actor email | `projectTeam(projectName)`, **fallback `activeOwners()` if empty** | `subjApproved` / `subjRejected` `{project}` `{phase}` | `mailApprovedIntro` / `mailRejectedIntro` `{user}`; blank; `lblProject: <name> (<parentCity>)`; `lblPhase`; `mailWhen`; **if approved**: blank + `mailNextPhase` with `{phase}` = `"${phaseIdx+2}. ${next.sheet}"`, or `mailLastPhase` when it was the final phase |
| `cityApprovalRequested(cityName: String)` | Gemeenteontwikkeling (city task list) submitted — `CityDetailView.kt:198`. Returns if city unknown. | `APPROVAL_REQUESTED` (shared with project flavor — outbox/inbox distinguish by subject only) | actor email | **Active owners** | `subjCityApproval` `{city}` | `mailCityApprovalIntro{user}`; blank; `lblCity`; `mailWhen`; docs from `city.tasks.flatMap { it.attachments }` (same `mailDocs` block); blank; `mailAction` |
| `cityDecision(cityName: String, approved: Boolean)` | Owner decision on a city submission — `ApprovalsView.kt:68/76`, `CityDetailView.kt:124/132` | `PHASE_APPROVED` / `PHASE_REJECTED` (reused) | actor email | ACTIVE non-owner users with `userCanAccessCity(it, cityName)`, **fallback owners** | `subjCityApproved` / `subjCityRejected` `{city}` | `mailCityApprovedIntro` / `mailCityRejectedIntro` `{user}`; blank; `lblCity`; `mailWhen`. No docs, no next-phase line. |
| `passwordReset(user: app.model.User, code: String)` | `AuthService.requestPasswordReset` (`AuthService.kt:89`) | `PASSWORD_RESET` | **hardcoded `"noreply@1828.nl"`** (only composer with no actor — user is logged out) | `listOf(user.email)` only | `subjReset` | `mailResetIntro`; blank; `    <code>` (4-space indent); blank; `mailWhen`; blank; `mailResetIgnore` |

### The i18n keys used (from `/Users/alessandrogarcia/Desktop/GarciaGaspar/1828/desktop-app/src/main/kotlin/app/ui/Strings.kt`; NL is the primary locale, EN mirror exists)

| Key | NL value | EN value |
|---|---|---|
| `subjSubmitted1` | `✅ Deliverable afgerond: {task}` | `✅ Deliverable completed: {task}` |
| `subjSubmittedN` | `✅ {n} deliverables afgerond — {ctx}` | `✅ {n} deliverables completed — {ctx}` |
| `subjApproval` | `📥 Goedkeuring gevraagd: {project} — {phase}` | `📥 Approval requested: {project} — {phase}` |
| `subjApproved` | `🎉 Fase goedgekeurd: {project} — {phase}` | `🎉 Phase approved: {project} — {phase}` |
| `subjRejected` | `↩ Fase afgewezen: {project} — {phase}` | `↩ Phase rejected: {project} — {phase}` |
| `subjCityApproval` | `📥 Goedkeuring gevraagd: Gemeenteontwikkeling — {city}` | `📥 Approval requested: Municipality development — {city}` |
| `subjCityApproved` | `🎉 Gemeenteontwikkeling goedgekeurd — {city}` | `🎉 Municipality development approved — {city}` |
| `subjCityRejected` | `↩ Indiening afgewezen: Gemeenteontwikkeling — {city}` | `↩ Submission rejected: Municipality development — {city}` |
| `subjReset` | `🔑 Code voor wachtwoord-reset` | `🔑 Password reset code` |
| `mailSubmittedIntro1` / `mailSubmittedIntroN` | `Er is een deliverable afgerond.` / `Er zijn {n} deliverables afgerond.` | `A deliverable has been completed.` / `{n} deliverables have been completed.` |
| `mailApprovalIntro` | `{user} vraagt goedkeuring voor een fase.` | `{user} requests approval for a phase.` |
| `mailApprovedIntro` / `mailRejectedIntro` | `{user} heeft de fase goedgekeurd.` / `{user} heeft de fase afgewezen. Controleer de taken en dien opnieuw in.` | `{user} approved the phase.` / `{user} rejected the phase. Review the tasks and resubmit.` |
| `mailCityApprovalIntro` | `{user} vraagt goedkeuring voor Gemeenteontwikkeling.` | `{user} requests approval for municipality development.` |
| `mailCityApprovedIntro` / `mailCityRejectedIntro` | `{user} heeft Gemeenteontwikkeling goedgekeurd. Projecten in de stad zijn ontgrendeld.` / `{user} heeft de indiening afgewezen. Controleer de taken en dien opnieuw in.` | `{user} approved municipality development. Projects in the city are unlocked.` / `{user} rejected the submission. Review the tasks and resubmit.` |
| `mailNextPhase` / `mailLastPhase` | `Volgende fase ontgrendeld: {phase}` / `Dit was de laatste fase van het project. 🎉` | `Next phase unlocked: {phase}` / `This was the final phase of the project. 🎉` |
| `mailAction` | `Actie: open de 1828 Tracker → Goedkeuringen om te beoordelen.` | `Action: open the 1828 Tracker → Approvals to review.` |
| `mailResetIntro` / `mailResetIgnore` | `Gebruik deze code om je wachtwoord opnieuw in te stellen:` / `Geen reset aangevraagd? Negeer deze e-mail.` | `Use this code to reset your password:` / `Didn't request a reset? Ignore this email.` |
| `mailBy` / `mailWhen` / `mailDocs` | `Door` / `Tijdstip` / `Documenten` | `By` / `Time` / `Documents` |
| `lblContext` / `lblProject` / `lblPhase` / `lblCity` | `Betreft` / `Project` / `Fase` / `Stad` | `Regarding` / `Project` / `Phase` / `City` |

---

## 4. ExcelExport — `/Users/alessandrogarcia/Desktop/GarciaGaspar/1828/desktop-app/src/main/kotlin/app/export/ExcelExport.kt`

`object ExcelExport`, single entry point `fun write(target: File)`. Const: `private const val HEADER_FONT_BOLD = true`.

### Apache POI surface (exact classes/calls)

- `org.apache.poi.xssf.usermodel.XSSFWorkbook` (xlsx), `XSSFCellStyle`
- `org.apache.poi.ss.util.WorkbookUtil.createSafeSheetName(...)` for sheet-name sanitizing, plus `.take(31)` (Excel's 31-char limit)
- `org.apache.poi.ss.usermodel.IndexedColors` (`WHITE.index`, `DARK_BLUE.index`), `FillPatternType.SOLID_FOREGROUND`
- Per-sheet: `wb.createSheet(name)`, `sheet.createRow(idx)`, `row.createCell(i)`, `cell.setCellValue(String)`, `cell.cellStyle = style`, `sheet.setColumnWidth(i, chars * 256)`
- Style: `wb.createCellStyle()`, `wb.createFont()` with `bold = true`, `color = WHITE`, `style.setFont(font)`, `fillForegroundColor = DARK_BLUE`, `fillPattern = SOLID_FOREGROUND`
- Output: `FileOutputStream(target).use { wb.write(it) }; wb.close()`

### Workbook structure

1. **Sheet `Overview`**: row 0 cell 0 = `Fasedocument Tracker — Export`; row 1 empty; row 2 = `Export: ${LocalDate.now()}`; row 3 = `Steden: ` + `AppState.cityOrder` joined `", "`; row 4 = `Projecten: ` + `AppState.projectOrder` joined.
2. **One sheet per city** (in `AppState.cityOrder` order): name = `createSafeSheetName("City_$name").take(31)`. Row 0 = `City: $name`; one blank row; styled header row; then one row per task in `AppState.cities[name]!!.tasks`; column widths applied.
3. **One sheet per project phase** (`AppState.projectOrder` × each of the project's phases): name = `createSafeSheetName("${pname.take(10)}_P${pi+1}_$phaseTitle").take(31)` where `phaseTitle = PhaseData.projectPhases[pi].sheet`. Rows: `Project: $pname`; `Phase ${pi+1}: $phaseTitle`; `Phase status: <Approved | Submitted | In progress>` (`approved` flag wins over `submitted`, else "In progress"); blank row; header row; task rows; widths.

### Header / columns / task row mapping

`headerCols = ["Step", "Blok", "Deliverable", "Status", "Documents", "R", "A", "S", "C", "I", "Custom"]` (11 columns, indices 0–10).

| Col | Header | Value written |
|---|---|---|
| 0 | Step | `t.step` |
| 1 | Blok | `t.blok` |
| 2 | Deliverable | `t.deliverable` |
| 3 | Status | `DONE → "Klaar / Done"`, `NA → "N.v.t. / N/A"`, `OPEN → "Open"` (bilingual literals, not via Strings) |
| 4 | Documents | attachments joined `"; "` as `"${it.name} — ${it.url}"` |
| 5–9 | R, A, S, C, I | `t.r`, `t.a`, `t.s`, `t.c`, `t.iCol` |
| 10 | Custom | `"yes"` if `t.custom` else `""` |

Column widths (chars, ×256 POI units): `[8, 32, 46, 14, 36, 6, 6, 6, 6, 6, 8]`. Header style: bold white font on dark-blue solid fill.

Invocation path: `ExportPanel.kt` opens a native `javafx.stage.FileChooser` (lines 75–77) with `ExtensionFilter("Excel", "*.xlsx")`, then calls `ExcelExport.write(file)`. Electron equivalent: `dialog.showSaveDialog` + a JS xlsx library (e.g. exceljs, which supports styles; SheetJS community edition does not).

---

## 5. PhaseData & phases.json

### `/Users/alessandrogarcia/Desktop/GarciaGaspar/1828/desktop-app/src/main/kotlin/app/data/PhaseData.kt`

`object PhaseData`:

- `val all: List<PhaseTemplate> by lazy { load() }` — loaded once from classpath resource `phases.json` (via `classLoader.getResourceAsStream`), UTF-8, parsed with `kotlinx.serialization.json.Json { ignoreUnknownKeys = true }` into `List<PhaseTemplate>`. Fails fast with `error("phases.json not found on classpath")`.
- `val cityPhase: PhaseTemplate get() = all[0]` — **phase 0, "Gemeenteontwikkeling", is the city phase** (used by the Cities section; it gates project work: projects in a city stay locked until the city list is submitted and owner-approved — see `City` class KDoc in Models.kt).
- `val projectPhases: List<PhaseTemplate> get() = all.drop(1)` — **phases 1..9 (Acquisitiefase → Garantiefase) are the project phases**. All `phaseIdx` values in Notifications/ExcelExport index into this dropped list, so `phaseIdx 0` = Acquisitiefase.

### Template models (`/Users/alessandrogarcia/Desktop/GarciaGaspar/1828/desktop-app/src/main/kotlin/app/model/Models.kt`)

`@Serializable data class PhaseTemplate(val sheet: String, val tasks: List<TaskTemplate>)`

`@Serializable data class TaskTemplate` — every field has a default (so sparse JSON parses):

| Field | Type | Default | Meaning |
|---|---|---|---|
| `row` | `Int` | `0` | Row number in the original Excel phase document |
| `step` | `String` | `""` | Step number, e.g. `"1.1"` |
| `blok` | `String` | `""` | Block/section title, e.g. `"Selectie en beoordeling van kansrijke gemeenten"` |
| `deliverable` | `String` | `""` | The deliverable text |
| `existingLink` | `String` | `""` | Pre-existing document URL from the phase doc; becomes an `Attachment` (addedBy `"Fasedocument"`) at instantiation |
| `r`, `a`, `s`, `c`, `i` | `String` | `""` | RASCI role letters (values seen: `OM`, `PO`, `MT`, `PM`, `PPM`, or empty) |
| `opm` | `String` | `""` | Opmerking (remark) |

Runtime `Task` (mutable class, same file): `id: val String`; `step/blok/deliverable/r/a/s/c/iCol/opm: var String` (JSON's `i` becomes property `iCol`); `status: var TaskStatus = OPEN` (`enum TaskStatus { OPEN, DONE, NA }`); `attachments: val MutableList<Attachment>`; `custom: val Boolean = false` (admin-added rows are deletable, base rows are not). `val blokKey get() = "$step||$blok"`. Factories: `Task.fromTemplate(tmpl, prefix, idx)` → id `"${prefix}_b_$idx"`; `Task.custom(blokKey, deliverable)` → id `"c_${System.currentTimeMillis()}_$counter"`, splits blokKey on `"||"`.

Containers: `class City(val name, val tasks: MutableList<Task>, var submitted = false, var approved = false)`; `class Phase(val template: PhaseTemplate, val tasks: MutableList<Task>, var submitted = false, var approved = false)`; `class Project(val name, var parentCity: String, val phases: MutableList<Phase>)`.

### phases.json counts (verified with python3 over `/Users/alessandrogarcia/Desktop/GarciaGaspar/1828/desktop-app/src/main/resources/phases.json`)

**10 phases, 338 task templates total.**

| Index | `sheet` | Tasks | Role |
|---|---|---|---|
| 0 | Gemeenteontwikkeling | 26 | **City phase** (`cityPhase`) |
| 1 | Acquisitiefase | 27 | Project phase 1 |
| 2 | Haalbaarheidsfase | 22 | Project phase 2 |
| 3 | Ontwikkelfase VO | 49 | Project phase 3 |
| 4 | Ontwikkelfase DO | 52 | Project phase 4 |
| 5 | Ontwikkelfase TO | 33 | Project phase 5 |
| 6 | Ontwikkelfase UO | 26 | Project phase 6 |
| 7 | Verkoopfase | 26 | Project phase 7 |
| 8 | Realisatiefase | 51 | Project phase 8 |
| 9 | Garantiefase | 26 | Project phase 9 (final) |

---

## 6. External integrations inventory

### Google Drive — link classification only, no API

There is **no Drive API integration** anywhere — attachments are plain URLs classified by substring matching. `/Users/alessandrogarcia/Desktop/GarciaGaspar/1828/desktop-app/src/main/kotlin/app/model/Attachment.kt`:

`enum class DriveKind { GOOGLE_DOC, GOOGLE_SHEET, GOOGLE_SLIDES, GOOGLE_FORM, DRIVE_FOLDER, DRIVE_FILE, WEB_LINK }` with `companion fun detect(url: String)` — URL lowercased, then first match wins in this exact order:

| Order | Pattern (substring on lowercased URL) | Result |
|---|---|---|
| 1 | `docs.google.com/document` | `GOOGLE_DOC` |
| 2 | `docs.google.com/spreadsheets` | `GOOGLE_SHEET` |
| 3 | `docs.google.com/presentation` | `GOOGLE_SLIDES` |
| 4 | `docs.google.com/forms` **or** `forms.gle` | `GOOGLE_FORM` |
| 5 | `drive.google.com` **and** `/folders/` | `DRIVE_FOLDER` |
| 6 | `drive.google.com` | `DRIVE_FILE` |
| 7 | anything else | `WEB_LINK` |

`class Attachment(val id: String, var name: String, var url: String, val kind: DriveKind, var addedBy: String, val addedAt: LocalDateTime = now())` — `addedBy` is a mutable *display name*, explicitly documented as "reassigned when that user is removed" (document handover on account removal). Factory `Attachment.from(rawUrl, name?, addedBy)`: trims the URL; **auto-prefixes `https://` when `"://"` is absent**; id = `"att_${System.currentTimeMillis()}_$counter"` (private static counter); name falls back per kind — `"Google Doc"`, `"Google Sheet"`, `"Google Slides"`, `"Google Form"`, `"Drive folder"`, `"Drive file"`, and for `WEB_LINK` the `java.net.URI(url).host` or `"Link"`.

### Browser / OS opening — `/Users/alessandrogarcia/Desktop/GarciaGaspar/1828/desktop-app/src/main/kotlin/app/ui/WebOpen.kt`

`object WebOpen` with `var host: HostServices?` — injected once at startup (`Main.kt:21`: `WebOpen.host = hostServices`).

- `open(url)`: prefers JavaFX `HostServices.showDocument(url)`; fallback (headless/tests) shells out via `ProcessBuilder`, keyed on `System.getProperty("os.name")`: macOS `open <url>`, Windows `cmd /c start <url>`, else `xdg-open <url>`. All in `runCatching` (failures silent). Called from `AttachmentUi.kt:60` (clicking a document chip opens the link in the system browser).
- `openFolder(dir: File)`: macOS `open`, Windows `explorer`, Linux `xdg-open`, with `dir.absolutePath`. Called from `LoginView.kt:135` and `OutboxView.kt:47` to reveal the `.eml` outbox folder.

Electron equivalents: `shell.openExternal` / `shell.openPath` (or `showItemInFolder`).

### Everything else touching OS or network (complete inventory)

| Touchpoint | Where | Details |
|---|---|---|
| Filesystem: data dir | `EmailService.dataDir` | `~/.1828-tracker` or `-Dtracker.data.dir=<path>`; contains `outbox/` (`.eml` files) and optional `smtp.properties`. This is the app's **only** disk writer besides the Excel export. |
| Network: SMTP | `EmailService.sendSmtpIfConfigured` | jakarta.mail, opt-in via `smtp.properties`; the **only** network call in the entire app. |
| Native save dialog | `ExportPanel.kt:75-77` | `javafx.stage.FileChooser` + `ExtensionFilter("Excel", "*.xlsx")`; ExcelExport writes via `FileOutputStream`. |
| Classpath resources | `PhaseData.load()`, `Main.kt` | `phases.json`, `app.css`. |
| System properties read | `EmailService`, `WebOpen` | `tracker.data.dir`, `user.home`, `os.name`. |
| Process spawning | `WebOpen` | `open` / `cmd /c start` / `explorer` / `xdg-open` only. |

**Notably absent** (relevant for migration scoping): no database, no HTTP client, no OAuth, no Drive/Google APIs, no auto-update, no state persistence — users, cities, projects, tasks, attachments and the outbox all live in memory and reset on restart (the `.eml` files on disk are the only surviving artifacts). A headless test harness exists at `/Users/alessandrogarcia/Desktop/GarciaGaspar/1828/desktop-app/src/test/kotlin/app/AccessCheck.kt` (uses the `tracker.data.dir` override).

### Migration-relevant quirks worth carrying into the design doc

1. SHA-256 unsalted password hashing and in-memory users are explicitly prototype-only; the port needs a real backend/store.
2. Reset codes: 6-digit, non-cryptographic RNG, no expiry, single-use, returned to the caller.
3. `approve`/`reject`/`setRole` skip email normalization (safe today only because stored keys are canonical).
4. `NotifyEvent` is reused across city and project flows (`APPROVAL_REQUESTED`, `PHASE_APPROVED`, `PHASE_REJECTED` carry both) — differentiation is by subject text only.
5. `.eml` subject is *always* RFC 2047-encoded; body line endings are `\n` while headers are `\r\n`.
6. `phaseIdx` everywhere indexes `projectPhases` (i.e. `all[phaseIdx + 1]`), not the raw JSON array.
7. `ExcelExport` uses `AppState.cities[name]!!` / `projects[pname]!!` non-null assertions — ordering lists and maps must stay in sync in the port.
8. Attachment URL auto-prefix (`https://`) and per-kind default names are user-visible behavior to preserve.