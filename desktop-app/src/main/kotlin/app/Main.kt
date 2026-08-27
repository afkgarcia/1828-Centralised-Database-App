package app

import app.model.Attachment
import app.state.AppState
import app.ui.LoginView
import app.ui.MainView
import app.ui.Strings
import app.ui.WebOpen
import javafx.application.Application
import javafx.scene.Scene
import javafx.scene.layout.StackPane
import javafx.stage.Stage

class FasedocumentTrackerApp : Application() {
    override fun start(stage: Stage) {
        val root = StackPane()
        root.styleClass += "root"
        val scene = Scene(root, 1280.0, 840.0)
        scene.stylesheets.add(javaClass.classLoader.getResource("app.css")!!.toExternalForm())

        WebOpen.host = hostServices

        // Seed cities + a couple of nested demo projects so the Drive-style hierarchy is visible.
        AppState.addCity("Leiden")
        AppState.addCity("Amsterdam")
        AppState.addCity("Utrecht")
        AppState.addProject("Pieterskwartier", parentCity = "Leiden")
        AppState.addProject("Sloterdijk Noord", parentCity = "Amsterdam")
        AppState.addProject("Utrecht Oost", parentCity = "Utrecht")

        // Demo Drive documents so the attachment chips are visible from first launch.
        AppState.cities["Leiden"]!!.tasks[0].attachments +=
            Attachment.from("https://docs.google.com/spreadsheets/d/1G40LijstVerrijkt2026/edit", "G40 lijst verrijkt", "Ernest")
        AppState.cities["Leiden"]!!.tasks[1].attachments +=
            Attachment.from("https://docs.google.com/document/d/1AnalyseWoonvisieLeiden/edit", "Analyse woonvisie Leiden", "Pia (PM)")
        val pieterskwartier = AppState.projects["Pieterskwartier"]!!
        pieterskwartier.phases[0].tasks[0].attachments +=
            Attachment.from("https://drive.google.com/drive/folders/1PieterskwartierAcquisitie", "Acquisitie-map", "Pia (PM)")
        pieterskwartier.phases[0].tasks[1].attachments +=
            Attachment.from("https://docs.google.com/presentation/d/1PitchGemeenteLeiden/edit", "Pitch gemeente Leiden", "Pia (PM)")

        // Leiden's Gemeenteontwikkeling is finished and approved so Pieterskwartier is
        // immediately workable; Amsterdam and Utrecht still have theirs open, so their
        // projects demonstrate the city gate (locked until the city is approved).
        AppState.cities["Leiden"]!!.let { leiden ->
            leiden.tasks.forEach { it.status = app.model.TaskStatus.DONE }
            leiden.approved = true
        }

        val mount: () -> Unit = {
            root.children.clear()
            // The magnifier control rescales the whole UI: all stylesheet font
            // sizes are em, so the root font size is the single scaling knob.
            root.style = String.format(
                java.util.Locale.ROOT, "-fx-font-size: %.2fpx;", 13.0 * AppState.zoomFactor,
            )
            stage.title = Strings.t("appTitle")
            if (AppState.currentUser == null) {
                root.children += LoginView.build()
            } else {
                root.children += MainView.build()
            }
        }
        AppState.onChange(mount)
        mount()

        stage.scene = scene
        stage.show()
    }
}

fun main() {
    Application.launch(FasedocumentTrackerApp::class.java)
}
