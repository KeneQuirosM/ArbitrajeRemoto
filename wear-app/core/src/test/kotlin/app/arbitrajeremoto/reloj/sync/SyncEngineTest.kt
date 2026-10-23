package app.arbitrajeremoto.reloj.sync

import app.arbitrajeremoto.reloj.api.ApiResult
import app.arbitrajeremoto.reloj.api.CompactStateDto
import app.arbitrajeremoto.reloj.api.CreateMatchResponse
import app.arbitrajeremoto.reloj.api.EventBatchBody
import app.arbitrajeremoto.reloj.api.EventBatchResponse
import app.arbitrajeremoto.reloj.api.EventDto
import app.arbitrajeremoto.reloj.api.EventResultDto
import app.arbitrajeremoto.reloj.api.MatchDto
import app.arbitrajeremoto.reloj.api.ScoreDto
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncEngineTest {
    private val state = CompactStateDto("live", ScoreDto(1, 0))
    private val created = ApiResult.Ok(201, CreateMatchResponse(MatchDto("m1", homeTeamName = "Local", awayTeamName = "Visitante"), state))
    private val body = """{"id":"m1","deviceId":"watch-1"}"""
    private var now = 1_792_944_000_000L

    /** Fake server: records requests, answers from scripts, accepts by default. */
    private inner class FakeApi : SyncApi {
        val creations = mutableListOf<String>()
        val batches = mutableListOf<EventBatchBody>()
        val createScript = ArrayDeque<ApiResult<CreateMatchResponse>>()
        val eventScript = ArrayDeque<(EventBatchBody) -> ApiResult<EventBatchResponse>>()
        val known = mutableSetOf<String>()

        override suspend fun createMatch(rawBody: String): ApiResult<CreateMatchResponse> {
            creations += rawBody
            return createScript.removeFirstOrNull() ?: created
        }

        override suspend fun postEvents(matchId: String, body: EventBatchBody): ApiResult<EventBatchResponse> {
            batches += body
            now += 1_000
            eventScript.removeFirstOrNull()?.let { return it(body) }
            return ok(body)
        }

        fun ok(body: EventBatchBody, reject: Set<String> = emptySet()) = ApiResult.Ok(
            200,
            EventBatchResponse(
                results = body.events.map {
                    when {
                        it.id in reject -> EventResultDto(it.id, "rejected", "invalid_playerNumber")
                        known.add(it.id) -> EventResultDto(it.id, "accepted")
                        else -> EventResultDto(it.id, "duplicate")
                    }
                },
                state = state,
                clockOffsetMs = 0,
                serverTime = "2026-10-25T16:40:00.120Z",
            ),
        )
    }

    private fun event(i: Int, text: String? = null) =
        EventDto("00000000-0000-4000-8000-${i.toString().padStart(12, '0')}", if (text != null) "note" else "goal", "2026-10-25T16:00:00.000Z", team = if (text == null) "home" else null, text = text)

    private fun setup(events: Int, status: CreateStatus = CreateStatus.PENDING): Triple<MemorySyncStore, FakeApi, SyncEngine> {
        val store = MemorySyncStore()
        store.addMatch("m1", body, status)
        repeat(events) { store.enqueue("m1", event(it)) }
        val api = FakeApi()
        return Triple(store, api, SyncEngine(store, api, now = { now }))
    }

    @Test
    fun `creation first with the exact stored body, then events, nothing left after`() = runBlocking {
        val (store, api, engine) = setup(3)
        assertEquals(SyncOutcome.Done, engine.syncOnce())
        assertEquals(listOf(body), api.creations)
        assertEquals(1, api.batches.size)
        assertTrue(store.events.all { it.state == MemorySyncStore.SENT })
        assertEquals(CreateStatus.CREATED, store.matches["m1"]!!.status)
        assertEquals("2026-10-25T16:40:00.120Z", store.snapshots["m1"]!!.serverTime)
        assertEquals(SyncOutcome.Done, engine.syncOnce())
        assertEquals(1, api.creations.size)
    }

    @Test
    fun `200 duplicate on creation is a success`() = runBlocking {
        val (store, api, engine) = setup(1)
        api.createScript += ApiResult.Ok(200, CreateMatchResponse(MatchDto("m1", homeTeamName = "Local", awayTeamName = "Visitante"), state, duplicate = true))
        assertEquals(SyncOutcome.Done, engine.syncOnce())
        assertEquals(MemorySyncStore.SENT, store.events.single().state)
    }

    @Test
    fun `batches of at most 200 events, sentAt recomputed for each`() = runBlocking {
        val (store, api, engine) = setup(450, CreateStatus.CREATED)
        assertEquals(SyncOutcome.Done, engine.syncOnce())
        assertEquals(listOf(200, 200, 50), api.batches.map { it.events.size })
        assertEquals(3, api.batches.map { it.sentAt }.toSet().size)
        assertEquals(450, store.events.count { it.state == MemorySyncStore.SENT })
    }

    @Test
    fun `batches never exceed 64 KB`() = runBlocking {
        val store = MemorySyncStore()
        store.addMatch("m1", body, CreateStatus.CREATED)
        repeat(200) { store.enqueue("m1", event(it, text = "x".repeat(500))) }
        val api = FakeApi()
        assertEquals(SyncOutcome.Done, SyncEngine(store, api, now = { now }).syncOnce())
        assertTrue(api.batches.size > 1)
        for (b in api.batches) {
            val size = app.arbitrajeremoto.reloj.api.ApiJson.encodeToString(EventBatchBody.serializer(), b).toByteArray().size
            assertTrue("batch of $size bytes", size <= 64 * 1024)
        }
    }

    @Test
    fun `rejected events leave the queue marked with their reason`() = runBlocking {
        val (store, api, engine) = setup(3, CreateStatus.CREATED)
        val bad = event(1).id
        api.eventScript += { b -> api.ok(b, reject = setOf(bad)) }
        assertEquals(SyncOutcome.Done, engine.syncOnce())
        assertEquals(MemorySyncStore.REJECTED, store.stateOf(bad))
        assertEquals("invalid_playerNumber", store.events.first { it.dto.id == bad }.reason)
        assertEquals(2, store.events.count { it.state == MemorySyncStore.SENT })
    }

    @Test
    fun `resending the same events gives duplicates and they leave the queue`() = runBlocking {
        val (store, api, engine) = setup(2, CreateStatus.CREATED)
        engine.syncOnce()
        store.events.forEach { it.state = MemorySyncStore.PENDING } // the answer was lost
        assertEquals(SyncOutcome.Done, engine.syncOnce())
        assertTrue(store.events.all { it.state == MemorySyncStore.SENT })
        assertEquals(api.batches[0].events, api.batches[1].events)
    }

    @Test
    fun `401 stops and keeps the queue`() = runBlocking {
        val (store, api, engine) = setup(2)
        api.createScript += ApiResult.HttpError(401, "UNAUTHORIZED", "")
        assertEquals(SyncOutcome.Unauthorized, engine.syncOnce())
        assertEquals(CreateStatus.PENDING, store.matches["m1"]!!.status)
        assertTrue(store.events.all { it.state == MemorySyncStore.PENDING })
    }

    @Test
    fun `404 on events sends the creation first`() = runBlocking {
        val (store, api, engine) = setup(2, CreateStatus.CREATED)
        api.eventScript += { ApiResult.HttpError(404, "NOT_FOUND", "") }
        assertEquals(SyncOutcome.Done, engine.syncOnce())
        assertEquals(listOf(body), api.creations)
        assertEquals(2, api.batches.size)
        assertTrue(store.events.all { it.state == MemorySyncStore.SENT })
    }

    @Test
    fun `410 stops sending that match, other matches go on`() = runBlocking {
        val (store, api, engine) = setup(2, CreateStatus.CREATED)
        store.addMatch("m2", """{"id":"m2","deviceId":"watch-1"}""", CreateStatus.CREATED)
        store.enqueue("m2", event(99))
        api.eventScript += { ApiResult.HttpError(410, "GONE", "") }
        assertEquals(SyncOutcome.Done, engine.syncOnce())
        assertEquals(CreateStatus.DELETED, store.matches["m1"]!!.status)
        assertEquals(MemorySyncStore.SENT, store.stateOf(event(99).id))
        assertTrue(store.events.filter { it.matchId == "m1" }.all { it.state == MemorySyncStore.PENDING })
        assertEquals(SyncOutcome.Done, engine.syncOnce())
        assertEquals(2, api.batches.size)
    }

    @Test
    fun `409 on creation is recorded`() = runBlocking {
        val (store, api, engine) = setup(1)
        api.createScript += ApiResult.HttpError(409, "ID_CONFLICT", "")
        assertEquals(SyncOutcome.Done, engine.syncOnce())
        assertEquals(CreateStatus.CONFLICT, store.matches["m1"]!!.status)
        assertEquals("ID_CONFLICT", store.matches["m1"]!!.error)
        assertTrue(api.batches.isEmpty())
    }

    @Test
    fun `413 splits the batch`() = runBlocking {
        val (store, api, engine) = setup(10, CreateStatus.CREATED)
        api.eventScript += { ApiResult.HttpError(413, "PAYLOAD_TOO_LARGE", "") }
        assertEquals(SyncOutcome.Done, engine.syncOnce())
        assertEquals(listOf(10, 5, 5), api.batches.map { it.events.size })
        assertTrue(store.events.all { it.state == MemorySyncStore.SENT })
    }

    @Test
    fun `429 and 503 respect Retry-After, 5xx and network errors retry`() = runBlocking {
        for ((error, expected) in listOf(
            ApiResult.HttpError(429, "RATE_LIMITED", "", retryAfterSeconds = 42) to SyncOutcome.RetryAfter(42_000, "RATE_LIMITED"),
            ApiResult.HttpError(503, "BUSY", "", retryAfterSeconds = 1) to SyncOutcome.RetryAfter(1_000, "BUSY"),
            ApiResult.HttpError(500, "INTERNAL", "") to SyncOutcome.Retry("http_500"),
            ApiResult.NetworkError("SocketTimeoutException") to SyncOutcome.Retry("SocketTimeoutException"),
        )) {
            val (store, api, engine) = setup(1, CreateStatus.CREATED)
            api.eventScript += { error }
            assertEquals(expected, engine.syncOnce())
            assertEquals(MemorySyncStore.PENDING, store.events.single().state)
            assertEquals(SyncOutcome.Done, engine.syncOnce())
        }
    }

    @Test
    fun `backoff goes from 5 s to 5 min`() {
        assertEquals(listOf(5_000L, 10_000L, 20_000L, 40_000L, 80_000L, 160_000L, 300_000L, 300_000L), (0..7).map { Backoff.delayMs(it) })
        assertEquals(300_000L, Backoff.delayMs(1000))
    }
}

class SyncPolicyTest {
    @Test
    fun `next step after a pass`() {
        assertEquals(NextStep.Idle, SyncPolicy.next(SyncOutcome.Done, 3))
        assertEquals(NextStep.RunIn(5_000, 1), SyncPolicy.next(SyncOutcome.Retry("x"), 0))
        assertEquals(NextStep.RunIn(20_000, 3), SyncPolicy.next(SyncOutcome.Retry("x"), 2))
        assertEquals(NextStep.RunIn(42_000, 1), SyncPolicy.next(SyncOutcome.RetryAfter(42_000, "RATE_LIMITED"), 0))
        assertEquals(NextStep.RunIn(5_000, 1), SyncPolicy.next(SyncOutcome.RetryAfter(1_000, "BUSY"), 0))
        assertEquals(NextStep.Unpaired, SyncPolicy.next(SyncOutcome.Unauthorized, 0))
    }
}
