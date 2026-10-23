package app.arbitrajeremoto.reloj.contract

import app.arbitrajeremoto.reloj.api.ApiClient
import app.arbitrajeremoto.reloj.api.ApiJson
import app.arbitrajeremoto.reloj.api.ApiResult
import app.arbitrajeremoto.reloj.api.CreateMatchBody
import app.arbitrajeremoto.reloj.api.EventBatchBody
import app.arbitrajeremoto.reloj.api.EventDto
import app.arbitrajeremoto.reloj.api.HttpRequest
import app.arbitrajeremoto.reloj.api.HttpResponse
import app.arbitrajeremoto.reloj.api.PairingPollResponse
import app.arbitrajeremoto.reloj.api.PairingRequestResponse
import app.arbitrajeremoto.reloj.api.ServerConfig
import app.arbitrajeremoto.reloj.api.StoredEventDto
import app.arbitrajeremoto.reloj.api.UrlConnectionTransport
import app.arbitrajeremoto.reloj.domain.ClockState
import app.arbitrajeremoto.reloj.domain.Derive
import app.arbitrajeremoto.reloj.domain.EventClock
import app.arbitrajeremoto.reloj.domain.EventType
import app.arbitrajeremoto.reloj.domain.MatchEvent
import app.arbitrajeremoto.reloj.domain.MatchRules
import app.arbitrajeremoto.reloj.domain.MatchState
import app.arbitrajeremoto.reloj.domain.TeamSide
import app.arbitrajeremoto.reloj.pairing.DeviceCredentials
import app.arbitrajeremoto.reloj.pairing.KeyStatus
import app.arbitrajeremoto.reloj.pairing.PairingApi
import app.arbitrajeremoto.reloj.pairing.PairingController
import app.arbitrajeremoto.reloj.pairing.PairingState
import app.arbitrajeremoto.reloj.pairing.SessionCheck
import app.arbitrajeremoto.reloj.sync.CreateStatus
import app.arbitrajeremoto.reloj.sync.MemorySyncStore
import app.arbitrajeremoto.reloj.sync.SyncApi
import app.arbitrajeremoto.reloj.sync.SyncEngine
import app.arbitrajeremoto.reloj.sync.SyncOutcome
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.UUID

/**
 * Block R3 contract tests: the watch's own code (ApiClient, PairingController, SyncEngine, Derive)
 * against the real API of this repository, started locally by the CI `contract` job
 * (`npm run dev:api`). Needs CONTRACT_BASE_URL and CONTRACT_PASSPHRASE; fails without them.
 *
 * One test, in order, because each step needs the previous one (and pairing codes are rate limited).
 */
class WatchContractTest {
    private val base = System.getenv("CONTRACT_BASE_URL")?.trimEnd('/')
        ?: error("CONTRACT_BASE_URL is not set (e.g. http://localhost:8787/api/v1)")
    private val passphrase = System.getenv("CONTRACT_PASSPHRASE")
        ?: error("CONTRACT_PASSPHRASE is not set")
    private val transport = UrlConnectionTransport()

    @Volatile
    private var deviceKey: String? = null
    private val api = ApiClient({ base }, transport, { deviceKey })

    private fun step(name: String) = println("\n== $name")

    // --- Owner (the web), as in examples/curl.sh

    private var cookie: String? = null

    private fun owner(method: String, path: String, body: String? = null): HttpResponse {
        val headers = buildMap {
            cookie?.let { put("Cookie", it) }
            if (body != null) put("Content-Type", "application/json")
        }
        val response = transport.execute(HttpRequest(method, base + path, headers, body))
        println("   owner $method $path -> ${response.status}")
        return response
    }

    private fun ownerLogin() {
        val res = owner("POST", "/session", Json.encodeToString(JsonObject.serializer(), JsonObject(mapOf("passphrase" to kotlinx.serialization.json.JsonPrimitive(passphrase)))))
        assertEquals(res.body, 200, res.status)
        cookie = res.header("set-cookie")!!.substringBefore(';')
    }

    private fun <T> ok(result: ApiResult<T>, status: Int? = null): T {
        if (result !is ApiResult.Ok) error("Expected success, got $result")
        if (status != null) assertEquals(status, result.status)
        return result.value
    }

    private fun httpError(result: ApiResult<*>): ApiResult.HttpError =
        result as? ApiResult.HttpError ?: error("Expected an HTTP error, got $result")

    private val pairingApi = object : PairingApi {
        override suspend fun request(deviceId: String, deviceName: String?): ApiResult<PairingRequestResponse> =
            withContext(Dispatchers.IO) { api.requestPairing(deviceId, deviceName) }
        override suspend fun poll(code: String, pollToken: String): ApiResult<PairingPollResponse> =
            withContext(Dispatchers.IO) { api.pollPairing(code, pollToken) }
    }

    private val syncApi = object : SyncApi {
        override suspend fun createMatch(rawBody: String) = withContext(Dispatchers.IO) { api.createMatch(rawBody) }
        override suspend fun postEvents(matchId: String, body: EventBatchBody) = withContext(Dispatchers.IO) { api.postEvents(matchId, body) }
    }

    @Test
    fun `the watch flow against the real API`() = runBlocking {
        step("0. Health")
        ok(api.health(), 200)
        ownerLogin()

        step("1. Pairing step by step: 201 code, 202 pending, owner approves (lowercase, hyphen), 200 key once, 410 CODE_USED")
        val rawDevice = ServerConfig.newDeviceId()
        val code = ok(api.requestPairing(rawDevice, "Contract raw"), 201)
        assertTrue(code.code, Regex("^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$").matches(code.code))
        assertEquals(5, code.pollIntervalSeconds)
        assertEquals("pending", ok(api.pollPairing(code.code, code.pollToken), 202).status)
        val typed = code.code.lowercase().let { it.substring(0, 3) + "-" + it.substring(3) }
        assertEquals(200, owner("POST", "/pairing/approve", """{"code":"$typed"}""").status)
        val approved = ok(api.pollPairing(code.code, code.pollToken), 200)
        assertTrue(approved.deviceKey!!.startsWith("ark1_"))
        assertEquals(rawDevice, approved.deviceId)
        assertEquals("CODE_USED", httpError(api.pollPairing(code.code, code.pollToken)).code)
        assertEquals(404, httpError(api.pollPairing(code.code, "wrong-token")).status)

        step("2. Pairing with the watch's PairingController (real 5 s polling)")
        val deviceId = ServerConfig.newDeviceId()
        var saved: DeviceCredentials? = null
        val controller = PairingController(pairingApi, deviceId, "Contract watch", saveKey = { saved = it }, now = System::currentTimeMillis)
        val job = launch(Dispatchers.IO) { controller.run() }
        val shown = withTimeout(30_000) { controller.state.first { it is PairingState.ShowingCode } } as PairingState.ShowingCode
        assertEquals(200, owner("POST", "/pairing/approve", """{"code":"${shown.code}"}""").status)
        withTimeout(60_000) { job.join() }
        assertEquals(PairingState.Paired("Contract watch"), controller.state.value)
        val credentials = saved ?: error("key not stored")
        deviceKey = credentials.deviceKey

        step("3. GET /session with the key")
        assertEquals(KeyStatus.VALID, SessionCheck.evaluate(api.session()))
        assertEquals(deviceId, ok(api.session()).deviceId)

        step("4. Quick match created twice: 201, then 200 duplicate")
        val matchId = UUID.randomUUID().toString()
        val body = ApiJson.encodeToString(CreateMatchBody.serializer(), CreateMatchBody(matchId, deviceId))
        val first = ok(api.createMatch(body), 201)
        assertEquals(false, first.duplicate)
        assertEquals("Local", first.match.homeTeamName)
        assertEquals("Visitante", first.match.awayTeamName)
        assertEquals(true, ok(api.createMatch(body), 200).duplicate)

        step("5. The same batch twice: all accepted, then all duplicate")
        // Registered 40 minutes ago (the server accepts up to 30 days back and 5 min ahead)
        val t0 = System.currentTimeMillis() - 40 * MIN
        val events = listOf(
            dto(EventType.PERIOD_START, t0, period = 1),
            dto(EventType.GOAL, t0 + 5 * MIN, team = TeamSide.HOME, number = 9),
            dto(EventType.OWN_GOAL, t0 + 8 * MIN, team = TeamSide.AWAY, number = 4),
            dto(EventType.YELLOW_CARD, t0 + 10 * MIN, team = TeamSide.AWAY, number = 5),
            dto(EventType.YELLOW_CARD, t0 + 12 * MIN, team = TeamSide.AWAY, number = 5),
            dto(EventType.SUBSTITUTION, t0 + 15 * MIN).copy(team = "home", playerOutNumber = 10, playerInNumber = 14),
            dto(EventType.PERIOD_PAUSE, t0 + 20 * MIN),
            dto(EventType.PERIOD_RESUME, t0 + 22 * MIN),
            dto(EventType.GOAL, t0 + 25 * MIN, team = TeamSide.AWAY),
            dto(EventType.ADDED_TIME, t0 + 28 * MIN).copy(minutes = 2),
        ).let { list -> list + dto(EventType.VOID, t0 + 30 * MIN).copy(voidsEventId = list[8].id) }
        val batch = { EventBatchBody(EventClock.iso(System.currentTimeMillis()), events) }
        val once = ok(api.postEvents(matchId, batch()), 200)
        assertEquals(once.results.toString(), List(events.size) { "accepted" }, once.results.map { it.status })
        val twice = ok(api.postEvents(matchId, batch()), 200)
        assertEquals(List(events.size) { "duplicate" }, twice.results.map { it.status })
        assertEquals(events.size.toLong(), twice.state.lastSeq)

        step("6. The server's derived state equals the Kotlin domain's")
        val detail = ok(api.getMatchWithEvents(matchId), 200)
        assertEquals(events.size, detail.events.size)
        val rules = MatchRules(detail.match.periods, detail.match.periodMinutes)
        val fromServerEvents = Derive.deriveState(rules, detail.events.map { it.toDomain() })
        assertSameState(fromServerEvents, detail.state)
        val fromWatchEvents = Derive.deriveState(rules, events.map { it.toDomain() })
        assertSameState(fromWatchEvents, detail.state)
        assertEquals(2, fromWatchEvents.score.home) // goal home + own goal away
        assertEquals(0, fromWatchEvents.score.away) // away goal undone
        assertTrue(fromWatchEvents.discipline.single().secondYellow)

        step("7. SyncEngine end to end: 251 queued events in 2 batches, resent without duplicates")
        val store = MemorySyncStore()
        val engine = SyncEngine(store, syncApi)
        val syncMatch = UUID.randomUUID().toString()
        store.addMatch(syncMatch, ApiJson.encodeToString(CreateMatchBody.serializer(), CreateMatchBody(syncMatch, deviceId)))
        val start = System.currentTimeMillis() - 20 * MIN
        store.enqueue(syncMatch, dto(EventType.PERIOD_START, start, period = 1))
        repeat(250) { i -> store.enqueue(syncMatch, dto(EventType.NOTE, start + (i + 1) * 1_000L).copy(text = "Nota $i")) }
        assertEquals(SyncOutcome.Done, engine.syncOnce())
        assertEquals(CreateStatus.CREATED, store.matches[syncMatch]!!.status)
        assertTrue(store.events.all { it.state == MemorySyncStore.SENT })
        assertEquals(251L, ok(api.eventsSince(syncMatch, 0)).lastSeq)
        store.events.forEach { it.state = MemorySyncStore.PENDING } // answers lost: everything is resent
        store.matches[syncMatch]!!.status = CreateStatus.PENDING
        assertEquals(SyncOutcome.Done, engine.syncOnce())
        assertEquals(251L, ok(api.eventsSince(syncMatch, 0)).lastSeq)
        assertEquals(0, ok(api.eventsSince(syncMatch, 251)).events.size)

        step("8. Revoked key: 401, back to pairing, the queue is kept")
        assertEquals(204, owner("DELETE", "/devices/${credentials.keyId}").status)
        assertEquals(401, httpError(api.session()).status)
        assertEquals(KeyStatus.REVOKED, SessionCheck.evaluate(api.session()))
        store.enqueue(syncMatch, dto(EventType.MATCH_END, System.currentTimeMillis() - 1_000))
        assertEquals(SyncOutcome.Unauthorized, engine.syncOnce())
        assertEquals(1, store.events.count { it.state == MemorySyncStore.PENDING })

        step("9. Clean up")
        assertEquals(204, owner("DELETE", "/matches/$matchId").status)
        assertEquals(204, owner("DELETE", "/matches/$syncMatch").status)
        assertEquals(204, owner("DELETE", "/devices/${approved.keyId}").status)
        println("\nContract OK")
    }

    private fun dto(type: EventType, t: Long, period: Int? = null, team: TeamSide? = null, number: Int? = null) =
        EventDto(UUID.randomUUID().toString(), type.wire, EventClock.iso(t), team = team?.wire, playerNumber = number, period = period)

    private fun EventDto.toDomain() = MatchEvent(
        id, EventType.fromWire(type)!!, java.time.Instant.parse(clientTimestamp).toEpochMilli(), TeamSide.fromWire(team),
        playerNumber, playerOutNumber, playerInNumber, text, voidsEventId, period, minutes,
    )

    private fun StoredEventDto.toDomain() = MatchEvent(
        id, EventType.fromWire(type)!!, t, TeamSide.fromWire(team),
        playerNumber, playerOutNumber, playerInNumber, text, voidsEventId, period, minutes, seq,
    )

    private fun assertSameState(local: MatchState, server: app.arbitrajeremoto.reloj.api.CompactStateDto) {
        assertEquals(server.status, local.status.wire)
        assertEquals(server.score.home, local.score.home)
        assertEquals(server.score.away, local.score.away)
        val c = server.clock
        assertEquals(ClockState(c.period, c.running, c.elapsedMs, c.anchorAt, c.addedMinutes), local.clock)
        assertEquals(
            server.discipline.map { listOf(it.team, it.playerNumber, it.yellow, it.red, it.secondYellow) },
            local.discipline.map { listOf(it.team.wire, it.playerNumber, it.yellow, it.red, it.secondYellow) },
        )
    }

    companion object {
        private const val MIN = 60_000L
    }
}
