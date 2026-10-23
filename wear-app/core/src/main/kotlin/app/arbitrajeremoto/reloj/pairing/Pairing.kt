package app.arbitrajeremoto.reloj.pairing

import app.arbitrajeremoto.reloj.api.ApiResult
import app.arbitrajeremoto.reloj.api.PairingPollResponse
import app.arbitrajeremoto.reloj.api.PairingRequestResponse
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.time.Instant
import java.time.format.DateTimeParseException
import java.util.Locale

/** What the pairing screen shows. The pollToken and the deviceKey never appear here. */
sealed interface PairingState {
    /** Asking for a code; [networkProblem] after a failed attempt (retrying by itself). */
    data class Requesting(val networkProblem: Boolean = false) : PairingState

    /** Code on screen, waiting for the owner to type it in the web. */
    data class ShowingCode(val code: String, val expiresAtMs: Long, val networkProblem: Boolean = false) : PairingState

    /** Approved: the key is being stored (before saying "Paired"). */
    data object Saving : PairingState

    data class Paired(val deviceName: String?) : PairingState

    /** 410 CODE_EXPIRED, or the 10 minutes ran out. */
    data object Expired : PairingState

    /** 410 CODE_USED: the key was handed out but not received; a new code is needed. */
    data object CodeUsed : PairingState

    /** 404: the pollToken does not match; a new code is needed. */
    data object CodeUnknown : PairingState

    /** 429: too many codes; waiting for Retry-After, then asking again by itself. */
    data class RateLimited(val retryAtMs: Long) : PairingState

    /** Anything else (or the key could not be stored). [code] is the API error code, for support. */
    data class Failed(val code: String) : PairingState

    val isTerminal: Boolean
        get() = this is Paired || this is Expired || this is CodeUsed || this is CodeUnknown || this is Failed
}

/** The deviceKey received once from `/pairing/poll`. [toString] is redacted. */
class DeviceCredentials(val deviceKey: String, val keyId: String?, val deviceName: String?) {
    override fun toString(): String = "DeviceCredentials(keyId=$keyId, deviceName=$deviceName)"
}

interface PairingApi {
    suspend fun request(deviceId: String, deviceName: String?): ApiResult<PairingRequestResponse>
    suspend fun poll(code: String, pollToken: String): ApiResult<PairingPollResponse>
}

/**
 * Guide §4: ask for a code, show it, poll every `pollIntervalSeconds` until approved, store the key
 * **before** reporting [PairingState.Paired]. Network errors never leave the screen: it retries.
 */
class PairingController(
    private val api: PairingApi,
    private val deviceId: String,
    private val deviceName: String?,
    private val saveKey: suspend (DeviceCredentials) -> Unit,
    private val now: () -> Long,
    private val sleep: suspend (Long) -> Unit = { delay(it) },
) {
    private val _state = MutableStateFlow<PairingState>(PairingState.Requesting())
    val state: StateFlow<PairingState> = _state.asStateFlow()

    /** Runs until a terminal state. Call again (in a new coroutine) for "Ask for another code". */
    suspend fun run() {
        _state.value = PairingState.Requesting()
        while (true) {
            when (val result = api.request(deviceId, deviceName)) {
                is ApiResult.Ok -> {
                    val code = result.value
                    val expiresAt = parseInstant(code.expiresAt) ?: (now() + PAIRING_TTL_MS)
                    val interval = code.pollIntervalSeconds.coerceIn(1, 60) * 1000L
                    _state.value = PairingState.ShowingCode(code.code, expiresAt)
                    poll(code.code, code.pollToken, expiresAt, interval)
                    return
                }
                is ApiResult.HttpError -> {
                    if (result.status == 429 || result.status == 503 || result.status >= 500) {
                        val waitMs = retryAfterMs(result, if (result.status == 429) RATE_LIMIT_FALLBACK_MS else RETRY_MS)
                        _state.value = if (result.status == 429) PairingState.RateLimited(now() + waitMs) else PairingState.Requesting(true)
                        sleep(waitMs)
                    } else {
                        _state.value = PairingState.Failed(result.code)
                        return
                    }
                }
                is ApiResult.NetworkError -> {
                    _state.value = PairingState.Requesting(networkProblem = true)
                    sleep(RETRY_MS)
                }
            }
        }
    }

    private suspend fun poll(code: String, pollToken: String, expiresAt: Long, intervalMs: Long) {
        var wait = intervalMs
        while (true) {
            sleep(wait)
            wait = intervalMs
            if (now() >= expiresAt) {
                _state.value = PairingState.Expired
                return
            }
            when (val result = api.poll(code, pollToken)) {
                is ApiResult.Ok -> {
                    val body = result.value
                    val key = body.deviceKey
                    if (body.status == "approved" && key != null) {
                        _state.value = PairingState.Saving
                        try {
                            saveKey(DeviceCredentials(key, body.keyId, body.deviceName))
                        } catch (e: Exception) {
                            // The key is handed out only once: without storing it, a new code is needed.
                            _state.value = PairingState.Failed("KEY_NOT_SAVED")
                            return
                        }
                        _state.value = PairingState.Paired(body.deviceName)
                        return
                    }
                    _state.value = PairingState.ShowingCode(code, expiresAt)
                }
                is ApiResult.HttpError -> when {
                    result.status == 410 && result.code == "CODE_EXPIRED" -> {
                        _state.value = PairingState.Expired
                        return
                    }
                    result.status == 410 -> {
                        _state.value = PairingState.CodeUsed
                        return
                    }
                    result.status == 404 -> {
                        _state.value = PairingState.CodeUnknown
                        return
                    }
                    result.status == 429 || result.status >= 500 -> {
                        _state.value = PairingState.ShowingCode(code, expiresAt, networkProblem = true)
                        wait = retryAfterMs(result, intervalMs)
                    }
                    else -> {
                        _state.value = PairingState.Failed(result.code)
                        return
                    }
                }
                is ApiResult.NetworkError -> _state.value = PairingState.ShowingCode(code, expiresAt, networkProblem = true)
            }
        }
    }

    private fun retryAfterMs(error: ApiResult.HttpError, fallbackMs: Long): Long =
        error.retryAfterSeconds?.let { it * 1000 }?.coerceAtLeast(1000) ?: fallbackMs

    companion object {
        const val PAIRING_TTL_MS = 10 * 60_000L
        const val RETRY_MS = 5_000L
        const val RATE_LIMIT_FALLBACK_MS = 60_000L

        fun parseInstant(value: String?): Long? = try {
            value?.let { Instant.parse(it).toEpochMilli() }
        } catch (e: DateTimeParseException) {
            null
        }

        /** "K7M3QX" → "K7M 3QX" (two groups, easier to read and type). */
        fun formatCode(code: String): String =
            if (code.length == 6) code.substring(0, 3) + " " + code.substring(3) else code

        /** Remaining time as "m:ss", never negative. */
        fun formatRemaining(expiresAtMs: Long, nowMs: Long): String {
            val total = ((expiresAtMs - nowMs).coerceAtLeast(0) + 999) / 1000
            return String.format(Locale.ROOT, "%d:%02d", total / 60, total % 60)
        }
    }
}
