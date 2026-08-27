package app.ui

import app.auth.AuthService
import app.model.User
import app.model.UserRole
import app.model.UserStatus
import app.state.AppState
import app.ui.Strings.t
import javafx.geometry.Insets
import javafx.geometry.Pos
import javafx.scene.Node
import javafx.scene.control.Button
import javafx.scene.control.ChoiceBox
import javafx.scene.control.Label
import javafx.scene.layout.FlowPane
import javafx.scene.layout.HBox
import javafx.scene.layout.Priority
import javafx.scene.layout.VBox

/** Owner-only: list of users with role choice + per-city access toggles. */
object UserAdminView {
    fun build(): Node {
        if (!AppState.isOwner()) return Label(t("needsApprover")).apply { styleClass += "phase-meta" }

        val crumbs = Label("${t("dashboardTitle")} / ${t("userAdminTitle")}").apply { styleClass += "crumbs" }
        val title = Label("👥  " + t("userAdminTitle")).apply { styleClass += "page-title" }
        val sub = Label(t("userAdminSub")).apply { styleClass += "page-sub" }
        val hint = Label(t("managerAccessHint")).apply { styleClass += "muted" }

        val rows = VBox(8.0).apply {
            AuthService.all().forEach { children += userRow(it) }
        }
        return VBox(12.0, crumbs, title, sub, hint, rows).apply {
            padding = Insets(28.0)
        }
    }

    private fun userRow(u: User): Node {
        val nameLbl = Label(u.displayName).apply { styleClass += "list-row-title" }
        val emailLbl = Label(u.email).apply { styleClass += "list-row-meta" }
        val statusLbl = Label(statusLabel(u.status)).apply {
            styleClass += "status-chip"
            styleClass += when (u.status) {
                UserStatus.ACTIVE -> "status-active"
                UserStatus.PENDING -> "status-pending"
                UserStatus.REJECTED -> "status-rejected"
            }
        }
        val identity = VBox(2.0, HBox(8.0, nameLbl, statusLbl).apply { alignment = Pos.CENTER_LEFT }, emailLbl).apply {
            HBox.setHgrow(this, Priority.ALWAYS)
        }

        val roleBox = ChoiceBox<UserRole>().apply {
            items.setAll(*UserRole.values())
            value = u.role
            // Don't let the owner accidentally demote themselves.
            isDisable = u == AppState.currentUser
            valueProperty().addListener { _, _, newRole ->
                if (newRole != null) AuthService.setRole(u.email, newRole)
                AppState.notifyChanged()
            }
        }
        val roleCol = VBox(2.0, Label(t("colRole")).apply { styleClass += "field-label" }, roleBox).apply {
            minWidth = 140.0
        }

        val accessCol = VBox(4.0,
            Label(t("colAccess")).apply { styleClass += "field-label" },
            accessChips(u),
        )

        val actionsCol = HBox(6.0).apply { alignment = Pos.CENTER_RIGHT }
        when (u.status) {
            UserStatus.PENDING -> {
                actionsCol.children += Button(t("btnApprove")).apply {
                    styleClass.addAll("btn", "success", "tiny")
                    setOnAction { AuthService.approve(u.email); AppState.notifyChanged() }
                }
                actionsCol.children += Button(t("btnReject")).apply {
                    styleClass.addAll("btn", "danger", "tiny")
                    setOnAction { AuthService.reject(u.email); AppState.notifyChanged() }
                }
            }
            UserStatus.REJECTED -> {
                actionsCol.children += Button(t("btnApprove")).apply {
                    styleClass.addAll("btn", "success", "tiny")
                    setOnAction { AuthService.approve(u.email); AppState.notifyChanged() }
                }
            }
            UserStatus.ACTIVE -> {}
        }
        // Removal: never the owner (safety anchor), never yourself.
        if (u.role != UserRole.OWNER && u != AppState.currentUser) {
            actionsCol.children += Button(t("btnRemoveUser")).apply {
                styleClass.addAll("btn", "danger", "tiny")
                setOnAction { promptRemoveUser(u) }
            }
        }

        return HBox(14.0, identity, roleCol, accessCol, actionsCol).apply {
            styleClass += "list-row"
            alignment = Pos.TOP_LEFT
            padding = Insets(12.0, 16.0, 12.0, 16.0)
        }
    }

    private fun accessChips(u: User): Node {
        val flow = FlowPane(6.0, 6.0)
        // "All" chip — owners and any user with accessAllCities flag.
        val allChip = Button(t("accessAll")).apply {
            styleClass += "role-chip"
            if (u.accessAllCities || u.role == UserRole.OWNER) styleClass += "active-chip"
            isDisable = u.role == UserRole.OWNER          // OWNER implies all
            setOnAction {
                u.accessAllCities = !u.accessAllCities
                AppState.notifyChanged()
            }
        }
        flow.children += allChip

        AppState.cityOrder.forEach { city ->
            val chip = Button(city).apply {
                styleClass += "role-chip"
                if (u.accessAllCities || u.role == UserRole.OWNER || city in u.cityAccess) styleClass += "active-chip"
                isDisable = u.accessAllCities || u.role == UserRole.OWNER
                setOnAction {
                    if (city in u.cityAccess) u.cityAccess.remove(city) else u.cityAccess.add(city)
                    AppState.notifyChanged()
                }
            }
            flow.children += chip
        }
        return flow
    }

    private fun statusLabel(s: UserStatus): String = when (s) {
        UserStatus.ACTIVE -> t("statusActive")
        UserStatus.PENDING -> t("statusPending")
        UserStatus.REJECTED -> t("statusRejected")
    }

    /** Pick a replacement, hand over the removed user's documents, then delete the account. */
    private fun promptRemoveUser(u: User) {
        val candidates = AuthService.all().filter {
            it.email != u.email && it.status == UserStatus.ACTIVE
        }
        // Owner first, so Ernest is the default hand-over target.
        val sorted = candidates.sortedByDescending { it.role == UserRole.OWNER }
        if (sorted.isEmpty()) return

        val dialog = javafx.scene.control.Dialog<javafx.scene.control.ButtonType>()
        dialog.title = t("removeUserTitle")
        dialog.headerText = null

        val prompt = Label(t("removeUserPrompt").replace("{user}", u.displayName)).apply {
            isWrapText = true
            maxWidth = 360.0
        }
        val replBox = ChoiceBox<User>().apply {
            items.setAll(sorted)
            converter = object : javafx.util.StringConverter<User>() {
                override fun toString(x: User?) = x?.let { "${it.displayName} (${it.role})" } ?: ""
                override fun fromString(s: String?) = sorted.firstOrNull { "${it.displayName} (${it.role})" == s }
            }
            value = sorted.first()
            maxWidth = Double.MAX_VALUE
        }
        dialog.dialogPane.content = javafx.scene.layout.VBox(12.0, prompt, replBox).apply {
            padding = javafx.geometry.Insets(10.0)
        }
        val removeType = javafx.scene.control.ButtonType(
            t("removeUserConfirmBtn"), javafx.scene.control.ButtonBar.ButtonData.OK_DONE,
        )
        dialog.dialogPane.buttonTypes.addAll(removeType, javafx.scene.control.ButtonType.CANCEL)
        dialog.setResultConverter { it }

        val result = dialog.showAndWait()
        if (!result.isPresent || result.get() != removeType) return

        val replacement = replBox.value ?: return
        val moved = AppState.reassignAttachments(u.displayName, replacement.displayName)
        if (!AuthService.remove(u.email)) {
            javafx.scene.control.Alert(
                javafx.scene.control.Alert.AlertType.WARNING, t("cannotRemoveOwner"),
            ).showAndWait()
            return
        }
        javafx.scene.control.Alert(
            javafx.scene.control.Alert.AlertType.INFORMATION,
            t("removedInfo")
                .replace("{user}", u.displayName)
                .replace("{n}", moved.toString())
                .replace("{to}", replacement.displayName),
        ).showAndWait()
        AppState.notifyChanged()
    }
}
