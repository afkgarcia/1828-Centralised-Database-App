package app.ui

import javafx.application.HostServices

/** Opens URLs in the system browser. HostServices is injected by Main at startup;
 *  the ProcessBuilder fallback covers headless/test contexts. */
object WebOpen {
    var host: HostServices? = null

    fun open(url: String) {
        val h = host
        if (h != null) {
            runCatching { h.showDocument(url) }
            return
        }
        runCatching {
            val os = System.getProperty("os.name").lowercase()
            when {
                "mac" in os -> ProcessBuilder("open", url).start()
                "win" in os -> ProcessBuilder("cmd", "/c", "start", url).start()
                else -> ProcessBuilder("xdg-open", url).start()
            }
        }
    }

    fun openFolder(dir: java.io.File) {
        runCatching {
            val os = System.getProperty("os.name").lowercase()
            when {
                "mac" in os -> ProcessBuilder("open", dir.absolutePath).start()
                "win" in os -> ProcessBuilder("explorer", dir.absolutePath).start()
                else -> ProcessBuilder("xdg-open", dir.absolutePath).start()
            }
        }
    }
}
