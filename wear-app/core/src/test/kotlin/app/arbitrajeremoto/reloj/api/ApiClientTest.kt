package app.arbitrajeremoto.reloj.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.SocketTimeoutException

class ApiClientTest {
    private val key = "ark1_0123456789abcdef_secretsecretsecret"

    private fun client(transport: HttpTransport, deviceKey: String? = key) =
        ApiClient({ "https://example.test/api/v1/" }, transport, { deviceKey })

    @Test
    fun `parses a pairing code and sends no credentials to pairing endpoints`() {
        val t = FakeTransport(
            json(201, """{"code":"K7M3QX","pollToken":"tok","expiresAt":"2026-10-25T16:10:00.000Z","pollIntervalSeconds":5,"extra":1}"""),
        )
        val r = client(t).requestPairing("watch-1", "Galaxy Watch 4")
        assertEquals(ApiResult.Ok(201, PairingRequestResponse("K7M3QX", "tok", "2026-10-25T16:10:00.000Z", 5)), r)
        val req = t.requests.single()
        assertEquals("POST", req.method)
        assertEquals("https://example.test/api/v1/pairing/request", req.url)
        assertNull(req.headers["Authorization"])
        assertEquals("application/json", req.headers["Content-Type"])
        assertEquals("""{"deviceId":"watch-1","deviceName":"Galaxy Watch 4"}""", req.body)
    }

    @Test
    fun `sends the bearer key on authenticated calls but never prints it`() {
        val t = FakeTransport(json(200, """{"authenticated":true,"role":"device","deviceId":"watch-1","keyId":"0123456789abcdef"}"""))
        val r = client(t).session()
        assertEquals("Bearer $key", t.requests.single().headers["Authorization"])
        assertFalse(t.requests.single().toString().contains("secret"))
        assertTrue(r is ApiResult.Ok && r.value.role == "device")
    }

    @Test
    fun `parses the error envelope, the reason and Retry-After`() {
        val t = FakeTransport(
            json(422, """{"error":{"code":"VALIDATION_ERROR","message":"Invalid input: invalid_periodMinutes","details":{"reason":"invalid_periodMinutes"}}}"""),
            json(429, """{"error":{"code":"RATE_LIMITED","message":"Too many","details":{"retryAfterSeconds":42}}}""", "Retry-After" to "42"),
            json(410, """{"error":{"code":"CODE_EXPIRED","message":"This code has expired"}}"""),
            json(502, "<html>bad gateway</html>"),
        )
        val c = client(t)
        assertEquals(
            ApiResult.HttpError(422, "VALIDATION_ERROR", "Invalid input: invalid_periodMinutes", reason = "invalid_periodMinutes"),
            c.health(),
        )
        assertEquals(42L, (c.health() as ApiResult.HttpError).retryAfterSeconds)
        assertEquals("CODE_EXPIRED", (c.pollPairing("K7M3QX", "tok") as ApiResult.HttpError).code)
        assertEquals(ApiResult.HttpError(502, "HTTP_502", ""), c.health())
    }

    @Test
    fun `network errors and unexpected bodies are retryable network errors`() {
        val t = FakeTransport(SocketTimeoutException("timeout"), json(200, "not json"))
        val c = client(t)
        assertEquals(ApiResult.NetworkError("SocketTimeoutException"), c.health())
        assertEquals(ApiResult.NetworkError("bad_response"), c.health())
    }

    @Test
    fun `builds the read URLs of the guide`() {
        val t = FakeTransport(
            json(200, """{"matches":[{"id":"m1","homeTeamName":"Local","status":"live","score":{"home":1,"away":0}}],"serverTime":"2026-10-25T16:00:00.000Z"}"""),
            json(200, """{"events":[],"lastSeq":7,"state":{"status":"live","score":{"home":1,"away":0}},"serverTime":"2026-10-25T16:00:00.000Z"}"""),
        )
        val c = client(t)
        val list = c.listMatches() as ApiResult.Ok
        assertEquals(ScoreDto(1, 0), list.value.matches.single().score)
        assertEquals(7L, (c.eventsSince("m1", 3) as ApiResult.Ok).value.lastSeq)
        assertEquals(
            listOf(
                "https://example.test/api/v1/matches?status=scheduled,live&fields=homeTeamName,awayTeamName,scheduledAt,status,score,periods,periodMinutes",
                "https://example.test/api/v1/matches/m1/events?since=3",
            ),
            t.requests.map { it.url },
        )
    }

    @Test
    fun `encodes events without null fields`() {
        val body = EventBatchBody(
            "2026-10-25T16:40:00.000Z",
            listOf(EventDto("e1", "goal", "2026-10-25T16:12:40.000Z", team = "home", playerNumber = 9), EventDto("e2", "period_pause", "2026-10-25T16:13:00.000Z")),
        )
        assertEquals(
            """{"sentAt":"2026-10-25T16:40:00.000Z","events":[{"id":"e1","type":"goal","clientTimestamp":"2026-10-25T16:12:40.000Z","team":"home","playerNumber":9},{"id":"e2","type":"period_pause","clientTimestamp":"2026-10-25T16:13:00.000Z"}]}""",
            ApiJson.encodeToString(EventBatchBody.serializer(), body),
        )
    }
}
