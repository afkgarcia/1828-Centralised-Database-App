package app.ui

import app.auth.AuthService
import app.data.PhaseData
import app.notify.Notifications
import app.state.AppState
import app.state.View
import app.ui.Strings.t
import javafx.geometry.Insets
import javafx.geometry.Pos
import javafx.scene.Node
import javafx.scene.control.Button
import javafx.scene.control.Label
import javafx.scene.layout.HBox
import javafx.scene.layout.Priority
import javafx.scene.layout.VBox

/** Owner-only inbox: pending phase submissions + pending user signups. */
object ApprovalsView {
    fun build(): Node {
        if (!AppState.isOwner()) return Label(t("needsApprover")).apply { styleClass += "phase-meta" }

        val crumbs = Label("${t("dashboardTitle")} / ${t("approvalsTitle")}").apply { styleClass += "crumbs" }
        val title = Label("📥  " + t("approvalsTitle")).apply { styleClass += "page-title" }
        val sub = Label(t("approvalsSub")).apply { styleClass += "page-sub" }
        val titleBox = VBox(2.0, title, sub)

        val phasesSection = buildPhaseSubmissionsSection()
        val signupsSection = buildSignupsSection()

        return VBox(14.0, crumbs, titleBox, phasesSection, signupsSection).apply {
            padding = Insets(28.0)
        }
    }

    private fun buildPhaseSubmissionsSection(): Node {
        val heading = Label(t("phaseSubmissions")).apply { styleClass += "section-heading" }
        val cityItems = AppState.pendingCitySubmissions()
        val items = AppState.pendingPhaseSubmissions()
        val body: Node = if (items.isEmpty() && cityItems.isEmpty()) {
            Label("✅  " + t("noPhaseSubmissions")).apply { styleClass += "phase-meta" }
        } else {
            VBox(8.0).apply {
                // Gemeenteontwikkeling submissions first — they gate everything else.
                cityItems.forEach { city ->
                    val info = VBox(2.0,
                        Label("🏙️  ${city.name} · ${app.data.PhaseData.cityPhase.sheet}").apply { styleClass += "list-row-title" },
                        Label(t("cityGateHint")).apply { styleClass += "list-row-meta" },
                    )
                    val docs = city.tasks.flatMap { it.attachments }
                    if (docs.isNotEmpty()) {
                        val flow = javafx.scene.layout.FlowPane(6.0, 4.0)
                        docs.forEach { att -> flow.children += docChip(att, removable = false) {} }
                        info.children += flow
                    }
                    HBox.setHgrow(info, Priority.ALWAYS)
                    val openBtn = Button(t("openProject")).apply {
                        styleClass.addAll("btn", "outline", "tiny")
                        setOnAction {
                            AppState.view = View.CityDetail(city.name)
                            AppState.notifyChanged()
                        }
                    }
                    val approveBtn = Button(t("btnApprove")).apply {
                        styleClass.addAll("btn", "success", "tiny")
                        setOnAction {
                            city.submitted = false; city.approved = true
                            Notifications.cityDecision(city.name, approved = true)
                            AppState.notifyChanged()
                        }
                    }
                    val rejectBtn = Button(t("btnReject")).apply {
                        styleClass.addAll("btn", "danger", "tiny")
                        setOnAction {
                            city.submitted = false
                            Notifications.cityDecision(city.name, approved = false)
                            AppState.notifyChanged()
                        }
                    }
                    children += HBox(10.0, info, openBtn, approveBtn, rejectBtn).apply {
                        styleClass += "list-row"
                        alignment = Pos.CENTER_LEFT
                        padding = Insets(10.0, 14.0, 10.0, 14.0)
                    }
                }
                items.forEach { (proj, idx, phase) ->
                    val phaseSheet = PhaseData.projectPhases[idx].sheet
                    val info = VBox(2.0,
                        Label("🏗️  ${proj.name} · ${t("fase")} ${idx + 1}: $phaseSheet").apply { styleClass += "list-row-title" },
                        Label("${t("crumbCities")}: ${proj.parentCity}").apply { styleClass += "list-row-meta" },
                    )
                    // Everything the reviewer needs, one click away.
                    val docs = phase.tasks.flatMap { it.attachments }
                    if (docs.isNotEmpty()) {
                        val flow = javafx.scene.layout.FlowPane(6.0, 4.0)
                        docs.forEach { att -> flow.children += docChip(att, removable = false) {} }
                        info.children += flow
                    }
                    HBox.setHgrow(info, Priority.ALWAYS)
                    val openBtn = Button(t("openProject")).apply {
                        styleClass.addAll("btn", "outline", "tiny")
                        setOnAction {
                            AppState.view = View.ProjectView(proj.name, idx)
                            AppState.notifyChanged()
                        }
                    }
                    val approveBtn = Button(t("btnApprove")).apply {
                        styleClass.addAll("btn", "success", "tiny")
                        setOnAction {
                            phase.submitted = false; phase.approved = true
                            Notifications.phaseApproved(proj.name, idx)
                            AppState.notifyChanged()
                        }
                    }
                    val rejectBtn = Button(t("btnReject")).apply {
                        styleClass.addAll("btn", "danger", "tiny")
                        setOnAction {
                            phase.submitted = false
                            Notifications.phaseRejected(proj.name, idx)
                            AppState.notifyChanged()
                        }
                    }
                    children += HBox(10.0, info, openBtn, approveBtn, rejectBtn).apply {
                        styleClass += "list-row"
                        alignment = Pos.CENTER_LEFT
                        padding = Insets(10.0, 14.0, 10.0, 14.0)
                    }
                }
            }
        }
        return VBox(8.0, heading, body)
    }

    private fun buildSignupsSection(): Node {
        val heading = Label(t("pendingSignups")).apply { styleClass += "section-heading" }
        val items = AuthService.pending()
        val body: Node = if (items.isEmpty()) {
            Label("✅  " + t("noPendingSignups")).apply { styleClass += "phase-meta" }
        } else {
            VBox(8.0).apply {
                items.forEach { u ->
                    val info = VBox(2.0,
                        Label("👤  ${u.displayName}").apply { styleClass += "list-row-title" },
                        Label("${u.email} · ${t("colRole")}: ${u.role}").apply { styleClass += "list-row-meta" },
                    )
                    HBox.setHgrow(info, Priority.ALWAYS)
                    val approveBtn = Button(t("btnApprove")).apply {
                        styleClass.addAll("btn", "success", "tiny")
                        setOnAction {
                            AuthService.approve(u.email)
                            AppState.notifyChanged()
                        }
                    }
                    val rejectBtn = Button(t("btnReject")).apply {
                        styleClass.addAll("btn", "danger", "tiny")
                        setOnAction {
                            AuthService.reject(u.email)
                            AppState.notifyChanged()
                        }
                    }
                    children += HBox(10.0, info, approveBtn, rejectBtn).apply {
                        styleClass += "list-row"
                        alignment = Pos.CENTER_LEFT
                        padding = Insets(10.0, 14.0, 10.0, 14.0)
                    }
                }
            }
        }
        return VBox(8.0, heading, body)
    }
}
