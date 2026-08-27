package app.notify

import javafx.application.Platform
import java.io.File
import java.time.LocalDateTime
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Base64
import java.util.Properties

enum class NotifyEvent { DELIVERABLE_SUBMITTED, APPROVAL_REQUESTED, PHASE_APPROVED, PHASE_REJECTED, PASSWORD_RESET }

class EmailMessage(
    val event: NotifyEvent,
    val from: String,
    val to: List<String>,
    val subject: String,
    val body: String,
    val timestamp: LocalDateTime = LocalDateTime.now(),
    @Volatile var deliveredVia: String = "outbox",
)

/** Sends workflow emails. Every message always lands in the in-app outbox and as an
 *  .eml file on disk; real SMTP delivery happens only when smtp.properties is present
 *  and enabled. This keeps the demo self-contained while the send path stays real. */
object EmailService {
    /** Newest first. */
    val outbox: MutableList<EmailMessage> = mutableListOf()

    private val dataDir: File
        get() = File(System.getProperty("tracker.data.dir")
            ?: (System.getProperty("user.home") + File.separator + ".1828-tracker"))

    fun outboxDir(): File = File(dataDir, "outbox").apply { mkdirs() }

    fun visibleTo(userEmail: String, isOwner: Boolean): List<EmailMessage> =
        if (isOwner) outbox.toList() else outbox.filter { userEmail in it.to }

    fun send(event: NotifyEvent, from: String, to: List<String>, subject: String, body: String): EmailMessage {
        val msg = EmailMessage(event, from, to, subject, body)
        outbox.add(0, msg)
        runCatching { writeEml(msg) }
        sendSmtpIfConfigured(msg)
        return msg
    }

    // ── .eml file (double-clickable in Mail/Outlook) ─────────────────────────

    private val fileStamp = DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss_SSS")

    private fun writeEml(msg: EmailMessage) {
        val slug = msg.subject.replace(Regex("[^A-Za-z0-9]+"), "_").take(40).trim('_')
        val file = File(outboxDir(), "${msg.timestamp.format(fileStamp)}_$slug.eml")
        // Non-ASCII subjects (emoji) need RFC 2047 encoding or mail clients garble them.
        val encSubject = "=?UTF-8?B?" + Base64.getEncoder().encodeToString(msg.subject.toByteArray(Charsets.UTF_8)) + "?="
        file.writeText(buildString {
            append("From: ").append(msg.from).append("\r\n")
            append("To: ").append(msg.to.joinToString(", ")).append("\r\n")
            append("Subject: ").append(encSubject).append("\r\n")
            append("Date: ").append(DateTimeFormatter.RFC_1123_DATE_TIME.format(ZonedDateTime.now())).append("\r\n")
            append("MIME-Version: 1.0\r\n")
            append("Content-Type: text/plain; charset=UTF-8\r\n")
            append("Content-Transfer-Encoding: 8bit\r\n")
            append("\r\n")
            append(msg.body)
        }, Charsets.UTF_8)
    }

    // ── Optional real SMTP ───────────────────────────────────────────────────

    private val smtpConfig: Properties? by lazy {
        val f = File(dataDir, "smtp.properties")
        if (!f.exists()) null else Properties().apply { f.inputStream().use { load(it) } }
    }

    private fun sendSmtpIfConfigured(msg: EmailMessage) {
        val cfg = smtpConfig ?: return
        if (!cfg.getProperty("enabled", "false").toBoolean()) return
        msg.deliveredVia = "SMTP…"
        Thread {
            try {
                val props = Properties().apply {
                    put("mail.smtp.host", cfg.getProperty("host", "localhost"))
                    put("mail.smtp.port", cfg.getProperty("port", "587"))
                    put("mail.smtp.auth", (cfg.getProperty("username") != null).toString())
                    put("mail.smtp.starttls.enable", cfg.getProperty("starttls", "true"))
                }
                val session = if (cfg.getProperty("username") != null)
                    jakarta.mail.Session.getInstance(props, object : jakarta.mail.Authenticator() {
                        override fun getPasswordAuthentication() =
                            jakarta.mail.PasswordAuthentication(cfg.getProperty("username"), cfg.getProperty("password", ""))
                    })
                else jakarta.mail.Session.getInstance(props)
                val mime = jakarta.mail.internet.MimeMessage(session).apply {
                    setFrom(jakarta.mail.internet.InternetAddress(cfg.getProperty("from", msg.from)))
                    setRecipients(
                        jakarta.mail.Message.RecipientType.TO,
                        jakarta.mail.internet.InternetAddress.parse(msg.to.joinToString(",")),
                    )
                    setSubject(msg.subject, "UTF-8")
                    setText(msg.body, "UTF-8")
                }
                jakarta.mail.Transport.send(mime)
                msg.deliveredVia = "SMTP ✓"
            } catch (e: Exception) {
                msg.deliveredVia = "SMTP ✗ (${e.message?.take(60)})"
            }
            // Refresh the UI if the toolkit is running (headless callers just skip this).
            try { Platform.runLater { app.state.AppState.notifyChanged() } } catch (_: Throwable) {}
        }.apply { isDaemon = true }.start()
    }
}
