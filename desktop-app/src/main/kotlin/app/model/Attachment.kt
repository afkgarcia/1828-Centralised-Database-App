package app.model

import java.time.LocalDateTime

/** Recognized Google Drive document types, detected from the URL. */
enum class DriveKind {
    GOOGLE_DOC, GOOGLE_SHEET, GOOGLE_SLIDES, GOOGLE_FORM, DRIVE_FOLDER, DRIVE_FILE, WEB_LINK;

    companion object {
        fun detect(url: String): DriveKind {
            val u = url.lowercase()
            return when {
                "docs.google.com/document" in u -> GOOGLE_DOC
                "docs.google.com/spreadsheets" in u -> GOOGLE_SHEET
                "docs.google.com/presentation" in u -> GOOGLE_SLIDES
                "docs.google.com/forms" in u || "forms.gle" in u -> GOOGLE_FORM
                "drive.google.com" in u && "/folders/" in u -> DRIVE_FOLDER
                "drive.google.com" in u -> DRIVE_FILE
                else -> WEB_LINK
            }
        }
    }
}

/** A supporting document linked to a task. Everything a reviewer needs lives here. */
class Attachment(
    val id: String,
    var name: String,
    var url: String,
    val kind: DriveKind,
    /** Display name of who linked it. Mutable: reassigned when that user is removed. */
    var addedBy: String,
    val addedAt: LocalDateTime = LocalDateTime.now(),
) {
    companion object {
        private var counter = 0

        fun from(rawUrl: String, name: String?, addedBy: String): Attachment {
            var url = rawUrl.trim()
            if (url.isNotEmpty() && "://" !in url) url = "https://$url"
            val kind = DriveKind.detect(url)
            counter += 1
            return Attachment(
                id = "att_${System.currentTimeMillis()}_$counter",
                name = name?.trim().takeUnless { it.isNullOrBlank() } ?: defaultName(kind, url),
                url = url,
                kind = kind,
                addedBy = addedBy,
            )
        }

        private fun defaultName(kind: DriveKind, url: String): String = when (kind) {
            DriveKind.GOOGLE_DOC -> "Google Doc"
            DriveKind.GOOGLE_SHEET -> "Google Sheet"
            DriveKind.GOOGLE_SLIDES -> "Google Slides"
            DriveKind.GOOGLE_FORM -> "Google Form"
            DriveKind.DRIVE_FOLDER -> "Drive folder"
            DriveKind.DRIVE_FILE -> "Drive file"
            DriveKind.WEB_LINK -> runCatching { java.net.URI(url).host }.getOrNull() ?: "Link"
        }
    }
}
