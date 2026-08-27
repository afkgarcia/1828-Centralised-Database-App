package app.auth

import app.model.User
import app.model.UserRole
import app.model.UserStatus
import java.security.MessageDigest

/** In-memory auth + signup pipeline. Suitable for the prototype only — no persistence,
 *  passwords stored as SHA-256 (not salted). Wire to a real backend before deploying. */
object AuthService {
    private val users: LinkedHashMap<String, User> = linkedMapOf()

    init { seed() }

    private fun seed() {
        // Ernest is the only owner. He approves new accounts and unlocks phases.
        register(User(
            email = "ernest@1828.nl",
            passwordHash = hash("ernest"),
            displayName = "Ernest",
            role = UserRole.OWNER,
            status = UserStatus.ACTIVE,
            accessAllCities = true,
        ))
        // An approved PM with access to Leiden.
        register(User(
            email = "pia@1828.nl",
            passwordHash = hash("test"),
            displayName = "Pia (PM)",
            role = UserRole.PM,
            status = UserStatus.ACTIVE,
            cityAccess = mutableSetOf("Leiden"),
        ))
        // A pending signup waiting for owner approval, so the inbox isn't empty on demo.
        register(User(
            email = "niels@1828.nl",
            passwordHash = hash("test"),
            displayName = "Niels (OM)",
            role = UserRole.OM,
            status = UserStatus.PENDING,
        ))
    }

    private fun register(u: User) { users[u.email] = u }

    fun login(email: String, password: String): LoginResult {
        val key = email.lowercase().trim()
        val u = users[key] ?: return LoginResult.UnknownEmail
        if (u.passwordHash != hash(password)) return LoginResult.BadPassword
        return when (u.status) {
            UserStatus.PENDING -> LoginResult.Pending
            UserStatus.REJECTED -> LoginResult.Rejected
            UserStatus.ACTIVE -> LoginResult.Ok(u)
        }
    }

    fun signup(email: String, password: String, displayName: String, requestedRole: UserRole): SignupResult {
        val key = email.lowercase().trim()
        if (key.isBlank() || !key.contains("@")) return SignupResult.InvalidEmail
        if (password.length < 4) return SignupResult.WeakPassword
        if (users.containsKey(key)) return SignupResult.AlreadyExists
        val u = User(
            email = key,
            passwordHash = hash(password),
            displayName = displayName.trim().ifBlank { key.substringBefore("@") },
            role = requestedRole,
            status = UserStatus.PENDING,
        )
        register(u)
        return SignupResult.Ok(u)
    }

    fun all(): List<User> = users.values.toList()
    fun pending(): List<User> = users.values.filter { it.status == UserStatus.PENDING }

    fun approve(email: String) { users[email]?.let { it.status = UserStatus.ACTIVE } }
    fun reject(email: String) { users[email]?.let { it.status = UserStatus.REJECTED } }
    fun setRole(email: String, role: UserRole) { users[email]?.role = role }

    // ── Password reset (self-service) ────────────────────────────────────────

    private val resetCodes = mutableMapOf<String, String>()

    /** Generates and emails a reset code. Returns the code (for tests) or null if the email is unknown. */
    fun requestPasswordReset(email: String): String? {
        val u = users[email.lowercase().trim()] ?: return null
        val code = (100000..999999).random().toString()
        resetCodes[u.email] = code
        app.notify.Notifications.passwordReset(u, code)
        return code
    }

    fun completePasswordReset(email: String, code: String, newPassword: String): ResetResult {
        val u = users[email.lowercase().trim()] ?: return ResetResult.UnknownEmail
        if (resetCodes[u.email] == null || resetCodes[u.email] != code.trim()) return ResetResult.BadCode
        if (newPassword.length < 4) return ResetResult.WeakPassword
        u.passwordHash = hash(newPassword)
        resetCodes.remove(u.email)
        return ResetResult.Ok
    }

    /** Password change for a signed-in user; verifies the current password first. */
    fun changePassword(email: String, current: String, newPassword: String): ChangeResult {
        val u = users[email.lowercase().trim()] ?: return ChangeResult.BadCurrent
        if (u.passwordHash != hash(current)) return ChangeResult.BadCurrent
        if (newPassword.length < 4) return ChangeResult.WeakPassword
        u.passwordHash = hash(newPassword)
        return ChangeResult.Ok
    }

    // ── Removal ──────────────────────────────────────────────────────────────

    /** Deletes an account. Owners can never be removed (Ernest is the safety anchor). */
    fun remove(email: String): Boolean {
        val key = email.lowercase().trim()
        val u = users[key] ?: return false
        if (u.role == UserRole.OWNER) return false
        users.remove(key)
        resetCodes.remove(key)
        return true
    }

    sealed class ResetResult {
        object Ok : ResetResult()
        object UnknownEmail : ResetResult()
        object BadCode : ResetResult()
        object WeakPassword : ResetResult()
    }

    sealed class ChangeResult {
        object Ok : ChangeResult()
        object BadCurrent : ChangeResult()
        object WeakPassword : ChangeResult()
    }

    sealed class LoginResult {
        data class Ok(val user: User) : LoginResult()
        object UnknownEmail : LoginResult()
        object BadPassword : LoginResult()
        object Pending : LoginResult()
        object Rejected : LoginResult()
    }
    sealed class SignupResult {
        data class Ok(val user: User) : SignupResult()
        object InvalidEmail : SignupResult()
        object WeakPassword : SignupResult()
        object AlreadyExists : SignupResult()
    }

    private fun hash(s: String): String {
        val md = MessageDigest.getInstance("SHA-256")
        return md.digest(s.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    }
}
