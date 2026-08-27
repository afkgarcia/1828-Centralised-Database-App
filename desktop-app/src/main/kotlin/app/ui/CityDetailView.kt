package app.ui

import app.data.PhaseData
import app.model.City
import app.model.Project
import app.model.TaskStatus
import app.notify.Notifications
import app.state.AppState
import app.state.View
import app.ui.Strings.t
import javafx.geometry.Insets
import javafx.geometry.Pos
import javafx.scene.Node
import javafx.scene.control.Alert
import javafx.scene.control.Button
import javafx.scene.control.Label
import javafx.scene.control.ProgressBar
import javafx.scene.control.TextInputDialog
import javafx.scene.control.Tooltip
import javafx.scene.layout.FlowPane
import javafx.scene.layout.HBox
import javafx.scene.layout.Priority
import javafx.scene.layout.VBox

/** City page: Gemeenteontwikkeling (steps 1.1–1.3) with its own approval gate,
 *  then the projects grid. Projects stay locked until the city is approved. */
object CityDetailView {
    fun build(name: String): Node {
        val city = AppState.cities[name] ?: return Label(t("cityNotFound"))
        val locked = city.submitted || city.approved

        val crumbs = Label("${t("dashboardTitle")} / $name").apply { styleClass += "crumbs" }
        val title = Label("🏙️  $name").apply { styleClass += "phase-title" }
        val sub = Label(PhaseData.cityPhase.sheet).apply { styleClass += "phase-meta" }
        val titleBox = VBox(2.0, title, sub).apply { HBox.setHgrow(this, Priority.ALWAYS) }
        val ctx = TaskCtx.CityCtx(name)
        val phaseHeader = HBox(14.0, titleBox).apply {
            styleClass += "phase-header"
            alignment = Pos.CENTER_LEFT
        }
        if (!locked) phaseHeader.children += markAllControls(ctx)

        val banner = buildCityBanner(city)

        val parts = mutableListOf<Node>(crumbs, phaseHeader)
        banner?.let { parts += it }
        if (locked) {
            val docs = city.tasks.flatMap { it.attachments }
            if (docs.isNotEmpty()) parts += reviewDocsStrip(docs)
        }
        parts += roleFilterBar()
        parts += TaskListView.build(city.tasks, ctx)

        // Projects under this city
        val projHeading = Label("${t("projectsInCity")} $name").apply { styleClass += "section-heading" }
        val headBits = mutableListOf<Node>(projHeading)
        if (!city.approved) {
            headBits += Label("🔒 ${t("cityGateHint")}").apply { styleClass += "muted" }
        }
        val headCol = VBox(2.0).apply {
            children.setAll(headBits)
            HBox.setHgrow(this, Priority.ALWAYS)
        }
        val addProj = Button(t("addProject")).apply {
            styleClass.addAll("btn", "tiny")
            setOnAction { promptAddProject(name) }
        }
        val projHeader = HBox(10.0, headCol, addProj).apply {
            alignment = Pos.CENTER_LEFT
            padding = Insets(18.0, 22.0, 8.0, 22.0)
        }

        val projects = AppState.projectsForCity(name)
        val projGrid = FlowPane().apply {
            hgap = 14.0; vgap = 14.0
            padding = Insets(0.0, 22.0, 18.0, 22.0)
            prefWrapLength = 960.0
        }
        if (projects.isEmpty()) {
            projGrid.children += Label(t("noProjectsInCity")).apply { styleClass += "phase-meta"; isWrapText = true }
        } else {
            projects.forEach { p -> projGrid.children += projectCard(p, city.approved) }
        }

        parts += projHeader
        parts += projGrid
        return VBox().apply { children.setAll(parts) }
    }

    /** Same lifecycle as a project phase: submit → owner approves → projects unlock. */
    private fun buildCityBanner(city: City): Node? {
        return when {
            city.approved -> {
                val text = Label("✅  ${t("cityApprovedTitle")}. ${t("cityApprovedDesc")}").apply {
                    styleClass.addAll("label", "title")
                }
                val box = HBox(12.0, text)
                box.alignment = Pos.CENTER_LEFT
                HBox.setHgrow(text, Priority.ALWAYS)
                if (AppState.isApprover()) {
                    box.children += Button(t("reopenPhase")).apply {
                        styleClass.addAll("btn", "outline", "tiny")
                        setOnAction {
                            city.approved = false; city.submitted = false
                            AppState.notifyChanged()
                        }
                    }
                }
                box.styleClass.addAll("approval-banner", "approved")
                box
            }
            city.submitted -> {
                val text = Label("🟡  ${t("submittedTitle")}. ${t("submittedDesc")}").apply {
                    styleClass.addAll("label", "title")
                }
                val box = HBox(12.0, text)
                box.alignment = Pos.CENTER_LEFT
                HBox.setHgrow(text, Priority.ALWAYS)
                if (AppState.isApprover()) {
                    box.children += Button(t("approvePhase")).apply {
                        styleClass.addAll("btn", "success", "tiny")
                        setOnAction {
                            city.submitted = false; city.approved = true
                            Notifications.cityDecision(city.name, approved = true)
                            AppState.notifyChanged()
                        }
                    }
                    box.children += Button(t("rejectPhase")).apply {
                        styleClass.addAll("btn", "danger", "tiny")
                        setOnAction {
                            city.submitted = false
                            Notifications.cityDecision(city.name, approved = false)
                            AppState.notifyChanged()
                        }
                    }
                } else {
                    box.children += Button(t("withdraw")).apply {
                        styleClass.addAll("btn", "outline", "tiny")
                        setOnAction { city.submitted = false; AppState.notifyChanged() }
                    }
                    box.children += Label(t("needsApprover")).apply { styleClass += "muted" }
                }
                box.styleClass.addAll("approval-banner", "submitted")
                box
            }
            else -> {
                val openCount = city.tasks.count { it.status == TaskStatus.OPEN }
                val allDone = openCount == 0
                val textStr =
                    if (allDone) t("readyTitle") + "  " + t("readyDesc")
                    else t("notReadyBanner").replace("{n}", openCount.toString())
                val text = Label(textStr).apply { styleClass.addAll("label", "title") }
                val box = HBox(12.0, text)
                box.alignment = Pos.CENTER_LEFT
                HBox.setHgrow(text, Priority.ALWAYS)
                box.children += Button(t("submitForApproval")).apply {
                    styleClass.addAll("btn", "tiny")
                    setOnAction { trySubmitCity(city) }
                }
                box.styleClass.addAll("approval-banner", if (allDone) "ready" else "open")
                box
            }
        }
    }

    /** Unfinished-task handling for cities: proceed prompt, then N/A only (no next phase). */
    private fun trySubmitCity(city: City) {
        val open = city.tasks.filter { it.status == TaskStatus.OPEN }
        if (open.isEmpty()) { doSubmitCity(city); return }

        val proceedType = javafx.scene.control.ButtonType(
            t("btnProceed"), javafx.scene.control.ButtonBar.ButtonData.OK_DONE,
        )
        val confirm = Alert(Alert.AlertType.CONFIRMATION).apply {
            headerText = null
            contentText = t("unfinishedPrompt").replace("{n}", open.size.toString())
            buttonTypes.setAll(proceedType, javafx.scene.control.ButtonType.CANCEL)
        }
        val step1 = confirm.showAndWait()
        if (!step1.isPresent || step1.get() != proceedType) return

        val naType = javafx.scene.control.ButtonType(
            t("optMarkNa"), javafx.scene.control.ButtonBar.ButtonData.OK_DONE,
        )
        val choice = Alert(Alert.AlertType.CONFIRMATION).apply {
            headerText = null
            contentText = t("unfinishedChoice").replace("{n}", open.size.toString())
            buttonTypes.setAll(naType, javafx.scene.control.ButtonType.CANCEL)
        }
        val step2 = choice.showAndWait()
        if (!step2.isPresent || step2.get() != naType) return
        open.forEach { it.status = TaskStatus.NA }
        doSubmitCity(city)
    }

    private fun doSubmitCity(city: City) {
        city.submitted = true
        Notifications.cityApprovalRequested(city.name)
        AppState.notifyChanged()
    }

    private fun projectCard(proj: Project, cityApproved: Boolean): Node {
        var totalApplicable = 0; var totalDone = 0
        proj.phases.forEach { ph ->
            val rel = AppState.relevantTasks(ph.tasks)
            val applicable = rel.filter { it.status != TaskStatus.NA }
            totalApplicable += applicable.size
            totalDone += applicable.count { it.status == TaskStatus.DONE }
        }
        val approvedCount = proj.phases.count { it.approved }
        val prog = if (totalApplicable == 0) 0.0 else totalDone.toDouble() / totalApplicable
        val phaseLabel = if (proj.phases.size == 1) t("phaseLabel") else "${t("phaseLabel")}n"

        val icon = Label(when {
            !cityApproved -> "🔒"
            approvedCount == proj.phases.size -> "🏁"
            approvedCount > 0 -> "🔵"
            else -> "🏗️"
        }).apply { style = "-fx-font-size: 2.3em;" }

        val title = Label(proj.name).apply { styleClass += "card-title" }
        val meta = Label("$approvedCount/${proj.phases.size} $phaseLabel  ·  $totalDone/$totalApplicable ${t("tasks")}").apply { styleClass += "card-meta" }
        val pb = ProgressBar(prog).apply {
            styleClass += "progress-bar-thin"
            maxWidth = Double.MAX_VALUE
        }

        val card = VBox(6.0, icon, title, meta, pb).apply {
            styleClass += "tile-card"
            prefWidth = 240.0
            padding = Insets(16.0)
            setOnMouseClicked {
                AppState.view = View.ProjectView(proj.name, 0)
                AppState.notifyChanged()
            }
        }
        if (!cityApproved) {
            Tooltip.install(card, Tooltip(t("cityLockedMsg").replace("{city}", proj.parentCity)))
        }
        return card
    }

    private fun promptAddProject(parentCity: String) {
        val dialog = TextInputDialog().apply { title = "1828"; headerText = null; contentText = t("namePromptProject") }
        val name = dialog.showAndWait().orElse(null)?.trim()?.ifBlank { null } ?: return
        if (!AppState.addProject(name, parentCity)) {
            Alert(Alert.AlertType.WARNING, t("duplicateName")).showAndWait()
            return
        }
        AppState.view = View.ProjectView(name, 0)
        AppState.notifyChanged()
    }
}
