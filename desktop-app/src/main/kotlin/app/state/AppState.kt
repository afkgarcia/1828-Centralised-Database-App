package app.state

import app.data.PhaseData
import app.model.City
import app.model.Phase
import app.model.Project
import app.model.Task
import app.model.TaskStatus
import app.model.User
import app.model.UserRole

sealed class View {
    /** Drive-style root: grid of cities. */
    object Dashboard : View()
    /** A city detail page: its Gemeenteontwikkeling + projects grid. */
    data class CityDetail(val name: String) : View()
    /** A project's phase view. */
    data class ProjectView(val projectName: String, var phaseIdx: Int = 0) : View()
    /** Owner-only inbox: pending phase submissions + pending signups. */
    object Approvals : View()
    /** Owner-only user management. */
    object UserAdmin : View()
    /** Sent email notifications (owner sees all; colleagues see their own). */
    object Outbox : View()
}

object AppState {
    /** The signed-in user. Null = login screen. */
    var currentUser: User? = null

    /** RASCI-letter filter chip selection; defaults from the logged-in user's role. */
    var role: String = "all"

    /** Admin mode toggles row reorder + custom-row UI. Available to owners only. */
    var adminMode: Boolean = false

    // ── Text size (magnifier) ────────────────────────────────────────────────
    // Multiplies the root font size; every stylesheet size is em-based, so this
    // one value scales the entire UI.
    val ZOOM_LEVELS = listOf(0.9, 1.0, 1.15, 1.3, 1.5)
    var zoomFactor: Double = 1.0
    fun zoomIn() { zoomFactor = ZOOM_LEVELS.firstOrNull { it > zoomFactor + 0.001 } ?: zoomFactor }
    fun zoomOut() { zoomFactor = ZOOM_LEVELS.lastOrNull { it < zoomFactor - 0.001 } ?: zoomFactor }

    var view: View = View.Dashboard

    val cityOrder: MutableList<String> = mutableListOf()
    val cities: MutableMap<String, City> = mutableMapOf()

    val projectOrder: MutableList<String> = mutableListOf()
    val projects: MutableMap<String, Project> = mutableMapOf()

    private val listeners: MutableList<() -> Unit> = mutableListOf()
    fun onChange(block: () -> Unit) { listeners += block }
    fun notifyChanged() { listeners.forEach { it() } }

    fun login(user: User) {
        currentUser = user
        role = user.rasciFilterKey()
        // Owners default to admin mode off; they can flip it manually.
        adminMode = false
        view = View.Dashboard
    }

    fun logout() {
        currentUser = null
        role = "all"
        adminMode = false
        view = View.Dashboard
    }

    fun addCity(name: String): Boolean {
        if (cities.containsKey(name)) return false
        val tasks = PhaseData.cityPhase.tasks.mapIndexed { i, t ->
            Task.fromTemplate(t, "city_$name", i)
        }.toMutableList()
        cities[name] = City(name, tasks)
        cityOrder += name
        return true
    }

    fun addProject(name: String, parentCity: String): Boolean {
        if (projects.containsKey(name)) return false
        if (!cities.containsKey(parentCity)) return false
        val phases = PhaseData.projectPhases.mapIndexed { pi, ph ->
            val tasks = ph.tasks.mapIndexed { ti, t ->
                Task.fromTemplate(t, "proj_${name}_p$pi", ti)
            }.toMutableList()
            Phase(template = ph, tasks = tasks)
        }.toMutableList()
        projects[name] = Project(name, parentCity, phases)
        projectOrder += name
        return true
    }

    // ─── Access control ──────────────────────────────────────────────────────

    fun isOwner(): Boolean = currentUser?.role == UserRole.OWNER
    /** Only the owner can approve / reject phases or new signups. */
    fun isApprover(): Boolean = isOwner()

    fun canAccessCity(name: String): Boolean =
        currentUser?.let { userCanAccessCity(it, name) } ?: false

    /** City access check for an arbitrary user — also drives notification recipients. */
    fun userCanAccessCity(u: User, name: String): Boolean {
        if (u.accessAllCities || u.role == UserRole.OWNER) return true
        if (name in u.cityAccess) return true
        // City is visible if the user has access to any project living under it.
        return projects.values.any { it.parentCity == name && it.name in u.projectAccess }
    }

    fun canAccessProject(name: String): Boolean =
        currentUser?.let { userCanAccessProject(it, name) } ?: false

    /** Access check for an arbitrary user — used by notification recipient resolution. */
    fun userCanAccessProject(u: User, name: String): Boolean {
        val proj = projects[name] ?: return false
        if (u.accessAllCities || u.role == UserRole.OWNER) return true
        if (proj.parentCity in u.cityAccess) return true
        return proj.name in u.projectAccess
    }

    /** Open tasks across everything the current user can see (header badge + dashboard stat). */
    fun openTaskCount(): Int {
        if (currentUser == null) return 0
        var open = 0
        accessibleCities().forEach { name ->
            open += relevantTasks(cities[name]!!.tasks).count { it.status == TaskStatus.OPEN }
        }
        projectOrder.mapNotNull { projects[it] }
            .filter { canAccessProject(it.name) }
            .forEach { proj ->
                proj.phases.forEach { ph ->
                    open += relevantTasks(ph.tasks).count { it.status == TaskStatus.OPEN }
                }
            }
        return open
    }

    fun accessibleCities(): List<String> = cityOrder.filter { canAccessCity(it) }
    fun projectsForCity(cityName: String): List<Project> =
        projectOrder.mapNotNull { projects[it] }
            .filter { it.parentCity == cityName }
            .filter { canAccessProject(it.name) }

    // ─── Task math (unchanged from v0.2) ─────────────────────────────────────

    /** Filter helper: only tasks relevant for the active RASCI chip. role="all" returns everything. */
    fun relevantTasks(tasks: List<Task>): List<Task> {
        if (role == "all") return tasks
        return tasks.filter { listOf(it.r, it.a, it.s, it.c).any { v -> v.contains(role) } }
    }

    /** Progress = done / applicable; N/A drops out of the denominator. */
    fun progressOf(tasks: List<Task>): Double {
        val rel = relevantTasks(tasks)
        val applicable = rel.filter { it.status != TaskStatus.NA }
        if (applicable.isEmpty()) return 1.0
        val done = applicable.count { it.status == TaskStatus.DONE }
        return done.toDouble() / applicable.size
    }

    /** Phase i is unlocked iff the previous phase is approved. Phase 0 (Acquisitiefase)
     *  requires the parent city's Gemeenteontwikkeling to be approved first — municipality
     *  development precedes acquisition and happens once per city. */
    fun isPhaseUnlocked(projectName: String, phaseIdx: Int): Boolean {
        val proj = projects[projectName] ?: return false
        if (phaseIdx == 0) return cities[proj.parentCity]?.approved == true
        return proj.phases[phaseIdx - 1].approved
    }

    /** Cities submitted for approval and awaiting the owner. */
    fun pendingCitySubmissions(): List<City> =
        cityOrder.mapNotNull { cities[it] }.filter { it.submitted && !it.approved }

    fun isPhaseReady(phase: Phase): Boolean {
        val rel = relevantTasks(phase.tasks)
        if (rel.isEmpty()) return false
        return rel.none { it.status == TaskStatus.OPEN }
    }

    /** Placeholder headline for tasks carried into the next phase. Final title pending from Ernest. */
    const val WIP_STEP = "WIP"

    /** Marks every open task in the phase as not-applicable. Returns how many changed. */
    fun markOpenTasksNa(projectName: String, phaseIdx: Int): Int {
        val phase = projects[projectName]?.phases?.getOrNull(phaseIdx) ?: return 0
        val open = phase.tasks.filter { it.status == TaskStatus.OPEN }
        open.forEach { it.status = TaskStatus.NA }
        return open.size
    }

    /** Moves every open task in the phase to the top of the next phase, grouped under
     *  the WIP headline. Statuses, RASCI tags and attachments travel with the task.
     *  Returns how many moved; 0 on the last phase (there is no next). */
    fun moveOpenTasksToNextPhase(projectName: String, phaseIdx: Int): Int {
        val proj = projects[projectName] ?: return 0
        val phase = proj.phases.getOrNull(phaseIdx) ?: return 0
        val next = proj.phases.getOrNull(phaseIdx + 1) ?: return 0
        val open = phase.tasks.filter { it.status == TaskStatus.OPEN }
        if (open.isEmpty()) return 0
        phase.tasks.removeAll(open)
        open.forEach { it.step = WIP_STEP; it.blok = "" }
        next.tasks.addAll(0, open)
        return open.size
    }

    /** Hands every document linked by [fromDisplayName] over to [toDisplayName].
     *  Covers all city task lists and every project phase; returns how many moved. */
    fun reassignAttachments(fromDisplayName: String, toDisplayName: String): Int {
        var count = 0
        val allTaskLists = cities.values.map { it.tasks } +
            projects.values.flatMap { proj -> proj.phases.map { it.tasks } }
        allTaskLists.forEach { tasks ->
            tasks.forEach { task ->
                task.attachments.forEach { att ->
                    if (att.addedBy == fromDisplayName) {
                        att.addedBy = toDisplayName
                        count++
                    }
                }
            }
        }
        return count
    }

    /** Every phase currently submitted-and-awaiting-approval across all projects. */
    fun pendingPhaseSubmissions(): List<Triple<Project, Int, Phase>> {
        val out = mutableListOf<Triple<Project, Int, Phase>>()
        projectOrder.forEach { name ->
            val proj = projects[name] ?: return@forEach
            proj.phases.forEachIndexed { idx, ph ->
                if (ph.submitted && !ph.approved) out += Triple(proj, idx, ph)
            }
        }
        return out
    }
}
