package app.model

/** Account-level role used for sign-in / access. Distinct from the RASCI letters on tasks. */
enum class UserRole {
    OWNER,   // Ernest. Sees everything, only approver of phase submissions and new signups.
    PM,      // Project manager. Submits phases for approval.
    OM,      // Development manager.
    PO,      // Project developer.
    PPM,     // Property manager.
    MT,      // Management team member.
}

enum class UserStatus { PENDING, ACTIVE, REJECTED }

/** A registered account. Access grants are enforced everywhere outside owner views. */
class User(
    val email: String,
    var passwordHash: String,
    val displayName: String,
    var role: UserRole,
    var status: UserStatus = UserStatus.PENDING,
    /** Owners get blanket access regardless of the city/project sets. */
    var accessAllCities: Boolean = false,
    /** Cities the user may see. Implies access to every project under each. */
    val cityAccess: MutableSet<String> = mutableSetOf(),
    /** Additional fine-grained project grants outside cityAccess. */
    val projectAccess: MutableSet<String> = mutableSetOf(),
) {
    /** Maps the account UserRole to the RASCI letter used for the task-level filter. */
    fun rasciFilterKey(): String = when (role) {
        UserRole.OWNER -> "all"
        UserRole.OM -> "OM"
        UserRole.PO -> "PO"
        UserRole.PM -> "PM"
        UserRole.PPM -> "PPM"
        UserRole.MT -> "MT"
    }
}
