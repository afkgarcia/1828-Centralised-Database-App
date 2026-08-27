package app.ui

import app.model.Attachment
import app.model.DriveKind
import app.model.Task
import app.state.AppState
import app.ui.Strings.t
import javafx.geometry.Insets
import javafx.geometry.Pos
import javafx.scene.Node
import javafx.scene.control.Alert
import javafx.scene.control.Button
import javafx.scene.control.ButtonType
import javafx.scene.control.Dialog
import javafx.scene.control.Label
import javafx.scene.control.TextField
import javafx.scene.control.Tooltip
import javafx.scene.layout.FlowPane
import javafx.scene.layout.GridPane
import javafx.scene.layout.HBox
import javafx.scene.layout.VBox

/** Shared UI for Google Drive / document attachments. */

internal fun kindIcon(kind: DriveKind): String = when (kind) {
    DriveKind.GOOGLE_DOC -> "📄"
    DriveKind.GOOGLE_SHEET -> "📊"
    DriveKind.GOOGLE_SLIDES -> "📽"
    DriveKind.GOOGLE_FORM -> "📝"
    DriveKind.DRIVE_FOLDER -> "📁"
    DriveKind.DRIVE_FILE -> "🗂"
    DriveKind.WEB_LINK -> "🔗"
}

internal fun kindLabel(kind: DriveKind): String = when (kind) {
    DriveKind.GOOGLE_DOC -> "Google Doc"
    DriveKind.GOOGLE_SHEET -> "Google Sheet"
    DriveKind.GOOGLE_SLIDES -> "Google Slides"
    DriveKind.GOOGLE_FORM -> "Google Form"
    DriveKind.DRIVE_FOLDER -> t("kindFolder")
    DriveKind.DRIVE_FILE -> t("kindFile")
    DriveKind.WEB_LINK -> t("kindLink")
}

/** A clickable chip for one document. Click opens the browser; ✕ removes (when allowed). */
internal fun docChip(att: Attachment, removable: Boolean, onRemove: () -> Unit): Node {
    val icon = Label(kindIcon(att.kind))
    val name = Label(att.name).apply { styleClass += "doc-chip-name" }
    val box = HBox(4.0, icon, name)
    if (removable) {
        val x = Label("✕").apply {
            styleClass += "doc-chip-x"
            setOnMouseClicked { ev -> ev.consume(); onRemove() }
        }
        box.children += x
    }
    box.styleClass += "doc-chip"
    box.alignment = Pos.CENTER_LEFT
    Tooltip.install(box, Tooltip("${kindLabel(att.kind)} · ${att.url}\n${att.addedBy}"))
    box.setOnMouseClicked { WebOpen.open(att.url) }
    return box
}

/** The per-task attachments cell used in TaskRow. */
internal fun attachmentCell(task: Task, locked: Boolean): Node {
    val flow = FlowPane(4.0, 4.0)
    flow.prefWrapLength = 250.0
    task.attachments.forEach { att ->
        flow.children += docChip(att, removable = !locked) {
            task.attachments.remove(att)
            AppState.notifyChanged()
        }
    }
    if (!locked) {
        flow.children += Button(t("addDocument")).apply {
            styleClass += "attach-add-btn"
            setOnAction { promptAttach(task) }
        }
    }
    return VBox(flow).apply { minWidth = 260.0; prefWidth = 260.0; maxWidth = 260.0 }
}

/** URL + optional name dialog; detects the Drive type from the URL. */
internal fun promptAttach(task: Task) {
    val dialog = Dialog<ButtonType>()
    dialog.title = t("attachDialogTitle")
    dialog.headerText = null

    val urlField = TextField().apply { promptText = "https://docs.google.com/…"; prefWidth = 380.0 }
    val nameField = TextField().apply { promptText = t("attachNameLabel") }
    val grid = GridPane().apply {
        hgap = 10.0; vgap = 10.0
        padding = Insets(10.0)
        add(Label(t("attachUrlLabel")), 0, 0); add(urlField, 1, 0)
        add(Label(t("attachNameLabel")), 0, 1); add(nameField, 1, 1)
    }
    dialog.dialogPane.content = grid
    dialog.dialogPane.buttonTypes.addAll(ButtonType.OK, ButtonType.CANCEL)
    dialog.setResultConverter { it }

    val result = dialog.showAndWait()
    if (result.isPresent && result.get() == ButtonType.OK) {
        val url = urlField.text.trim()
        if (url.isBlank() || "." !in url) {
            Alert(Alert.AlertType.WARNING, t("attachInvalidUrl")).showAndWait()
            return
        }
        val user = AppState.currentUser
        task.attachments += Attachment.from(url, nameField.text, user?.displayName ?: "?")
        AppState.notifyChanged()
    }
}

/** Flat list of every document in a phase — the reviewer's one-stop strip. */
internal fun reviewDocsStrip(docs: List<Attachment>): Node {
    val heading = Label("📎  ${t("reviewDocs")} (${docs.size})").apply { styleClass += "section-heading" }
    val flow = FlowPane(6.0, 6.0)
    docs.forEach { att -> flow.children += docChip(att, removable = false) {} }
    return VBox(8.0, heading, flow).apply {
        styleClass += "review-docs"
        padding = Insets(12.0, 22.0, 14.0, 22.0)
    }
}
