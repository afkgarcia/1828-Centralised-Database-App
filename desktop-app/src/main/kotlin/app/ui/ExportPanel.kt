package app.ui

import app.export.ExcelExport
import app.model.TaskStatus
import app.state.AppState
import app.ui.Strings.t
import javafx.geometry.Pos
import javafx.scene.Node
import javafx.scene.control.Alert
import javafx.scene.control.Button
import javafx.scene.control.Label
import javafx.scene.layout.HBox
import javafx.scene.layout.Priority
import javafx.scene.layout.Region
import javafx.scene.layout.VBox
import javafx.stage.FileChooser
import javafx.stage.Stage
import java.time.LocalDate

object ExportPanel {
    data class Counts(val done: Int, val na: Int, val open: Int, val link: Int)

    fun build(stage: Stage?): Node {
        val counts = aggregate()
        val title = Label(t("exportTitle")).apply { styleClass += "section-heading" }
        val desc = Label(t("exportDesc")).apply { styleClass += "phase-meta"; isWrapText = true }
        val left = VBox(4.0, title, desc).apply { HBox.setHgrow(this, Priority.ALWAYS) }

        val statsRow = HBox(16.0,
            stat(counts.done.toString(), t("statDone"), "green"),
            stat(counts.na.toString(), t("statNa"), "grey"),
            stat(counts.open.toString(), t("statOpen"), "red"),
            stat(counts.link.toString(), t("statLink"), null),
        ).apply { alignment = Pos.CENTER_RIGHT }

        val btn = Button(t("exportBtn")).apply {
            styleClass.addAll("btn", "success")
            setOnAction { runExport(stage) }
        }
        val right = VBox(8.0, statsRow, btn).apply { alignment = Pos.CENTER_RIGHT }

        val panel = HBox(20.0, left, right).apply {
            styleClass += "export-panel"
            alignment = Pos.CENTER_LEFT
        }
        return panel
    }

    private fun stat(value: String, label: String, color: String?): Node {
        val v = Label(value).apply { styleClass += "stat-val"; if (color != null) styleClass += color }
        val l = Label(label).apply { styleClass += "stat-lbl" }
        return VBox(0.0, v, l).apply { alignment = Pos.CENTER }
    }

    fun aggregate(): Counts {
        var done = 0; var na = 0; var open = 0; var link = 0
        val collect: (List<app.model.Task>) -> Unit = { tasks ->
            AppState.relevantTasks(tasks).forEach { x ->
                when (x.status) {
                    TaskStatus.DONE -> done++
                    TaskStatus.NA -> na++
                    TaskStatus.OPEN -> open++
                }
                if (x.attachments.isNotEmpty()) link++
            }
        }
        AppState.cityOrder.forEach { collect(AppState.cities[it]!!.tasks) }
        AppState.projectOrder.forEach { name ->
            AppState.projects[name]!!.phases.forEach { collect(it.tasks) }
        }
        return Counts(done, na, open, link)
    }

    private fun runExport(stage: Stage?) {
        val chooser = FileChooser().apply {
            title = t("exportTitle")
            extensionFilters += FileChooser.ExtensionFilter("Excel", "*.xlsx")
            initialFileName = "fasedocument_${LocalDate.now()}.xlsx"
        }
        val target = chooser.showSaveDialog(stage)
        if (target != null) {
            try {
                ExcelExport.write(target)
                Alert(Alert.AlertType.INFORMATION, "${t("exportSuccess")} ${target.absolutePath}").showAndWait()
            } catch (e: Exception) {
                Alert(Alert.AlertType.ERROR, "${t("exportFailed")} ${e.message}").showAndWait()
            }
        }
    }
}
