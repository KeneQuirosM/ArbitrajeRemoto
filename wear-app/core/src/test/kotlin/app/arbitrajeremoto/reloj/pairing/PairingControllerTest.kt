package app.arbitrajeremoto.reloj.pairing

import app.arbitrajeremoto.reloj.api.ApiResult
import app.arbitrajeremoto.reloj.api.PairingPollResponse
import app.arbitrajeremoto.reloj.api.PairingRequestResponse
import app.arbitrajeremoto.reloj.api.SessionResponse
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PairingControllerTest {
    private val t0 = 1_792_944_000_000L // 2026-10-25T16:00:00Z
    private val expires = "2026-10-25T16:10:00.000Z"

    private class ScriptedApi(
        val requests: MutableList<ApiResult<PairingRequestResponse>>,
        val polls: MutableList<ApiResult<PairingPollResponse>>,
    ) : PairingApi {
        var requestCount = 0
        var pollCount = 0
        override suspend fun request(deviceId: String, deviceName: String?): ApiResult<PairingRequestResponse> {
            requestCount++
            return requests.removeAt(0)
        }
        override suspend fun poll(code: String, pollToken: String): ApiResult<PairingPollResponse> {
            pollCount++
            assertEquals("tok", pollToken)
            return polls.removeAt(0)
        }
    }

    private val code = ApiResult.Ok(201, PairingRequestResponse("K7M3QX", "tok", expires, 5))
    private val pending = ApiResult.Ok(202, PairingPollResponse("pending", expiresAt = expires))
    private val approved = ApiResult.Ok(200, PairingPollResponse("approved", deviceKey = "ark1_k_s", keyId = "k", deviceId = "watch-1", deviceName = "Galaxy Watch 4"))

    private fun TestScope.controller(api: PairingApi, saved: MutableList<DeviceCredentials>, failSave: Boolean = false, seen: MutableList<PairingState>? = null) =
        PairingController(
            api, "watch-1", "Galaxy Watch 4",
            saveKey = {
                seen?.add(PairingState.Saving)
                if (failSave) error("disk full")
                saved += it
            },
            now = { t0 + testScheduler.currentTime },
            sleep = { delay(it) },
        )

    @Test
    fun `shows the code, polls every 5 s and stores the key before Paired`() = runTest {
        val api = ScriptedApi(mutableListOf(code), mutableListOf(pending, pending, approved))
        val saved = mutableListOf<DeviceCredentials>()
        val c = controller(api, saved)
        c.run()
        assertEquals(PairingState.Paired("Galaxy Watch 4"), c.state.value)
        assertEquals("ark1_k_s", saved.single().deviceKey)
        assertEquals(3, api.pollCount)
        assertEquals(15_000L, testScheduler.currentTime)
        assertFalse(saved.single().toString().contains("ark1"))
    }

    @Test
    fun `network errors keep the code on screen and retry`() = runTest {
        val api = ScriptedApi(
            mutableListOf(ApiResult.NetworkError("UnknownHostException"), code),
            mutableListOf(ApiResult.NetworkError("SocketTimeoutException"), ApiResult.HttpError(503, "BUSY", "", retryAfterSeconds = 1), approved),
        )
        val c = controller(api, mutableListOf())
        c.run()
        assertTrue(c.state.value is PairingState.Paired)
        assertEquals(2, api.requestCount)
        // 5 s retry of the request + 5 s + 5 s + Retry-After 1 s
        assertEquals(16_000L, testScheduler.currentTime)
    }

    @Test
    fun `410 and 404 end with the right state`() = runTest {
        for ((error, expected) in listOf(
            ApiResult.HttpError(410, "CODE_EXPIRED", "") to PairingState.Expired,
            ApiResult.HttpError(410, "CODE_USED", "") to PairingState.CodeUsed,
            ApiResult.HttpError(404, "NOT_FOUND", "") to PairingState.CodeUnknown,
        )) {
            val c = controller(ScriptedApi(mutableListOf(code), mutableListOf(pending, error)), mutableListOf())
            c.run()
            assertEquals(expected, c.state.value)
            assertTrue(c.state.value.isTerminal)
        }
    }

    @Test
    fun `expires locally after 10 minutes without polling again`() = runTest {
        val polls = MutableList<ApiResult<PairingPollResponse>>(119) { pending }
        val api = ScriptedApi(mutableListOf(code), polls)
        val c = controller(api, mutableListOf())
        c.run()
        assertEquals(PairingState.Expired, c.state.value)
        assertEquals(119, api.pollCount)
    }

    @Test
    fun `429 on request waits Retry-After and asks again`() = runTest {
        val api = ScriptedApi(mutableListOf(ApiResult.HttpError(429, "RATE_LIMITED", "", retryAfterSeconds = 30), code), mutableListOf(approved))
        val c = controller(api, mutableListOf())
        c.run()
        assertTrue(c.state.value is PairingState.Paired)
        assertEquals(35_000L, testScheduler.currentTime)
    }

    @Test
    fun `a key that cannot be stored is never reported as paired`() = runTest {
        val c = controller(ScriptedApi(mutableListOf(code), mutableListOf(approved)), mutableListOf(), failSave = true)
        c.run()
        assertEquals(PairingState.Failed("KEY_NOT_SAVED"), c.state.value)
    }

    @Test
    fun `formats the code in two groups and the countdown`() {
        assertEquals("K7M 3QX", PairingController.formatCode("K7M3QX"))
        assertEquals("10:00", PairingController.formatRemaining(t0 + 600_000, t0))
        assertEquals("0:01", PairingController.formatRemaining(t0 + 1, t0))
        assertEquals("0:00", PairingController.formatRemaining(t0, t0 + 5))
    }

    @Test
    fun `session check - 401 means re-pair, offline keeps the key`() {
        assertEquals(KeyStatus.VALID, SessionCheck.evaluate(ApiResult.Ok(200, SessionResponse(true, "device", "watch-1", "k"))))
        assertEquals(KeyStatus.REVOKED, SessionCheck.evaluate(ApiResult.HttpError(401, "UNAUTHORIZED", "")))
        assertEquals(KeyStatus.UNKNOWN, SessionCheck.evaluate(ApiResult.NetworkError("x")))
        assertEquals(KeyStatus.UNKNOWN, SessionCheck.evaluate(ApiResult.HttpError(500, "INTERNAL", "")))
    }
}
