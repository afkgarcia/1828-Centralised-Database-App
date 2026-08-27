package app.ui

import app.state.AppState
import app.state.View
import javafx.geometry.Insets
import javafx.scene.Parent
import javafx.scene.control.ScrollPane
import javafx.scene.layout.Priority
import javafx.scene.layout.VBox

object MainView {
    fun build(): Parent {
        val header = headerBar(showBack = true, showAdminToggle = true, showAuthControls = true)

        val mainContent = when (val v = AppState.view) {
            is View.Dashboard -> DashboardView.build()
            is View.CityDetail -> CityDetailView.build(v.name)
            is View.ProjectView -> ProjectView.build(v.projectName, v.phaseIdx)
            is View.Approvals -> ApprovalsView.build()
            is View.UserAdmin -> UserAdminView.build()
            is View.Outbox -> OutboxView.build()
        }
        val mainCard = VBox(mainContent).apply { styleClass += "main" }

        val stage = (mainCard.scene?.window as? javafx.stage.Stage)
        val exportPanel = ExportPanel.build(stage)

        val rightCol = VBox(16.0, mainCard, exportPanel)
        val scroll = ScrollPane(rightCol).apply {
            isFitToWidth = true
            hbarPolicy = ScrollPane.ScrollBarPolicy.NEVER
            vbarPolicy = ScrollPane.ScrollBarPolicy.AS_NEEDED
            style = "-fx-background-color: transparent; -fx-background: transparent;"
        }
        VBox.setVgrow(scroll, Priority.ALWAYS)

        val outer = VBox(scroll).apply {
            padding = Insets(20.0)
        }
        VBox.setVgrow(outer, Priority.ALWAYS)

        return VBox(header, outer).apply { styleClass += "root" }
    }
}
