package app.ui

import app.model.Task
import app.model.TaskStatus
import app.notify.Notifications
import app.state.AppState
import app.ui.Strings.t
import javafx.geometry.Pos
import javafx.scene.Node
import javafx.scene.control.Alert
import javafx.scene.control.Button
import javafx.scene.control.ButtonType
import javafx.scene.control.Label
import javafx.scene.layout.HBox
import javafx.scene.layout.Priority
import javafx.scene.layout.Region
import javafx.scene.layout.VBox

/** Context object for callbacks; tells handlers which list a task lives in. */
sealed class TaskCtx {
    data class CityCtx(val cityName: String) : TaskCtx()
    data class ProjectCtx(val projectName: String, val phaseIdx: Int) : TaskCtx()
    fun list(): MutableList<Task> = when (this) {
        is CityCtx -> AppState.cities[cityName]!!.tasks
        is ProjectCtx -> AppState.projects[projectName]!!.phases[phaseIdx].tasks
    }
    /** Locked: the phase (or city's Gemeenteontwikkeling) is submitted or approved. */
    fun isLocked(): Boolean = when (this) {
        is CityCtx -> AppState.cities[cityName]?.let { it.submitted || it.approved } ?: false
        is ProjectCtx -> {
            val ph = AppState.projects[projectName]!!.phases[phaseIdx]
            ph.approved || ph.submitted
        }
    }

    /** Human-readable context used in notification emails. */
    fun label(): String = when (this) {
        is CityCtx -> "$cityName — ${app.data.PhaseData.cityPhase.sheet}"
        is ProjectCtx -> {
            val proj = AppState.projects[projectName]
            val sheet = app.data.PhaseData.projectPhases[phaseIdx].sheet
            val city = proj?.parentCity?.let { " ($it)" } ?: ""
            "$projectName — ${t("fase")} ${phaseIdx + 1}: $sheet$city"
        }
    }
}

object TaskRow {
    fun build(task: Task, idx: Int, ctx: TaskCtx, totalCount: Int): Node {
        val locked = ctx.isLocked()

        // Tri-state cell: a checkbox-like button (open ↔ done) + N/A pill
        val triBtn = Button(if (task.status == TaskStatus.DONE) "✓" else if (task.status == TaskStatus.NA) "⊘" else "")
        triBtn.styleClass += "tri-btn"
        if (task.status == TaskStatus.DONE) triBtn.styleClass += "checked"
        if (task.status == TaskStatus.NA) triBtn.styleClass += "na"
        triBtn.isDisable = locked
        triBtn.setOnAction {
            // From done → open. From na → open (clear N/A). From open → done.
            val previous = task.status
            task.status = when (previous) {
                TaskStatus.DONE -> TaskStatus.OPEN
                TaskStatus.NA -> TaskStatus.OPEN
                TaskStatus.OPEN -> TaskStatus.DONE
            }
            if (previous != TaskStatus.DONE && task.status == TaskStatus.DONE) {
                Notifications.deliverablesSubmitted(ctx.label(), listOf(task))
            }
            AppState.notifyChanged()
        }

        val naBtn = Button(t("naLabel")).apply {
            styleClass += "na-toggle"
            if (task.status == TaskStatus.NA) styleClass += "on"
            isDisable = locked
            setOnAction {
                task.status = if (task.status == TaskStatus.NA) TaskStatus.OPEN else TaskStatus.NA
                AppState.notifyChanged()
            }
        }
        val triCell = VBox(4.0, triBtn, naBtn).apply { alignment = Pos.TOP_CENTER; minWidth = 44.0 }

        // Name + RASCI tags + custom badge
        val nameLbl = Label(task.deliverable).apply {
            styleClass += "task-name"
            isWrapText = true
            when (task.status) {
                TaskStatus.DONE -> styleClass += "done"
                TaskStatus.NA -> styleClass += "na"
                else -> {}
            }
        }
        val nameRow = HBox(6.0, nameLbl).apply { alignment = Pos.CENTER_LEFT }
        if (task.custom) {
            nameRow.children += Label(t("customTag")).apply { styleClass += "custom-tag" }
        }
        val rasciBox = HBox(4.0).apply { alignment = Pos.CENTER_LEFT }
        if (task.r.isNotBlank()) rasciBox.children += Label("R: ${task.r}").apply { styleClass.addAll("rasci-tag", "rasci-R") }
        if (task.a.isNotBlank()) rasciBox.children += Label("A: ${task.a}").apply { styleClass.addAll("rasci-tag", "rasci-A") }
        if (task.s.isNotBlank()) rasciBox.children += Label("S: ${task.s}").apply { styleClass.addAll("rasci-tag", "rasci-S") }
        if (task.c.isNotBlank()) rasciBox.children += Label("C: ${task.c}").apply { styleClass.addAll("rasci-tag", "rasci-C") }

        val nameCol = VBox(4.0, nameRow, rasciBox).apply { HBox.setHgrow(this, Priority.ALWAYS) }

        // Supporting documents (Google Drive links etc.). Chips stay clickable
        // when the phase is locked so reviewers keep one-click access.
        val attachCell = attachmentCell(task, locked)

        // Reorder + delete (admin)
        val asideChildren = mutableListOf<Node>()
        if (AppState.adminMode && !locked) {
            val up = Button("▲").apply {
                styleClass += "reorder-btn"
                isDisable = idx == 0 || ctx.list().getOrNull(idx - 1)?.blokKey != task.blokKey
                setOnAction { moveTask(ctx, idx, -1) }
            }
            val down = Button("▼").apply {
                styleClass += "reorder-btn"
                isDisable = idx >= totalCount - 1 || ctx.list().getOrNull(idx + 1)?.blokKey != task.blokKey
                setOnAction { moveTask(ctx, idx, 1) }
            }
            asideChildren += VBox(2.0, up, down)
        }
        if (AppState.adminMode && task.custom) {
            val del = Button("🗑").apply {
                styleClass += "delete-btn"
                setOnAction { deleteCustom(ctx, idx) }
            }
            asideChildren += del
        }
        val aside = HBox(4.0).apply {
            children.setAll(asideChildren)
            alignment = Pos.CENTER_RIGHT
            minWidth = 50.0
        }

        val row = HBox(12.0, triCell, nameCol, attachCell, aside).apply {
            alignment = Pos.TOP_LEFT
            styleClass += "task-row"
            if (task.custom) styleClass += "custom"
            when (task.status) {
                TaskStatus.DONE -> styleClass += "done"
                TaskStatus.NA -> styleClass += "na"
                else -> {}
            }
        }
        return row
    }

    private fun moveTask(ctx: TaskCtx, idx: Int, dir: Int) {
        val arr = ctx.list()
        val ni = idx + dir
        if (ni < 0 || ni >= arr.size) return
        if (arr[idx].blokKey != arr[ni].blokKey) return
        val tmp = arr[idx]; arr[idx] = arr[ni]; arr[ni] = tmp
        AppState.notifyChanged()
    }

    private fun deleteCustom(ctx: TaskCtx, idx: Int) {
        val arr = ctx.list()
        if (idx !in arr.indices || !arr[idx].custom) return
        val confirm = Alert(Alert.AlertType.CONFIRMATION, t("deleteRowConfirm"), ButtonType.OK, ButtonType.CANCEL)
        confirm.headerText = null
        val result = confirm.showAndWait()
        if (result.isPresent && result.get() == ButtonType.OK) {
            arr.removeAt(idx)
            AppState.notifyChanged()
        }
    }
}
