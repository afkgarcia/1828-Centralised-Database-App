package app.ui

import app.data.PhaseData
import app.model.Phase
import app.model.TaskStatus
import app.notify.Notifications
import app.state.AppState
import app.state.View
import app.ui.Strings.t
import javafx.geometry.Pos
import javafx.scene.Node
import javafx.scene.control.Alert
import javafx.scene.control.Button
import javafx.scene.control.Label
import javafx.scene.control.ScrollPane
import javafx.scene.layout.HBox
import javafx.scene.layout.Priority
import javafx.scene.layout.VBox

object ProjectView {
    fun build(name: String, phaseIdx: Int): Node {
        val proj = AppState.projects[name] ?: return Label(t("projectNotFound"))
        val safeIdx = phaseIdx.coerceIn(0, proj.phases.size - 1)
        if (safeIdx != phaseIdx) (AppState.view as? View.ProjectView)?.phaseIdx = safeIdx

        val phase = proj.phases[safeIdx]
        val unlocked = AppState.isPhaseUnlocked(name, safeIdx)
        val ctx = TaskCtx.ProjectCtx(name, safeIdx)
        val phaseLocked = ctx.isLocked()

        val crumbs = Label("${t("crumbProjects")} / $name").apply { styleClass += "crumbs" }

        val phaseSheet = PhaseData.projectPhases[safeIdx].sheet
        val title = Label("🏗️  $name — ${t("fase")} ${safeIdx + 1}: $phaseSheet").apply { styleClass += "phase-title" }

        val metaText = if (!unlocked) t("lockedTitle") else phaseMeta(phase)
        val meta = Label(metaText).apply { styleClass += "phase-meta" }
        val titleBox = VBox(2.0, title, meta).apply { HBox.setHgrow(this, Priority.ALWAYS) }
        val phaseHeader = HBox(14.0, titleBox)
        if (unlocked && !phase.approved && !phase.submitted) {
            phaseHeader.children += markAllControls(ctx, parentDisabled = phaseLocked)
        }
        phaseHeader.styleClass += "phase-header"
        phaseHeader.alignment = Pos.CENTER_LEFT

        val tabsBar = buildPhaseTabs(name, safeIdx, proj)

        val body: Node = if (!unlocked) {
            // Phase 1 is gated by the parent city's Gemeenteontwikkeling, later phases
            // by the previous phase's approval.
            val reason = if (safeIdx == 0) t("cityLockedMsg").replace("{city}", proj.parentCity)
                else t("lockedSub")
            VBox(8.0,
                Label("🔒").apply { styleClass += "empty-icon" },
                Label(t("lockedTitle")).apply { styleClass += "empty-title" },
                Label(reason).apply { styleClass += "empty-sub" },
            ).apply { styleClass += "empty-state"; alignment = Pos.CENTER }
        } else {
            val parts = mutableListOf<Node>()
            buildApprovalBanner(name, safeIdx, phase)?.let { parts += it }
            // One-stop document strip for the reviewer once the phase is in review.
            if (phase.submitted || phase.approved) {
                val docs = phase.tasks.flatMap { it.attachments }
                if (docs.isNotEmpty()) parts += reviewDocsStrip(docs)
            }
            parts += roleFilterBar()
            parts += TaskListView.build(phase.tasks, ctx)
            VBox().apply { children.setAll(parts) }
        }

        return VBox(crumbs, phaseHeader, tabsBar, body)
    }

    private fun phaseMeta(phase: Phase): String {
        val rel = AppState.relevantTasks(phase.tasks)
        val applicable = rel.filter { it.status != TaskStatus.NA }
        val done = applicable.count { it.status == TaskStatus.DONE }
        val naCount = rel.count { it.status == TaskStatus.NA }
        return "$done ${t("of")} ${applicable.size} ${t("applicable")} · $naCount ${t("statNa")}"
    }

    private fun buildPhaseTabs(projectName: String, currentIdx: Int, proj: app.model.Project): Node {
        val flow = HBox(6.0).apply { styleClass += "phase-tabs"; alignment = Pos.CENTER_LEFT }
        proj.phases.forEachIndexed { pi, ph ->
            val unlocked = AppState.isPhaseUnlocked(projectName, pi)
            val ready = AppState.isPhaseReady(ph)
            val dot = when {
                !unlocked -> "🔒"
                ph.approved -> "✅"
                ph.submitted -> "🟡"
                ready -> "🟢"
                AppState.relevantTasks(ph.tasks).any { it.status == TaskStatus.DONE } -> "🔵"
                else -> "⚪"
            }
            val btn = Button("$dot  ${pi + 1}. ${PhaseData.projectPhases[pi].sheet}")
            btn.styleClass += "ptab"
            if (pi == currentIdx) btn.styleClass += "active"
            if (!unlocked) btn.styleClass += "locked"
            if (ph.approved) btn.styleClass += "approved"
            btn.isDisable = !unlocked
            btn.setOnAction {
                (AppState.view as? View.ProjectView)?.let { v ->
                    AppState.view = View.ProjectView(v.projectName, pi)
                    AppState.notifyChanged()
                }
            }
            flow.children += btn
        }
        val scroll = ScrollPane(flow).apply {
            isFitToHeight = true
            hbarPolicy = ScrollPane.ScrollBarPolicy.AS_NEEDED
            vbarPolicy = ScrollPane.ScrollBarPolicy.NEVER
            isPannable = true
            style = "-fx-background-color: transparent; -fx-background: transparent;"
        }
        return scroll
    }

    private fun buildApprovalBanner(projectName: String, phaseIdx: Int, phase: Phase): Node? {
        return when {
            phase.approved -> {
                val text = Label("✅  ${t("approvedTitle")}. ${t("approvedDesc")}").apply { styleClass.addAll("label", "title") }
                val box = HBox(12.0, text)
                box.alignment = Pos.CENTER_LEFT
                HBox.setHgrow(text, Priority.ALWAYS)
                if (AppState.isApprover()) {
                    box.children += Button(t("reopenPhase")).apply {
                        styleClass.addAll("btn", "outline", "tiny")
                        setOnAction {
                            phase.approved = false; phase.submitted = false
                            AppState.notifyChanged()
                        }
                    }
                }
                box.styleClass.addAll("approval-banner", "approved")
                box
            }
            phase.submitted -> {
                val text = Label("🟡  ${t("submittedTitle")}. ${t("submittedDesc")}").apply { styleClass.addAll("label", "title") }
                val box = HBox(12.0, text)
                box.alignment = Pos.CENTER_LEFT
                HBox.setHgrow(text, Priority.ALWAYS)
                if (AppState.isApprover()) {
                    box.children += Button(t("approvePhase")).apply {
                        styleClass.addAll("btn", "success", "tiny")
                        setOnAction { approve(projectName, phaseIdx, phase) }
                    }
                    box.children += Button(t("rejectPhase")).apply {
                        styleClass.addAll("btn", "danger", "tiny")
                        setOnAction { reject(projectName, phaseIdx, phase) }
                    }
                } else {
                    box.children += Button(t("withdraw")).apply {
                        styleClass.addAll("btn", "outline", "tiny")
                        setOnAction { phase.submitted = false; AppState.notifyChanged() }
                    }
                    box.children += Label(t("needsApprover")).apply { styleClass += "muted" }
                }
                box.styleClass.addAll("approval-banner", "submitted")
                box
            }
            else -> {
                // Submit stays visible at all times; the banner just reports readiness.
                val openCount = phase.tasks.count { it.status == TaskStatus.OPEN }
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
                    setOnAction { trySubmit(projectName, phaseIdx, phase) }
                }
                box.styleClass.addAll("approval-banner", if (allDone) "ready" else "open")
                box
            }
        }
    }

    /** Submit with unfinished-task handling: proceed prompt, then N/A-or-move choice. */
    private fun trySubmit(projectName: String, phaseIdx: Int, phase: Phase) {
        val open = phase.tasks.filter { it.status == TaskStatus.OPEN }
        if (open.isEmpty()) { doSubmit(projectName, phaseIdx, phase); return }

        // Step 1: "There are unfinished tasks — do you want to proceed?"
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

        // Step 2: mark N/A or move to the next phase (no move option on the last phase).
        val naType = javafx.scene.control.ButtonType(
            t("optMarkNa"), javafx.scene.control.ButtonBar.ButtonData.LEFT,
        )
        val moveType = javafx.scene.control.ButtonType(
            t("optMoveNext"), javafx.scene.control.ButtonBar.ButtonData.OK_DONE,
        )
        val hasNext = phaseIdx + 1 < (AppState.projects[projectName]?.phases?.size ?: 0)
        val choice = Alert(Alert.AlertType.CONFIRMATION).apply {
            headerText = null
            contentText = t("unfinishedChoice").replace("{n}", open.size.toString())
            buttonTypes.setAll(
                if (hasNext) listOf(naType, moveType, javafx.scene.control.ButtonType.CANCEL)
                else listOf(naType, javafx.scene.control.ButtonType.CANCEL)
            )
        }
        val step2 = choice.showAndWait()
        if (!step2.isPresent) return
        when (step2.get()) {
            naType -> AppState.markOpenTasksNa(projectName, phaseIdx)
            moveType -> AppState.moveOpenTasksToNextPhase(projectName, phaseIdx)
            else -> return
        }
        doSubmit(projectName, phaseIdx, phase)
    }

    private fun doSubmit(projectName: String, phaseIdx: Int, phase: Phase) {
        phase.submitted = true
        Notifications.approvalRequested(projectName, phaseIdx)
        AppState.notifyChanged()
    }

    private fun approve(projectName: String, phaseIdx: Int, phase: Phase) {
        if (!AppState.isApprover()) {
            Alert(Alert.AlertType.WARNING, t("needsApprover")).showAndWait(); return
        }
        phase.submitted = false
        phase.approved = true
        Notifications.phaseApproved(projectName, phaseIdx)
        AppState.notifyChanged()
    }

    private fun reject(projectName: String, phaseIdx: Int, phase: Phase) {
        if (!AppState.isApprover()) {
            Alert(Alert.AlertType.WARNING, t("needsApprover")).showAndWait(); return
        }
        phase.submitted = false
        Notifications.phaseRejected(projectName, phaseIdx)
        AppState.notifyChanged()
    }
}
