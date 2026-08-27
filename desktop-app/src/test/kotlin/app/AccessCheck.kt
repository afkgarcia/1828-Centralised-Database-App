package app

import app.auth.AuthService
import app.notify.EmailService
import app.notify.Notifications
import app.state.AppState
import app.model.UserRole
import java.io.File

/** Lightweight runnable sanity check for auth + access control. Run via:
 *  ./gradlew accessCheck */
fun main() {
    // Keep check artifacts out of the real ~/.1828-tracker directory.
    val checkDir = File("build/tmp/tracker-check")
    checkDir.deleteRecursively()
    System.setProperty("tracker.data.dir", checkDir.absolutePath)

    AppState.addCity("Leiden"); AppState.addCity("Amsterdam"); AppState.addCity("Utrecht")
    AppState.addProject("Pieterskwartier", parentCity = "Leiden")
    AppState.addProject("Sloterdijk Noord", parentCity = "Amsterdam")
    AppState.addProject("Utrecht Oost", parentCity = "Utrecht")

    fun line(label: String, value: Any?) = println("  $label: $value")

    println("\n== OWNER (Ernest) ==")
    val ernest = (AuthService.login("ernest@1828.nl", "ernest") as AuthService.LoginResult.Ok).user
    AppState.login(ernest)
    line("cities", AppState.accessibleCities())
    line("Leiden projects", AppState.projectsForCity("Leiden").map { it.name })
    line("isApprover", AppState.isApprover())

    println("\n== PM (Pia, scoped to Leiden) ==")
    val pia = (AuthService.login("pia@1828.nl", "test") as AuthService.LoginResult.Ok).user
    AppState.login(pia)
    line("cities", AppState.accessibleCities())
    line("Leiden projects", AppState.projectsForCity("Leiden").map { it.name })
    line("Amsterdam projects", AppState.projectsForCity("Amsterdam").map { it.name })
    line("canAccess(Pieterskwartier)", AppState.canAccessProject("Pieterskwartier"))
    line("canAccess(Sloterdijk Noord)", AppState.canAccessProject("Sloterdijk Noord"))
    line("isApprover", AppState.isApprover())

    println("\n== Login failure paths ==")
    line("pending niels login", AuthService.login("niels@1828.nl", "test")::class.simpleName)
    line("wrong password", AuthService.login("ernest@1828.nl", "wrong")::class.simpleName)
    line("unknown email", AuthService.login("ghost@1828.nl", "x")::class.simpleName)

    println("\n== Approval flow ==")
    AppState.login(ernest)
    val proj = AppState.projects["Pieterskwartier"]!!
    proj.phases[0].submitted = true
    line("phase 1 unlocked BEFORE approve", AppState.isPhaseUnlocked("Pieterskwartier", 1))
    line("owner pending inbox count", AppState.pendingPhaseSubmissions().size)
    proj.phases[0].submitted = false; proj.phases[0].approved = true
    line("phase 1 unlocked AFTER approve", AppState.isPhaseUnlocked("Pieterskwartier", 1))

    println("\n== Signup ==")
    val r = AuthService.signup("test@1828.nl", "test", "Test User", UserRole.PO)
    line("signup result", r::class.simpleName)
    line("signup login result", AuthService.login("test@1828.nl","test")::class.simpleName)
    AuthService.approve("test@1828.nl")
    line("after approve, login result", AuthService.login("test@1828.nl","test")::class.simpleName)

    println("\n== Email notifications ==")
    AppState.login(pia)
    Notifications.deliverablesSubmitted(
        "Leiden — Gemeenteontwikkeling",
        listOf(AppState.cities["Leiden"]!!.tasks.first()),
    )
    Notifications.approvalRequested("Pieterskwartier", 1)
    line("outbox size after PM actions", EmailService.outbox.size)
    line("deliverable mail to (owners)", EmailService.outbox[1].to)
    line("approval-request mail to (owners)", EmailService.outbox[0].to)
    AppState.login(ernest)
    Notifications.phaseApproved("Pieterskwartier", 1)
    line("approved mail to (team)", EmailService.outbox[0].to)
    line("approved mail subject", EmailService.outbox[0].subject)
    line("eml files written", EmailService.outboxDir().listFiles()?.size)
    line("PM-visible mails (pia)", EmailService.visibleTo("pia@1828.nl", false).size)
    line("owner-visible mails", EmailService.visibleTo("ernest@1828.nl", true).size)

    println("\n== Google Drive attachments ==")
    val docAtt = app.model.Attachment.from("https://docs.google.com/document/d/1XyZ/edit", null, "Check")
    line("detected kind (doc)", docAtt.kind)
    line("default name", docAtt.name)
    val sheetAtt = app.model.Attachment.from("docs.google.com/spreadsheets/d/1Abc/edit", "G40 lijst", "Check")
    line("scheme auto-added", sheetAtt.url.startsWith("https://"))
    line("named attachment", sheetAtt.name)
    line("folder kind", app.model.DriveKind.detect("https://drive.google.com/drive/folders/1Xyz"))
    line("plain link kind", app.model.DriveKind.detect("https://example.com/rapport.pdf"))

    // Approval-request email lists the phase's documents.
    val reviewTask = AppState.projects["Pieterskwartier"]!!.phases[2].tasks[0]
    reviewTask.attachments += docAtt
    AppState.login(pia)
    Notifications.approvalRequested("Pieterskwartier", 2)
    val mailBody = EmailService.outbox[0].body
    line("approval mail lists documents", "Documenten" in mailBody && docAtt.url in mailBody)

    println("\n== Password reset (self-service) ==")
    val badReset = AuthService.requestPasswordReset("ghost@1828.nl")
    line("unknown email returns null", badReset == null)
    val resetCode = AuthService.requestPasswordReset("pia@1828.nl")
    line("code generated", resetCode != null && resetCode.length == 6)
    line("reset mail event", EmailService.outbox[0].event)
    line("reset mail to", EmailService.outbox[0].to)
    line("wrong code rejected",
        AuthService.completePasswordReset("pia@1828.nl", "000000", "nieuw")::class.simpleName)
    line("correct code accepted",
        AuthService.completePasswordReset("pia@1828.nl", resetCode!!, "nieuw")::class.simpleName)
    line("old password now fails", AuthService.login("pia@1828.nl", "test")::class.simpleName)
    line("new password works", AuthService.login("pia@1828.nl", "nieuw")::class.simpleName)
    line("code single-use",
        AuthService.completePasswordReset("pia@1828.nl", resetCode, "weer")::class.simpleName)

    println("\n== Change password (signed in) ==")
    line("wrong current rejected",
        AuthService.changePassword("pia@1828.nl", "fout", "abcd")::class.simpleName)
    line("correct current accepted",
        AuthService.changePassword("pia@1828.nl", "nieuw", "abcd")::class.simpleName)
    line("login with changed pw", AuthService.login("pia@1828.nl", "abcd")::class.simpleName)

    println("\n== Remove user with document handover ==")
    val piaUser = (AuthService.login("pia@1828.nl", "abcd") as AuthService.LoginResult.Ok).user
    val handoverTask = AppState.cities["Leiden"]!!.tasks[3]
    handoverTask.attachments += app.model.Attachment.from(
        "https://docs.google.com/document/d/1PiaDoc/edit", "Pia's analyse", piaUser.displayName)
    line("owner cannot be removed", !AuthService.remove("ernest@1828.nl"))
    val moved = AppState.reassignAttachments(piaUser.displayName, ernest.displayName)
    line("documents handed over", moved)
    line("attachment now owned by", handoverTask.attachments.last().addedBy)
    line("account removed", AuthService.remove("pia@1828.nl"))
    line("removed user login", AuthService.login("pia@1828.nl", "abcd")::class.simpleName)
    line("user list size", AuthService.all().size)

    println("\n== Unfinished tasks on submit ==")
    // Mark-N/A path: Sloterdijk Noord phase 1 — complete some, leave the rest open.
    val slo = AppState.projects["Sloterdijk Noord"]!!
    slo.phases[0].tasks.take(5).forEach { it.status = app.model.TaskStatus.DONE }
    val sloOpenBefore = slo.phases[0].tasks.count { it.status == app.model.TaskStatus.OPEN }
    val naCount = AppState.markOpenTasksNa("Sloterdijk Noord", 0)
    line("open before N/A", sloOpenBefore)
    line("marked N/A", naCount)
    line("none open after", slo.phases[0].tasks.none { it.status == app.model.TaskStatus.OPEN })

    // Move-to-WIP path: Utrecht Oost phase 1 — complete all but 3, move the rest.
    val uo = AppState.projects["Utrecht Oost"]!!
    uo.phases[0].tasks.forEach { it.status = app.model.TaskStatus.DONE }
    uo.phases[0].tasks.take(3).forEach { it.status = app.model.TaskStatus.OPEN }
    val phase0Size = uo.phases[0].tasks.size
    val phase1Size = uo.phases[1].tasks.size
    val movedCount = AppState.moveOpenTasksToNextPhase("Utrecht Oost", 0)
    line("moved to next phase", movedCount)
    line("phase 1 shrank by", phase0Size - uo.phases[0].tasks.size)
    line("phase 2 grew by", uo.phases[1].tasks.size - phase1Size)
    line("moved tasks lead the next phase", uo.phases[1].tasks.take(3).all { it.step == AppState.WIP_STEP })
    line("moved tasks still open", uo.phases[1].tasks.take(3).all { it.status == app.model.TaskStatus.OPEN })
    line("WIP group key", uo.phases[1].tasks.first().blokKey)
    line("last phase has no next", AppState.moveOpenTasksToNextPhase("Utrecht Oost", 8))

    println("\n== City gate: Gemeenteontwikkeling before Acquisitiefase ==")
    val amsterdam = AppState.cities["Amsterdam"]!!
    line("phase 1 locked while city unapproved", !AppState.isPhaseUnlocked("Sloterdijk Noord", 0))
    amsterdam.tasks.forEach { it.status = app.model.TaskStatus.DONE }
    amsterdam.submitted = true
    line("pending city submissions", AppState.pendingCitySubmissions().map { it.name })
    amsterdam.submitted = false
    amsterdam.approved = true
    line("phase 1 unlocked after city approval", AppState.isPhaseUnlocked("Sloterdijk Noord", 0))
    line("phase 2 still gated by phase 1", !AppState.isPhaseUnlocked("Sloterdijk Noord", 1))
    line("pending city submissions after decision", AppState.pendingCitySubmissions().size)

    println("\nAll checks executed.")
}
