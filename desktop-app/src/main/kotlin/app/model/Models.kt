package app.model

import kotlinx.serialization.Serializable

/** Three-state task lifecycle: Open → Done → N/A. */
enum class TaskStatus { OPEN, DONE, NA }

/** Raw template task as loaded from phases.json (mirrors the prototype's PHASES_DATA). */
@Serializable
data class TaskTemplate(
    val row: Int = 0,
    val step: String = "",
    val blok: String = "",
    val deliverable: String = "",
    val existingLink: String = "",
    val r: String = "",
    val a: String = "",
    val s: String = "",
    val c: String = "",
    val i: String = "",
    val opm: String = "",
)

@Serializable
data class PhaseTemplate(
    val sheet: String,
    val tasks: List<TaskTemplate>,
)

/** A live, mutable task in the running app. */
class Task(
    val id: String,
    var step: String,
    var blok: String,
    var deliverable: String,
    var r: String,
    var a: String,
    var s: String,
    var c: String,
    var iCol: String,
    var opm: String,
    var status: TaskStatus = TaskStatus.OPEN,
    /** Supporting documents (Google Drive links etc.) attached to this deliverable. */
    val attachments: MutableList<Attachment> = mutableListOf(),
    /** True for rows added by an admin. Custom rows can be deleted; base rows cannot. */
    val custom: Boolean = false,
) {
    val blokKey: String get() = "$step||$blok"

    companion object {
        fun fromTemplate(tmpl: TaskTemplate, prefix: String, idx: Int): Task = Task(
            id = "${prefix}_b_$idx",
            step = tmpl.step,
            blok = tmpl.blok,
            deliverable = tmpl.deliverable,
            r = tmpl.r, a = tmpl.a, s = tmpl.s, c = tmpl.c,
            iCol = tmpl.i, opm = tmpl.opm,
            status = TaskStatus.OPEN,
            custom = false,
        ).apply {
            // Links that already exist in the phase document become attachments.
            if (tmpl.existingLink.isNotBlank()) {
                attachments += Attachment.from(tmpl.existingLink, null, "Fasedocument")
            }
        }

        private var counter = 0
        fun custom(blokKey: String, deliverable: String): Task {
            val (step, blok) = blokKey.split("||", limit = 2).let {
                if (it.size == 2) it[0] to it[1] else "" to (it.firstOrNull() ?: "")
            }
            counter += 1
            return Task(
                id = "c_${System.currentTimeMillis()}_$counter",
                step = step,
                blok = blok,
                deliverable = deliverable,
                r = "", a = "", s = "", c = "", iCol = "", opm = "",
                status = TaskStatus.OPEN,
                custom = true,
            )
        }
    }
}

/** A city tracks one Gemeenteontwikkeling task list (steps 1.1–1.3 of the phase
 *  document). It precedes the Acquisitiefase: projects in the city stay locked
 *  until it has been submitted and approved by the owner. */
class City(
    val name: String,
    val tasks: MutableList<Task>,
    var submitted: Boolean = false,
    var approved: Boolean = false,
)

/** A project phase: tasks plus formal approval flags. */
class Phase(
    val template: PhaseTemplate,
    val tasks: MutableList<Task>,
    var submitted: Boolean = false,
    var approved: Boolean = false,
)

class Project(
    val name: String,
    /** Parent city the project belongs to. Projects always live under a city in the Drive-style hierarchy. */
    var parentCity: String,
    val phases: MutableList<Phase>,
)
