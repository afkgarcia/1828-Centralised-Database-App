package app.ui

import app.auth.AuthService
import app.state.AppState
import app.ui.Strings.t
import javafx.geometry.Insets
import javafx.geometry.Pos
import javafx.scene.Parent
import javafx.scene.control.Button
import javafx.scene.control.Hyperlink
import javafx.scene.control.Label
import javafx.scene.control.PasswordField
import javafx.scene.control.TextField
import javafx.scene.input.KeyCode
import javafx.scene.layout.HBox
import javafx.scene.layout.Priority
import javafx.scene.layout.StackPane
import javafx.scene.layout.VBox

object LoginView {
    private enum class Mode { LOGIN, SIGNUP, RESET }

    /** Which card is showing is purely UI state and lives here. */
    private var mode = Mode.LOGIN

    /** Reset flow: 1 = ask email, 2 = enter code + new password. */
    private var resetStep = 1
    private var resetEmail = ""

    fun build(): Parent {
        val header = headerBar(showBack = false, showAdminToggle = false, showAuthControls = false)

        val card = when (mode) {
            Mode.LOGIN -> loginCard()
            Mode.SIGNUP -> signupCard()
            Mode.RESET -> resetCard()
        }
        val center = StackPane(card).apply {
            padding = Insets(40.0)
            alignment = Pos.TOP_CENTER
        }
        VBox.setVgrow(center, Priority.ALWAYS)

        return VBox(header, center).apply { styleClass += "root" }
    }

    private fun loginCard(): VBox {
        val card = VBox(14.0).apply {
            styleClass += "setup-card"
            maxWidth = 420.0
            padding = Insets(28.0)
        }
        val title = Label(t("loginTitle")).apply { styleClass += "h2" }
        val sub = Label(t("loginSub")).apply { styleClass += "sub"; isWrapText = true }
        val error = Label().apply { styleClass += "form-error"; isVisible = false; isManaged = false }

        val email = TextField().apply { promptText = t("labelEmail") }
        val password = PasswordField().apply { promptText = t("labelPassword") }
        val loginBtn = Button(t("btnLogin")).apply { styleClass += "btn" }

        fun submit() {
            error.isVisible = false; error.isManaged = false
            val result = AuthService.login(email.text, password.text)
            when (result) {
                is AuthService.LoginResult.Ok -> {
                    AppState.login(result.user)
                    AppState.notifyChanged()
                }
                AuthService.LoginResult.UnknownEmail -> showError(error, t("loginFailUnknown"))
                AuthService.LoginResult.BadPassword -> showError(error, t("loginFailPassword"))
                AuthService.LoginResult.Pending -> showError(error, t("loginFailPending"))
                AuthService.LoginResult.Rejected -> showError(error, t("loginFailRejected"))
            }
        }
        loginBtn.setOnAction { submit() }
        password.setOnKeyPressed { if (it.code == KeyCode.ENTER) submit() }
        email.setOnKeyPressed { if (it.code == KeyCode.ENTER) password.requestFocus() }

        val signupLink = Hyperlink(t("createAccount")).apply {
            styleClass += "form-link"
            setOnAction { mode = Mode.SIGNUP; AppState.notifyChanged() }
        }
        val askRow = HBox(6.0, Label(t("noAccount")).apply { styleClass += "muted" }, signupLink).apply {
            alignment = Pos.CENTER_LEFT
        }

        val forgotLink = Hyperlink(t("forgotPassword")).apply {
            styleClass += "form-link"
            setOnAction { mode = Mode.RESET; resetStep = 1; resetEmail = ""; AppState.notifyChanged() }
        }

        val demoHint = Label(t("demoHint")).apply { styleClass += "muted" }

        card.children.addAll(
            title, sub, error,
            labelled(t("labelEmail"), email),
            labelled(t("labelPassword"), password),
            loginBtn, forgotLink, askRow, demoHint,
        )
        return card
    }

    private fun resetCard(): VBox {
        val card = VBox(12.0).apply {
            styleClass += "setup-card"
            maxWidth = 440.0
            padding = Insets(28.0)
        }
        val title = Label(t("resetTitle")).apply { styleClass += "h2" }
        val error = Label().apply { styleClass += "form-error"; isVisible = false; isManaged = false }
        val backLink = Hyperlink(t("backToLogin")).apply {
            styleClass += "form-link"
            setOnAction { mode = Mode.LOGIN; resetStep = 1; AppState.notifyChanged() }
        }

        if (resetStep == 1) {
            val sub = Label(t("resetSub")).apply { styleClass += "sub"; isWrapText = true }
            val email = TextField(resetEmail).apply { promptText = t("labelEmail") }
            val sendBtn = Button(t("btnSendCode")).apply { styleClass += "btn" }
            fun send() {
                error.isVisible = false; error.isManaged = false
                val code = app.auth.AuthService.requestPasswordReset(email.text)
                if (code == null) { showError(error, t("loginFailUnknown")); return }
                resetEmail = email.text.trim()
                resetStep = 2
                AppState.notifyChanged()
            }
            sendBtn.setOnAction { send() }
            email.setOnKeyPressed { if (it.code == KeyCode.ENTER) send() }
            card.children.addAll(title, sub, error, labelled(t("labelEmail"), email), sendBtn, backLink)
        } else {
            val sent = Label(t("resetCodeSent")).apply { styleClass += "sub"; isWrapText = true }
            val openFolder = Button(t("openOutboxFolder")).apply {
                styleClass.addAll("btn", "outline", "tiny")
                setOnAction { WebOpen.openFolder(app.notify.EmailService.outboxDir()) }
            }
            val code = TextField().apply { promptText = "123456" }
            val newPw = PasswordField().apply { promptText = t("labelNewPassword") }
            val confirmPw = PasswordField().apply { promptText = t("labelConfirmPassword") }
            val setBtn = Button(t("btnResetPassword")).apply { styleClass += "btn" }
            fun submit() {
                error.isVisible = false; error.isManaged = false
                if (newPw.text != confirmPw.text) { showError(error, t("pwMismatch")); return }
                when (app.auth.AuthService.completePasswordReset(resetEmail, code.text, newPw.text)) {
                    is app.auth.AuthService.ResetResult.Ok -> {
                        javafx.scene.control.Alert(
                            javafx.scene.control.Alert.AlertType.INFORMATION, t("resetSuccess")
                        ).showAndWait()
                        mode = Mode.LOGIN; resetStep = 1
                        AppState.notifyChanged()
                    }
                    is app.auth.AuthService.ResetResult.BadCode -> showError(error, t("resetFailBadCode"))
                    is app.auth.AuthService.ResetResult.WeakPassword -> showError(error, t("signupFailWeak"))
                    is app.auth.AuthService.ResetResult.UnknownEmail -> showError(error, t("loginFailUnknown"))
                }
            }
            setBtn.setOnAction { submit() }
            confirmPw.setOnKeyPressed { if (it.code == KeyCode.ENTER) submit() }
            card.children.addAll(
                title, sent, openFolder, error,
                labelled(t("labelCode"), code),
                labelled(t("labelNewPassword"), newPw),
                labelled(t("labelConfirmPassword"), confirmPw),
                setBtn, backLink,
            )
        }
        return card
    }

    private fun signupCard(): VBox {
        val card = VBox(12.0).apply {
            styleClass += "setup-card"
            maxWidth = 460.0
            padding = Insets(28.0)
        }
        val title = Label(t("signupTitle")).apply { styleClass += "h2" }
        val sub = Label(t("signupSub")).apply { styleClass += "sub"; isWrapText = true }
        val error = Label().apply { styleClass += "form-error"; isVisible = false; isManaged = false }

        val name = TextField().apply { promptText = t("labelName") }
        val email = TextField().apply { promptText = t("labelEmail") }
        val password = PasswordField().apply { promptText = t("labelPassword") }

        val roleChoices = listOf(
            app.model.UserRole.PM to t("rolePM"),
            app.model.UserRole.OM to t("roleOM"),
            app.model.UserRole.PO to t("rolePO"),
            app.model.UserRole.PPM to t("rolePPM"),
            app.model.UserRole.MT to t("roleMT"),
        )
        val roleBox = javafx.scene.control.ChoiceBox<Pair<app.model.UserRole, String>>().apply {
            items.setAll(roleChoices)
            converter = object : javafx.util.StringConverter<Pair<app.model.UserRole, String>>() {
                override fun toString(p: Pair<app.model.UserRole, String>?) = p?.second ?: ""
                override fun fromString(s: String?) = roleChoices.firstOrNull { it.second == s }
            }
            value = roleChoices.first()
            maxWidth = Double.MAX_VALUE
        }

        val submitBtn = Button(t("btnSignup")).apply { styleClass += "btn" }
        submitBtn.setOnAction {
            error.isVisible = false; error.isManaged = false
            val result = AuthService.signup(email.text, password.text, name.text, roleBox.value.first)
            when (result) {
                is AuthService.SignupResult.Ok -> {
                    showSubmittedConfirm(card)
                }
                AuthService.SignupResult.InvalidEmail -> showError(error, t("signupFailEmail"))
                AuthService.SignupResult.WeakPassword -> showError(error, t("signupFailWeak"))
                AuthService.SignupResult.AlreadyExists -> showError(error, t("signupFailExists"))
            }
        }

        val backLink = Hyperlink(t("backToLogin")).apply {
            styleClass += "form-link"
            setOnAction { mode = Mode.LOGIN; AppState.notifyChanged() }
        }
        val askRow = HBox(6.0, Label(t("haveAccount")).apply { styleClass += "muted" }, backLink).apply {
            alignment = Pos.CENTER_LEFT
        }

        card.children.addAll(
            title, sub, error,
            labelled(t("labelName"), name),
            labelled(t("labelEmail"), email),
            labelled(t("labelPassword"), password),
            labelled(t("labelRequestedRole"), roleBox),
            submitBtn, askRow,
        )
        return card
    }

    private fun showSubmittedConfirm(card: VBox) {
        card.children.clear()
        card.children.addAll(
            Label("✅  " + t("signupSubmitted")).apply { styleClass += "h2" },
            Label(t("signupSubmittedDesc")).apply { styleClass += "sub"; isWrapText = true },
            Button(t("backToLogin")).apply {
                styleClass.addAll("btn", "outline")
                setOnAction { mode = Mode.LOGIN; AppState.notifyChanged() }
            },
        )
    }

    private fun labelled(label: String, node: javafx.scene.Node): VBox {
        val lbl = Label(label).apply { styleClass += "field-label" }
        return VBox(4.0, lbl, node)
    }

    private fun showError(label: Label, text: String) {
        label.text = text
        label.isVisible = true
        label.isManaged = true
    }
}
