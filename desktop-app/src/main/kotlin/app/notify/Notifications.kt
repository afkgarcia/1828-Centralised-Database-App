package app.notify

import app.auth.AuthService
import app.data.PhaseData
import app.model.Task
import app.model.UserRole
import app.model.UserStatus
import app.state.AppState
import app.ui.Strings.t
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

/** Composes the three workflow emails and resolves their recipients:
 *  - deliverable(s) submitted → active owners
 *  - approval requested       → active owners
 *  - phase approved/rejected  → active project team (falls back to owners) */
object Notifications {
    private val stamp = DateTimeFormatter.ofPattern("dd-MM-yyyy HH:mm")

    private fun activeOwners(): List<String> =
        AuthService.all()
            .filter { it.role == UserRole.OWNER && it.status == UserStatus.ACTIVE }
            .map { it.email }

    private fun projectTeam(projectName: String): List<String> =
        AuthService.all()
            .filter {
                it.status == UserStatus.ACTIVE && it.role != UserRole.OWNER &&
                    AppState.userCanAccessProject(it, projectName)
            }
            .map { it.email }

    fun deliverablesSubmitted(contextLabel: String, tasks: List<Task>) {
        if (tasks.isEmpty()) return
        val actor = AppState.currentUser ?: return
        val to = activeOwners()
        if (to.isEmpty()) return
        val subject = if (tasks.size == 1)
            t("subjSubmitted1").replace("{task}", tasks.first().deliverable.take(70))
        else
            t("subjSubmittedN").replace("{n}", tasks.size.toString()).replace("{ctx}", contextLabel)
        val body = buildString {
            appendLine(
                if (tasks.size == 1) t("mailSubmittedIntro1")
                else t("mailSubmittedIntroN").replace("{n}", tasks.size.toString())
            )
            appendLine()
            appendLine("${t("lblContext")}: $contextLabel")
            appendLine("${t("mailBy")}: ${actor.displayName} <${actor.email}>")
            appendLine("${t("mailWhen")}: ${LocalDateTime.now().format(stamp)}")
            appendLine()
            tasks.forEach { task ->
                append("• ").append(task.deliverable)
                appendLine()
                task.attachments.forEach { att ->
                    appendLine("   ↳ ${att.name} — ${att.url}")
                }
            }
        }
        EmailService.send(NotifyEvent.DELIVERABLE_SUBMITTED, actor.email, to, subject, body)
    }

    fun approvalRequested(projectName: String, phaseIdx: Int) {
        val actor = AppState.currentUser ?: return
        val proj = AppState.projects[projectName] ?: return
        val to = activeOwners()
        if (to.isEmpty()) return
        val phaseLabel = "${phaseIdx + 1}. ${PhaseData.projectPhases[phaseIdx].sheet}"
        val subject = t("subjApproval").replace("{project}", projectName).replace("{phase}", phaseLabel)
        val body = buildString {
            appendLine(t("mailApprovalIntro").replace("{user}", actor.displayName))
            appendLine()
            appendLine("${t("lblProject")}: $projectName (${proj.parentCity})")
            appendLine("${t("lblPhase")}: $phaseLabel")
            appendLine("${t("mailWhen")}: ${LocalDateTime.now().format(stamp)}")
            // Attach every supporting document so the reviewer has it all in one place.
            val docs = proj.phases.getOrNull(phaseIdx)?.tasks?.flatMap { it.attachments }.orEmpty()
            if (docs.isNotEmpty()) {
                appendLine()
                appendLine("${t("mailDocs")} (${docs.size}):")
                docs.forEach { att -> appendLine("• ${att.name} — ${att.url}") }
            }
            appendLine()
            appendLine(t("mailAction"))
        }
        EmailService.send(NotifyEvent.APPROVAL_REQUESTED, actor.email, to, subject, body)
    }

    fun phaseApproved(projectName: String, phaseIdx: Int) = phaseDecision(projectName, phaseIdx, approved = true)
    fun phaseRejected(projectName: String, phaseIdx: Int) = phaseDecision(projectName, phaseIdx, approved = false)

    /** Gemeenteontwikkeling submitted for approval → owners. */
    fun cityApprovalRequested(cityName: String) {
        val actor = AppState.currentUser ?: return
        val to = activeOwners()
        if (to.isEmpty()) return
        val city = AppState.cities[cityName] ?: return
        val subject = t("subjCityApproval").replace("{city}", cityName)
        val body = buildString {
            appendLine(t("mailCityApprovalIntro").replace("{user}", actor.displayName))
            appendLine()
            appendLine("${t("lblCity")}: $cityName")
            appendLine("${t("mailWhen")}: ${LocalDateTime.now().format(stamp)}")
            val docs = city.tasks.flatMap { it.attachments }
            if (docs.isNotEmpty()) {
                appendLine()
                appendLine("${t("mailDocs")} (${docs.size}):")
                docs.forEach { att -> appendLine("• ${att.name} — ${att.url}") }
            }
            appendLine()
            appendLine(t("mailAction"))
        }
        EmailService.send(NotifyEvent.APPROVAL_REQUESTED, actor.email, to, subject, body)
    }

    /** Gemeenteontwikkeling decision → team with access to that city (fallback: owners). */
    fun cityDecision(cityName: String, approved: Boolean) {
        val actor = AppState.currentUser ?: return
        val team = AuthService.all().filter {
            it.status == UserStatus.ACTIVE && it.role != UserRole.OWNER &&
                AppState.userCanAccessCity(it, cityName)
        }.map { it.email }
        val to = team.ifEmpty { activeOwners() }
        if (to.isEmpty()) return
        val subject = t(if (approved) "subjCityApproved" else "subjCityRejected").replace("{city}", cityName)
        val body = buildString {
            appendLine(
                t(if (approved) "mailCityApprovedIntro" else "mailCityRejectedIntro")
                    .replace("{user}", actor.displayName)
            )
            appendLine()
            appendLine("${t("lblCity")}: $cityName")
            appendLine("${t("mailWhen")}: ${LocalDateTime.now().format(stamp)}")
        }
        EmailService.send(
            if (approved) NotifyEvent.PHASE_APPROVED else NotifyEvent.PHASE_REJECTED,
            actor.email, to, subject, body,
        )
    }

    /** Password-reset code. Sent to the account owner only; no actor (user is logged out). */
    fun passwordReset(user: app.model.User, code: String) {
        val body = buildString {
            appendLine(t("mailResetIntro"))
            appendLine()
            appendLine("    $code")
            appendLine()
            appendLine("${t("mailWhen")}: ${LocalDateTime.now().format(stamp)}")
            appendLine()
            appendLine(t("mailResetIgnore"))
        }
        EmailService.send(
            NotifyEvent.PASSWORD_RESET,
            from = "noreply@1828.nl",
            to = listOf(user.email),
            subject = t("subjReset"),
            body = body,
        )
    }

    private fun phaseDecision(projectName: String, phaseIdx: Int, approved: Boolean) {
        val actor = AppState.currentUser ?: return
        val proj = AppState.projects[projectName] ?: return
        val to = projectTeam(projectName).ifEmpty { activeOwners() }
        if (to.isEmpty()) return
        val phaseLabel = "${phaseIdx + 1}. ${PhaseData.projectPhases[phaseIdx].sheet}"
        val subject = t(if (approved) "subjApproved" else "subjRejected")
            .replace("{project}", projectName).replace("{phase}", phaseLabel)
        val body = buildString {
            appendLine(t(if (approved) "mailApprovedIntro" else "mailRejectedIntro").replace("{user}", actor.displayName))
            appendLine()
            appendLine("${t("lblProject")}: $projectName (${proj.parentCity})")
            appendLine("${t("lblPhase")}: $phaseLabel")
            appendLine("${t("mailWhen")}: ${LocalDateTime.now().format(stamp)}")
            if (approved) {
                appendLine()
                val next = PhaseData.projectPhases.getOrNull(phaseIdx + 1)
                appendLine(
                    if (next != null) t("mailNextPhase").replace("{phase}", "${phaseIdx + 2}. ${next.sheet}")
                    else t("mailLastPhase")
                )
            }
        }
        EmailService.send(
            if (approved) NotifyEvent.PHASE_APPROVED else NotifyEvent.PHASE_REJECTED,
            actor.email, to, subject, body,
        )
    }
}
