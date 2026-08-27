package app.data

import app.model.PhaseTemplate
import kotlinx.serialization.json.Json

object PhaseData {
    val all: List<PhaseTemplate> by lazy { load() }

    /** Phase 0 of the original document: Gemeenteontwikkeling. Used in the Cities section. */
    val cityPhase: PhaseTemplate get() = all[0]

    /** Phases 1..9: Acquisitiefase → Garantiefase. Used in the Projects section. */
    val projectPhases: List<PhaseTemplate> get() = all.drop(1)

    private fun load(): List<PhaseTemplate> {
        val stream = PhaseData::class.java.classLoader.getResourceAsStream("phases.json")
            ?: error("phases.json not found on classpath")
        val text = stream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        val json = Json { ignoreUnknownKeys = true }
        return json.decodeFromString<List<PhaseTemplate>>(text)
    }
}
