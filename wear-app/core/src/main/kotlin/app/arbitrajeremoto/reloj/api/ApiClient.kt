package app.arbitrajeremoto.reloj.api

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.serializer
import java.io.IOException

/** Outcome of one API call. Never contains the deviceKey in [toString]. */
sealed interface ApiResult<out T> {
    data class Ok<T>(val status: Int, val value: T) : ApiResult<T>

    /** The server answered with an error status (body `{error:{code,message,details}}` when present). */
    data class HttpError(
        val status: Int,
        val code: String,
        val message: String,
        val reason: String? = null,
        val retryAfterSeconds: Long? = null,
    ) : ApiResult<Nothing>

    /** No answer: no network, DNS, timeout, TLS, or a body that is not the expected JSON. */
    data class NetworkError(val message: String) : ApiResult<Nothing>
}

/**
 * API v1 client for the watch. Blocking: call it from a background dispatcher.
 * [deviceKey] is read on every call so a new pairing takes effect at once.
 */
class ApiClient(
    private val baseUrl: () -> String,
    private val transport: HttpTransport,
    private val deviceKey: () -> String? = { null },
) {

    fun health(): ApiResult<HealthResponse> = call("GET", "/health", auth = false)

    fun requestPairing(deviceId: String, deviceName: String?): ApiResult<PairingRequestResponse> =
        call("POST", "/pairing/request", ApiJson.encodeToString(PairingRequestBody.serializer(), PairingRequestBody(deviceId, deviceName)), auth = false)

    fun pollPairing(code: String, pollToken: String): ApiResult<PairingPollResponse> =
        call("POST", "/pairing/poll", ApiJson.encodeToString(PairingPollBody.serializer(), PairingPollBody(code, pollToken)), auth = false)

    fun session(): ApiResult<SessionResponse> = call("GET", "/session")

    /** Sends [rawBody] byte for byte: the creation body is stored once and always resent the same. */
    fun createMatch(rawBody: String): ApiResult<CreateMatchResponse> = call("POST", "/matches", rawBody)

    fun postEvents(matchId: String, body: EventBatchBody): ApiResult<EventBatchResponse> =
        call("POST", "/matches/${matchId}/events", ApiJson.encodeToString(EventBatchBody.serializer(), body))

    /** Guide §9: the day's matches with a small set of fields. */
    fun listMatches(
        statuses: String = "scheduled,live",
        fields: String = "homeTeamName,awayTeamName,scheduledAt,status,score,periods,periodMinutes",
    ): ApiResult<MatchListResponse> = call("GET", "/matches?status=$statuses&fields=$fields")

    fun getMatchWithEvents(matchId: String): ApiResult<MatchDetailResponse> =
        call("GET", "/matches/${matchId}?include=events")

    fun eventsSince(matchId: String, since: Long): ApiResult<EventsSinceResponse> =
        call("GET", "/matches/${matchId}/events?since=$since")

    fun teams(): ApiResult<TeamsResponse> = call("GET", "/teams")

    private inline fun <reified T> call(method: String, path: String, body: String? = null, auth: Boolean = true): ApiResult<T> =
        call(serializer<T>(), method, path, body, auth)

    private fun <T> call(serializer: KSerializer<T>, method: String, path: String, body: String?, auth: Boolean): ApiResult<T> {
        val headers = buildMap {
            if (body != null) put("Content-Type", "application/json")
            if (auth) deviceKey()?.let { put("Authorization", "Bearer $it") }
        }
        val response = try {
            transport.execute(HttpRequest(method, baseUrl().trimEnd('/') + path, headers, body))
        } catch (e: IOException) {
            return ApiResult.NetworkError(e.javaClass.simpleName)
        } catch (e: IllegalArgumentException) {
            // Malformed base URL: nothing to send.
            return ApiResult.NetworkError("invalid_url")
        }
        return parse(serializer, response)
    }

    companion object {
        fun <T> parse(serializer: KSerializer<T>, response: HttpResponse): ApiResult<T> {
            if (response.status in 200..299) {
                return try {
                    ApiResult.Ok(response.status, ApiJson.decodeFromString(serializer, response.body))
                } catch (e: SerializationException) {
                    ApiResult.NetworkError("bad_response")
                } catch (e: IllegalArgumentException) {
                    ApiResult.NetworkError("bad_response")
                }
            }
            val error = try {
                ApiJson.decodeFromString(ApiErrorEnvelope.serializer(), response.body).error
            } catch (e: SerializationException) {
                null
            } catch (e: IllegalArgumentException) {
                null
            }
            val reason = (error?.details?.get("reason") as? kotlinx.serialization.json.JsonPrimitive)
                ?.takeIf { it.isString }?.content
            return ApiResult.HttpError(
                status = response.status,
                code = error?.code ?: "HTTP_${response.status}",
                message = error?.message ?: "",
                reason = reason,
                retryAfterSeconds = parseRetryAfter(response.header("retry-after")),
            )
        }

        /** `Retry-After` in seconds (the API only sends seconds). */
        fun parseRetryAfter(value: String?): Long? = value?.trim()?.toLongOrNull()?.takeIf { it >= 0 }
    }
}
