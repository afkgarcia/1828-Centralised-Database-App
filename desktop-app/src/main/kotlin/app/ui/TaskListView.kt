package app.ui

import app.model.Task
import app.state.AppState
import app.ui.Strings.t
import javafx.geometry.Pos
import javafx.scene.Node
import javafx.scene.control.Alert
import javafx.scene.control.Button
import javafx.scene.control.Label
import javafx.scene.control.TextInputDialog
import javafx.scene.layout.HBox
import javafx.scene.layout.Priority
import javafx.scene.layout.VBox

/** Renders a flat task list grouped by blok with the role-filter chip bar on top. */
object TaskListView {
    fun build(tasks: MutableList<Task>, ctx: TaskCtx): Node {
        val container = VBox()

        // Group by step||blok preserving insertion order
        val groups = LinkedHashMap<String, MutableList<Pair<Task, Int>>>()
        tasks.forEachIndexed { i, t ->
            groups.getOrPut(t.blokKey) { mutableListOf() } += t to i
        }
        val keys = groups.keys.toList()
        val locked = ctx.isLocked()

        keys.forEachIndexed { blokIdx, key ->
            val items = groups[key]!!
            val filtered = if (AppState.role == "all") items
            else items.filter { (task, _) -> listOf(task.r, task.a, task.s, task.c).any { it.contains(AppState.role) } }
            if (filtered.isEmpty() && AppState.role != "all") return@forEachIndexed

            val (step, blokName) = key.split("||", limit = 2).let {
                if (it.size == 2) it[0] to it[1] else "" to (it.firstOrNull() ?: "")
            }

            val stepLbl = Label(step).apply { styleClass += "blok-step" }
            val blokLbl = Label(blokName).apply { styleClass += "blok-name" }
            val spacer = Label().apply { HBox.setHgrow(this, Priority.ALWAYS) }
            val toolbar = HBox(8.0).apply {
                children.addAll(stepLbl, blokLbl, spacer)
                alignment = Pos.CENTER_LEFT
            }
            if (AppState.adminMode && !locked) {
                if (blokIdx > 0) toolbar.children += Button("▲").apply {
                    styleClass += "reorder-btn"
                    setOnAction { moveBlok(ctx, key, -1) }
                }
                if (blokIdx < keys.size - 1) toolbar.children += Button("▼").apply {
                    styleClass += "reorder-btn"
                    setOnAction { moveBlok(ctx, key, 1) }
                }
                toolbar.children += Button(t("addRow")).apply {
                    styleClass += "add-row-btn"
                    setOnAction { promptAddRow(ctx, key) }
                }
            }

            val header = HBox(toolbar).apply { styleClass += "blok-header" }
            val group = VBox(header).apply { styleClass += "blok-group" }
            filtered.forEach { (task, originalIdx) ->
                group.children += TaskRow.build(task, originalIdx, ctx, tasks.size)
            }
            container.children += group
        }
        return container
    }

    private fun promptAddRow(ctx: TaskCtx, blokKey: String) {
        val dialog = TextInputDialog().apply {
            title = "1828"; headerText = null; contentText = t("addRowPrompt")
        }
        val name = dialog.showAndWait().orElse(null)?.trim()?.ifBlank { null } ?: return
        val arr = ctx.list()
        var insertAt = arr.size
        for (i in arr.indices.reversed()) {
            if (arr[i].blokKey == blokKey) { insertAt = i + 1; break }
        }
        arr.add(insertAt, Task.custom(blokKey, name))
        AppState.notifyChanged()
    }

    private fun moveBlok(ctx: TaskCtx, key: String, dir: Int) {
        val arr = ctx.list()
        val order = arr.map { it.blokKey }.distinct().toMutableList()
        val idx = order.indexOf(key)
        val ni = idx + dir
        if (idx < 0 || ni < 0 || ni >= order.size) return
        val tmp = order[idx]; order[idx] = order[ni]; order[ni] = tmp
        val groups = LinkedHashMap<String, MutableList<Task>>()
        arr.forEach { groups.getOrPut(it.blokKey) { mutableListOf() } += it }
        val newArr = order.flatMap { groups[it].orEmpty() }
        arr.clear(); arr.addAll(newArr)
        AppState.notifyChanged()
    }
}

/** Role filter chip bar (used by both city and project views). */
fun roleFilterBar(): Node {
    val box = HBox(6.0).apply { styleClass += "role-bar"; alignment = Pos.CENTER_LEFT }
    box.children += Label(t("filterLabel")).apply { styleClass += "role-bar-label" }
    fun chip(value: String, label: String): Node = Button(label).apply {
        styleClass += "role-chip"
        if (AppState.role == value) styleClass += "active-chip"
        setOnAction { AppState.role = value; AppState.notifyChanged() }
    }
    box.children += chip("all", t("filterAll"))
    listOf("OM", "PO", "PM", "PPM", "MT").forEach { box.children += chip(it, it) }
    return box
}

/** "Mark all done" / "Mark all open" controls. Skips N/A rows. */
fun markAllControls(ctx: TaskCtx, parentDisabled: Boolean = false): Node {
    val markDone = Button(t("btnMarkAll")).apply {
        styleClass.addAll("btn", "outline", "tiny")
        isDisable = parentDisabled
        setOnAction { applyMarkAll(ctx, app.model.TaskStatus.DONE) }
    }
    val markOpen = Button(t("btnUnmarkAll")).apply {
        styleClass.addAll("btn", "outline", "tiny")
        isDisable = parentDisabled
        setOnAction { applyMarkAll(ctx, app.model.TaskStatus.OPEN) }
    }
    return HBox(8.0, markDone, markOpen).apply { alignment = Pos.CENTER_RIGHT }
}

private fun applyMarkAll(ctx: TaskCtx, target: app.model.TaskStatus) {
    val arr = ctx.list()
    val rel = AppState.relevantTasks(arr)
    val completed = mutableListOf<app.model.Task>()
    rel.forEach { rt ->
        val idx = arr.indexOfFirst { it.id == rt.id }
        if (idx >= 0 && arr[idx].status != app.model.TaskStatus.NA) {
            if (target == app.model.TaskStatus.DONE && arr[idx].status == app.model.TaskStatus.OPEN) {
                completed += arr[idx]
            }
            arr[idx].status = target
        }
    }
    // One digest email instead of one per row.
    if (completed.isNotEmpty()) app.notify.Notifications.deliverablesSubmitted(ctx.label(), completed)
    AppState.notifyChanged()
}
