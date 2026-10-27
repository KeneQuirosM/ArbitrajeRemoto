package app.arbitrajeremoto.reloj.api

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

/** One JSON configuration for the whole app: unknown fields are ignored (API.md: clients must ignore them). */
val ApiJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = false
}

/** `{ "error": { "code", "message", "details"? } }` — the only error format of the API. */
@Serializable
data class ApiErrorEnvelope(val error: ApiErrorBody)

@Serializable
data class ApiErrorBody(
    val code: String,
    val message: String = "",
    val details: JsonObject? = null,
)

@Serializable
data class HealthResponse(val ok: Boolean, val version: String = "", val serverTime: String)

@Serializable
data class SessionResponse(
    val authenticated: Boolean,
    val role: String? = null,
    val deviceId: String? = null,
    val keyId: String? = null,
)

@Serializable
data class PairingRequestBody(val deviceId: String, val deviceName: String? = null)

@Serializable
data class PairingRequestResponse(
    val code: String,
    val pollToken: String,
    val expiresAt: String,
    val pollIntervalSeconds: Int = 5,
) {
    override fun toString(): String = "PairingRequestResponse(code=$code, expiresAt=$expiresAt)"
}

@Serializable
data class PairingPollBody(val code: String, val pollToken: String) {
    override fun toString(): String = "PairingPollBody(code=$code)"
}

/** 202 `{status:"pending", expiresAt}` or 200 `{status:"approved", deviceKey, keyId, deviceId, deviceName}`. */
@Serializable
data class PairingPollResponse(
    val status: String,
    val expiresAt: String? = null,
    val deviceKey: String? = null,
    val keyId: String? = null,
    val deviceId: String? = null,
    val deviceName: String? = null,
) {
    override fun toString(): String = "PairingPollResponse(status=$status, keyId=$keyId, deviceId=$deviceId)"
}
