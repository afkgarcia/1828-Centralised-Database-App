package app.ui

import app.data.PhaseData
import app.model.TaskStatus
import app.notify.EmailService
import app.state.AppState
import app.state.View
import app.ui.Strings.t
import javafx.geometry.Insets
import javafx.geometry.Pos
import javafx.scene.Node
import javafx.scene.control.Alert
import javafx.scene.control.Button
import javafx.scene.control.Hyperlink
import javafx.scene.control.Label
import javafx.scene.control.ProgressBar
import javafx.scene.control.TextInputDialog
import javafx.scene.layout.FlowPane
import javafx.scene.layout.HBox
import javafx.scene.layout.Priority
import javafx.scene.layout.VBox
import java.time.format.DateTimeFormatter

/** Drive-style landing page: stats strip, owner's approval queue, city grid, activity feed. */
object DashboardView {
    private val stamp = DateTimeFormatter.ofPattern("dd-MM HH:mm")

    fun build(): Node {
        val accessible = AppState.accessibleCities()
        val user = AppState.currentUser

        val title = Label(t("dashboardTitle")).apply { styleClass += "page-title" }
        val sub = Label(t("dashboardSub")).apply { styleClass += "page-sub"; isWrapText = true }
        val titleCol = VBox(2.0, title, sub).apply { HBox.setHgrow(this, Priority.ALWAYS) }
        val titleRow = HBox(12.0, titleCol).apply { alignment = Pos.CENTER_LEFT }
        if (AppState.isOwner()) {
            titleRow.children += Button(t("addCity")).apply {
                styleClass.addAll("btn", "tiny")
                setOnAction { promptAddCity() }
            }
        }

        val visibleProjects = AppState.projectOrder.count { AppState.canAccessProject(it) }
        val pending = AppState.pendingPhaseSubmissions()
        val pendingCities = AppState.pendingCitySubmissions()
        val pendingTotal = pending.size + pendingCities.size

        val stats = HBox(12.0).apply {
            children += statTile(accessible.size.toString(), t("cities"))
            children += statTile(visibleProjects.toString(), t("projects"))
            children += statTile(AppState.openTaskCount().toString(), t("statOpenTasks"))
            if (AppState.isOwner()) {
                children += statTile(pendingTotal.toString(), t("statPendingApprovals"), highlight = pendingTotal > 0)
            }
        }

        val sections = VBox(18.0, titleRow, stats)

        // Owner: quick queue of cities + phases waiting for approval.
        if (AppState.isOwner() && pendingTotal > 0) {
            val rows = VBox(8.0)
            pendingCities.take(4).forEach { city ->
                val info = Label("🏙️  ${city.name} · ${PhaseData.cityPhase.sheet}").apply {
                    styleClass += "list-row-title"
                    maxWidth = Double.MAX_VALUE
                    HBox.setHgrow(this, Priority.ALWAYS)
                }
                val open = Button(t("openProject")).apply {
                    styleClass.addAll("btn", "outline", "tiny")
                    setOnAction {
                        AppState.view = View.CityDetail(city.name)
                        AppState.notifyChanged()
                    }
                }
                rows.children += HBox(10.0, info, open).apply {
                    styleClass += "list-row"
                    alignment = Pos.CENTER_LEFT
                    padding = Insets(10.0, 14.0, 10.0, 14.0)
                }
            }
            pending.take(4).forEach { (proj, idx, _) ->
                val info = Label("🏗️  ${proj.name} · ${t("fase")} ${idx + 1}: ${PhaseData.projectPhases[idx].sheet}  (${proj.parentCity})").apply {
                    styleClass += "list-row-title"
                    maxWidth = Double.MAX_VALUE
                    HBox.setHgrow(this, Priority.ALWAYS)
                }
                val open = Button(t("openProject")).apply {
                    styleClass.addAll("btn", "outline", "tiny")
                    setOnAction {
                        AppState.view = View.ProjectView(proj.name, idx)
                        AppState.notifyChanged()
                    }
                }
                rows.children += HBox(10.0, info, open).apply {
                    styleClass += "list-row"
                    alignment = Pos.CENTER_LEFT
                    padding = Insets(10.0, 14.0, 10.0, 14.0)
                }
            }
            val goInbox = Hyperlink(t("viewAll")).apply {
                styleClass += "form-link"
                setOnAction { AppState.view = View.Approvals; AppState.notifyChanged() }
            }
            sections.children += VBox(8.0,
                Label(t("dashApprovalsHeading")).apply { styleClass += "section-heading" },
                rows, goInbox,
            )
        }

        // City grid
        val grid = FlowPane().apply { hgap = 14.0; vgap = 14.0; prefWrapLength = 980.0 }
        if (accessible.isEmpty()) {
            grid.children += Label(
                if (AppState.cityOrder.isEmpty() || AppState.isOwner()) t("noCities") else t("noAccessibleCities")
            ).apply { styleClass += "phase-meta"; isWrapText = true }
        } else {
            accessible.forEach { grid.children += cityCard(it) }
        }
        sections.children += VBox(8.0,
            Label(t("cities")).apply { styleClass += "section-heading" },
            grid,
        )

        // Recent notifications feed
        if (user != null) {
            val mails = EmailService.visibleTo(user.email, AppState.isOwner()).take(5)
            if (mails.isNotEmpty()) {
                val rows = VBox(6.0)
                mails.forEach { m ->
                    val chip = Label(eventLabel(m.event)).apply {
                        styleClass += "event-chip"; styleClass += eventCss(m.event)
                    }
                    val subjLbl = Label(m.subject).apply {
                        styleClass += "list-row-title"
                        maxWidth = Double.MAX_VALUE
                        HBox.setHgrow(this, Priority.ALWAYS)
                    }
                    val time = Label(m.timestamp.format(stamp)).apply { styleClass += "list-row-meta" }
                    rows.children += HBox(10.0, chip, subjLbl, time).apply {
                        styleClass += "list-row"
                        alignment = Pos.CENTER_LEFT
                        padding = Insets(8.0, 14.0, 8.0, 14.0)
                    }
                }
                val more = Hyperlink(t("viewAll")).apply {
                    styleClass += "form-link"
                    setOnAction { AppState.view = View.Outbox; AppState.notifyChanged() }
                }
                sections.children += VBox(8.0,
                    Label(t("dashActivityHeading")).apply { styleClass += "section-heading" },
                    rows, more,
                )
            }
        }

        return sections.apply { padding = Insets(28.0) }
    }

    private fun statTile(value: String, label: String, highlight: Boolean = false): Node =
        VBox(0.0,
            Label(value).apply { styleClass += "stat-val"; if (highlight) styleClass += "red" },
            Label(label).apply { styleClass += "stat-lbl" },
        ).apply {
            styleClass += "stat-tile"
            if (highlight) styleClass += "highlight"
            alignment = Pos.CENTER_LEFT
            minWidth = 110.0
        }

    private fun cityCard(name: String): Node {
        val city = AppState.cities[name]!!
        val tasks = city.tasks
        val rel = AppState.relevantTasks(tasks)
        val applicable = rel.filter { it.status != TaskStatus.NA }
        val done = applicable.count { it.status == TaskStatus.DONE }
        val prog = AppState.progressOf(tasks)

        val projects = AppState.projectsForCity(name)
        val projWord = if (projects.size == 1) t("projectCountOne") else t("projectCount")

        val icon = Label(when {
            city.approved -> "✅"
            city.submitted -> "🟡"
            else -> "🏙️"
        }).apply { style = "-fx-font-size: 2.3em;" }
        val title = Label(name).apply { styleClass += "card-title" }
        val countLbl = Label("${projects.size} $projWord").apply { styleClass += "card-meta" }
        val progLbl = Label("Gemeenteontwikkeling · $done/${applicable.size}").apply { styleClass += "card-meta-soft" }
        val pb = ProgressBar(prog).apply {
            styleClass.addAll("progress-bar-thin", "city")
            maxWidth = Double.MAX_VALUE
        }

        return VBox(6.0, icon, title, countLbl, progLbl, pb).apply {
            styleClass += "tile-card"
            prefWidth = 220.0
            padding = Insets(16.0)
            setOnMouseClicked {
                AppState.view = View.CityDetail(name)
                AppState.notifyChanged()
            }
        }
    }

    private fun promptAddCity() {
        val dialog = TextInputDialog().apply { title = "1828"; headerText = null; contentText = t("namePromptCity") }
        val name = dialog.showAndWait().orElse(null)?.trim()?.ifBlank { null } ?: return
        if (!AppState.addCity(name)) {
            Alert(Alert.AlertType.WARNING, t("duplicateName")).showAndWait()
            return
        }
        AppState.view = View.CityDetail(name)
        AppState.notifyChanged()
    }
}
