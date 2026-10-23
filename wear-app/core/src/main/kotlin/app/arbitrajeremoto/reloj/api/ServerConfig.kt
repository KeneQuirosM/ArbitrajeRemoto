package app.arbitrajeremoto.reloj.api

import java.net.URI
import java.net.URISyntaxException
import java.util.UUID

object ServerConfig {
    const val DEFAULT_BASE_URL = "https://arbitraje-remoto.vercel.app/api/v1"

    /** Same rule as the server (core/validate.ts): 1–64 chars of `A–Z a–z 0–9 . _ -`. */
    private val DEVICE_ID_RE = Regex("^[A-Za-z0-9._-]{1,64}$")

    fun newDeviceId(): String = "watch-" + UUID.randomUUID().toString()

    fun isValidDeviceId(value: String): Boolean = DEVICE_ID_RE.matches(value)

    /**
     * Normalized base URL (no trailing slash), or null when it is not acceptable.
     * Only HTTPS, except when [allowHttp] (debug builds, for a local API).
     */
    fun normalizeBaseUrl(raw: String, allowHttp: Boolean): String? {
        val trimmed = raw.trim().trimEnd('/')
        val uri = try {
            URI(trimmed)
        } catch (e: URISyntaxException) {
            return null
        }
        val scheme = uri.scheme?.lowercase() ?: return null
        if (scheme != "https" && !(allowHttp && scheme == "http")) return null
        if (uri.host.isNullOrEmpty() || uri.userInfo != null || uri.query != null || uri.fragment != null) return null
        return trimmed
    }
}
