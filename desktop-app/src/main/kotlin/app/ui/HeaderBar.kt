package app.ui

import app.auth.AuthService
import app.notify.EmailService
import app.state.AppState
import app.state.View
import app.ui.Strings.t
import javafx.geometry.Pos
import javafx.scene.Node
import javafx.scene.control.Button
import javafx.scene.control.Label
import javafx.scene.layout.HBox
import javafx.scene.layout.Priority

/** Persistent app-wide header. */
fun headerBar(
    showBack: Boolean = true,
    showAdminToggle: Boolean = true,
    showAuthControls: Boolean = true,
): Node {
    val title = Label("1828 · Fasedocument Tracker").apply { styleClass += "h1" }
    val versionBadge = Label("v0.9 desktop").apply { styleClass += "v-badge" }

    val left = HBox(12.0, title, versionBadge).apply {
        alignment = Pos.CENTER_LEFT
        HBox.setHgrow(this, Priority.ALWAYS)
    }
    val user = AppState.currentUser
    if (user != null) {
        left.children += Label("${t("loggedInAs")}: ${user.displayName} (${user.role})").apply { styleClass += "meta" }
    }

    val rightChildren = mutableListOf<Node>()
    if (AppState.adminMode) rightChildren += Label(t("adminBadge")).apply { styleClass += "admin-badge" }

    val openCount = AppState.openTaskCount()
    if (openCount > 0) rightChildren += Label("$openCount ${t("statOpen").lowercase()}").apply { styleClass += "badge-open" }

    if (showAuthControls && user != null) {
        // Dashboard quick-jump
        if (AppState.view !is View.Dashboard) {
            rightChildren += Button(t("btnDashboard")).apply {
                styleClass.addAll("btn", "outline", "tiny")
                setOnAction { AppState.view = View.Dashboard; AppState.notifyChanged() }
            }
        }
        // Notifications outbox (all users; colleagues only see their own mail)
        val mailCount = EmailService.visibleTo(user.email, AppState.isOwner()).size
        val outboxLabel = if (mailCount > 0) "${t("btnOutbox")} ($mailCount)" else t("btnOutbox")
        rightChildren += Button(outboxLabel).apply {
            styleClass.addAll("btn", "outline", "tiny")
            setOnAction { AppState.view = View.Outbox; AppState.notifyChanged() }
        }
        // Owner-only inbox + admin
        if (AppState.isOwner()) {
            val pendingCount = AppState.pendingPhaseSubmissions().size +
                AppState.pendingCitySubmissions().size + AuthService.pending().size
            val approvalsLabel = if (pendingCount > 0) "${t("btnApprovals")}  ($pendingCount)" else t("btnApprovals")
            rightChildren += Button(approvalsLabel).apply {
                styleClass.addAll("btn", "outline", "tiny")
                if (pendingCount > 0) styleClass += "btn-highlight"
                setOnAction { AppState.view = View.Approvals; AppState.notifyChanged() }
            }
            rightChildren += Button(t("btnUserAdmin")).apply {
                styleClass.addAll("btn", "outline", "tiny")
                setOnAction { AppState.view = View.UserAdmin; AppState.notifyChanged() }
            }
        }
    }

    if (showBack && AppState.view !is View.Dashboard && user != null) {
        rightChildren += Button(t("btnBack")).apply {
            styleClass.addAll("btn", "outline", "tiny")
            setOnAction {
                AppState.view = when (val v = AppState.view) {
                    is View.ProjectView -> {
                        val parent = AppState.projects[v.projectName]?.parentCity
                        if (parent != null) View.CityDetail(parent) else View.Dashboard
                    }
                    is View.CityDetail -> View.Dashboard
                    else -> View.Dashboard
                }
                AppState.notifyChanged()
            }
        }
    }

    if (showAdminToggle && AppState.isOwner()) {
        val txt = if (AppState.adminMode) t("btnAdminOff") else t("btnAdminOn")
        rightChildren += Button(txt).apply {
            styleClass.addAll("btn", "outline", "tiny")
            setOnAction { AppState.adminMode = !AppState.adminMode; AppState.notifyChanged() }
        }
    }

    if (showAuthControls && user != null) {
        rightChildren += Button("🔑").apply {
            styleClass.addAll("btn", "outline", "tiny")
            tooltip = javafx.scene.control.Tooltip(t("changePwTitle"))
            setOnAction { changePasswordDialog(user.email) }
        }
        rightChildren += Button(t("btnLogout")).apply {
            styleClass.addAll("btn", "outline", "tiny")
            setOnAction { AppState.logout(); AppState.notifyChanged() }
        }
    }

    rightChildren += zoomControl()
    rightChildren += langToggle()

    val right = HBox(8.0, *rightChildren.toTypedArray()).apply { alignment = Pos.CENTER_RIGHT }

    return HBox(14.0, left, right).apply {
        styleClass += "header-bar"
        alignment = Pos.CENTER_LEFT
    }
}

/** Current-password → new-password dialog for the signed-in user. */
private fun changePasswordDialog(email: String) {
    val dialog = javafx.scene.control.Dialog<javafx.scene.control.ButtonType>()
    dialog.title = t("changePwTitle")
    dialog.headerText = null
    val current = javafx.scene.control.PasswordField().apply { promptText = t("labelCurrentPassword") }
    val newPw = javafx.scene.control.PasswordField().apply { promptText = t("labelNewPassword") }
    val confirm = javafx.scene.control.PasswordField().apply { promptText = t("labelConfirmPassword") }
    val grid = javafx.scene.layout.GridPane().apply {
        hgap = 10.0; vgap = 10.0
        padding = javafx.geometry.Insets(10.0)
        add(Label(t("labelCurrentPassword")), 0, 0); add(current, 1, 0)
        add(Label(t("labelNewPassword")), 0, 1); add(newPw, 1, 1)
        add(Label(t("labelConfirmPassword")), 0, 2); add(confirm, 1, 2)
    }
    dialog.dialogPane.content = grid
    dialog.dialogPane.buttonTypes.addAll(
        javafx.scene.control.ButtonType.OK, javafx.scene.control.ButtonType.CANCEL,
    )
    dialog.setResultConverter { it }
    val result = dialog.showAndWait()
    if (!result.isPresent || result.get() != javafx.scene.control.ButtonType.OK) return

    val alertType = javafx.scene.control.Alert.AlertType.WARNING
    if (newPw.text != confirm.text) {
        javafx.scene.control.Alert(alertType, t("pwMismatch")).showAndWait(); return
    }
    when (AuthService.changePassword(email, current.text, newPw.text)) {
        is AuthService.ChangeResult.Ok ->
            javafx.scene.control.Alert(javafx.scene.control.Alert.AlertType.INFORMATION, t("changePwSuccess")).showAndWait()
        is AuthService.ChangeResult.BadCurrent ->
            javafx.scene.control.Alert(alertType, t("changePwFailCurrent")).showAndWait()
        is AuthService.ChangeResult.WeakPassword ->
            javafx.scene.control.Alert(alertType, t("signupFailWeak")).showAndWait()
    }
}

/** Magnifier-style text-size control: 🔍 − 100% +. Click the percentage to reset. */
private fun zoomControl(): Node {
    val minus = Button("−").apply {
        styleClass += "zoom-btn"
        isDisable = AppState.zoomFactor <= AppState.ZOOM_LEVELS.first() + 0.001
        setOnAction { AppState.zoomOut(); AppState.notifyChanged() }
    }
    val plus = Button("+").apply {
        styleClass += "zoom-btn"
        isDisable = AppState.zoomFactor >= AppState.ZOOM_LEVELS.last() - 0.001
        setOnAction { AppState.zoomIn(); AppState.notifyChanged() }
    }
    val pct = Label("${(AppState.zoomFactor * 100).toInt()}%").apply {
        styleClass += "zoom-label"
        javafx.scene.control.Tooltip.install(this, javafx.scene.control.Tooltip(t("zoomTooltip")))
        setOnMouseClicked { AppState.zoomFactor = 1.0; AppState.notifyChanged() }
    }
    val icon = Label("🔍").apply { styleClass += "zoom-icon" }
    return HBox(2.0, icon, minus, pct, plus).apply {
        styleClass += "zoom-box"
        alignment = Pos.CENTER
    }
}

/** Two-button NL/EN segmented toggle. */
private fun langToggle(): Node {
    fun pill(label: String, lang: Strings.Lang): Button = Button(label).apply {
        styleClass += "lang-btn"
        if (Strings.lang == lang) styleClass += "active"
        setOnAction {
            if (Strings.lang != lang) {
                Strings.lang = lang
                AppState.notifyChanged()
            }
        }
    }
    val box = HBox(0.0, pill("NL", Strings.Lang.NL), pill("EN", Strings.Lang.EN))
    box.styleClass += "lang-toggle"
    box.alignment = Pos.CENTER
    return box
}

