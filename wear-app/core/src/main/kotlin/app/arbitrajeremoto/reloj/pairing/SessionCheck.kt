package app.arbitrajeremoto.reloj.pairing

import app.arbitrajeremoto.reloj.api.ApiResult
import app.arbitrajeremoto.reloj.api.SessionResponse

/** Result of `GET /session` with the stored key, at start-up. */
enum class KeyStatus {
    /** The key works (role device). */
    VALID,

    /** 401: revoked in the web or replaced by a new pairing → back to pairing, keep everything else (guide §4.4). */
    REVOKED,

    /** No answer (offline, timeout, 5xx): keep working offline with the stored key. */
    UNKNOWN,
}

object SessionCheck {
    fun evaluate(result: ApiResult<SessionResponse>): KeyStatus = when (result) {
        is ApiResult.Ok -> if (result.value.authenticated && result.value.role == "device") KeyStatus.VALID else KeyStatus.REVOKED
        is ApiResult.HttpError -> if (result.status == 401) KeyStatus.REVOKED else KeyStatus.UNKNOWN
        is ApiResult.NetworkError -> KeyStatus.UNKNOWN
    }
}
