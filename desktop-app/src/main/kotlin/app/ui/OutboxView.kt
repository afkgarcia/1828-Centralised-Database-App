package app.ui

import app.notify.EmailMessage
import app.notify.EmailService
import app.notify.NotifyEvent
import app.state.AppState
import app.ui.Strings.t
import javafx.geometry.Insets
import javafx.geometry.Pos
import javafx.scene.Node
import javafx.scene.control.Button
import javafx.scene.control.Label
import javafx.scene.layout.HBox
import javafx.scene.layout.Priority
import javafx.scene.layout.VBox
import java.time.format.DateTimeFormatter

internal fun eventLabel(e: NotifyEvent): String = when (e) {
    NotifyEvent.DELIVERABLE_SUBMITTED -> t("evSubmitted")
    NotifyEvent.APPROVAL_REQUESTED -> t("evApprovalRequested")
    NotifyEvent.PHASE_APPROVED -> t("evApproved")
    NotifyEvent.PHASE_REJECTED -> t("evRejected")
    NotifyEvent.PASSWORD_RESET -> t("evReset")
}

internal fun eventCss(e: NotifyEvent): String = when (e) {
    NotifyEvent.DELIVERABLE_SUBMITTED -> "chip-submitted"
    NotifyEvent.APPROVAL_REQUESTED -> "chip-approval"
    NotifyEvent.PHASE_APPROVED -> "chip-approved"
    NotifyEvent.PHASE_REJECTED -> "chip-rejected"
    NotifyEvent.PASSWORD_RESET -> "chip-reset"
}

/** Sent-notifications list. Owner sees everything; colleagues see mail addressed to them. */
object OutboxView {
    private val stamp = DateTimeFormatter.ofPattern("dd-MM-yyyy HH:mm")

    fun build(): Node {
        val user = AppState.currentUser ?: return Label("")
        val mails = EmailService.visibleTo(user.email, AppState.isOwner())

        val crumbs = Label("${t("dashboardTitle")} / ${t("outboxTitle")}").apply { styleClass += "crumbs" }
        val title = Label("✉  " + t("outboxTitle")).apply { styleClass += "page-title" }
        val sub = Label(t("outboxSub")).apply { styleClass += "page-sub"; isWrapText = true }
        val openFolder = Button(t("openOutboxFolder")).apply {
            styleClass.addAll("btn", "outline", "tiny")
            setOnAction { WebOpen.openFolder(EmailService.outboxDir()) }
        }
        val headCol = VBox(2.0, title, sub).also { HBox.setHgrow(it, Priority.ALWAYS) }
        val headRow = HBox(12.0, headCol, openFolder).apply { alignment = Pos.CENTER_LEFT }

        val list = VBox(8.0)
        if (mails.isEmpty()) {
            list.children += Label(t("outboxEmpty")).apply { styleClass += "phase-meta" }
        } else {
            mails.forEach { list.children += mailRow(it) }
        }

        return VBox(12.0, crumbs, headRow, list).apply { padding = Insets(28.0) }
    }

    private fun mailRow(msg: EmailMessage): Node {
        val chip = Label(eventLabel(msg.event)).apply {
            styleClass += "event-chip"; styleClass += eventCss(msg.event)
        }
        val subjLbl = Label(msg.subject).apply { styleClass += "list-row-title"; isWrapText = true }
        val meta = Label(
            "${t("toLabel")}: ${msg.to.joinToString(", ")}   ·   ${t("fromLabel")}: ${msg.from}" +
                "   ·   ${msg.timestamp.format(stamp)}   ·   ${t("viaLabel")} ${msg.deliveredVia}"
        ).apply { styleClass += "list-row-meta" }

        val head = VBox(2.0, HBox(8.0, chip, subjLbl).apply { alignment = Pos.CENTER_LEFT }, meta)
        val body = Label(msg.body).apply {
            styleClass += "mail-body"
            isWrapText = true
            maxWidth = Double.MAX_VALUE
            isVisible = false; isManaged = false
        }
        val row = VBox(8.0, head, body).apply {
            styleClass += "list-row"
            padding = Insets(10.0, 14.0, 10.0, 14.0)
        }
        row.setOnMouseClicked {
            body.isVisible = !body.isVisible
            body.isManaged = body.isVisible
        }
        return row
    }

}
