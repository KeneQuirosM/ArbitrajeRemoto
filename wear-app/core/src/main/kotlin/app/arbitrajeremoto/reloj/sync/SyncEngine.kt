package app.arbitrajeremoto.reloj.sync

import app.arbitrajeremoto.reloj.api.ApiJson
import app.arbitrajeremoto.reloj.api.ApiResult
import app.arbitrajeremoto.reloj.api.CompactStateDto
import app.arbitrajeremoto.reloj.api.CreateMatchResponse
import app.arbitrajeremoto.reloj.api.EventBatchBody
import app.arbitrajeremoto.reloj.api.EventBatchResponse
import app.arbitrajeremoto.reloj.api.EventDto
import app.arbitrajeremoto.reloj.domain.EventClock
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Creation state of a match on the server (mirrors the app's database values). */
enum class CreateStatus { PENDING, CREATED, CONFLICT, DELETED, REJECTED }

/** A match with work to send. [creationBody] is the exact `POST /matches` body (null for server matches). */
data class SyncMatch(val id: String, val creationBody: String?, val status: CreateStatus)

data class QueuedEvent(val id: String, val dto: EventDto)

/** What the server last said about a match: kept only to show it (guide §8). */
data class ServerSnapshot(val state: CompactStateDto, val clockOffsetMs: Long, val serverTime: String)

/** Storage the engine works on: Room on the watch, memory in tests and contract tests. */
interface SyncStore {
    /** Matches whose creation is PENDING, or CREATED with pending events, oldest first. */
    suspend fun matchesWithWork(): List<SyncMatch>

    /** Pending events of a match in queue order. */
    suspend fun pendingEvents(matchId: String, limit: Int): List<QueuedEvent>
    suspend fun setCreateStatus(matchId: String, status: CreateStatus, error: String?)
    suspend fun markSent(matchId: String, ids: List<String>)
    suspend fun markRejected(matchId: String, id: String, reason: String)
    suspend fun saveSnapshot(matchId: String, snapshot: ServerSnapshot)
}

interface SyncApi {
    suspend fun createMatch(rawBody: String): ApiResult<CreateMatchResponse>
    suspend fun postEvents(matchId: String, body: EventBatchBody): ApiResult<EventBatchResponse>
}

sealed interface SyncOutcome {
    /** Nothing left to send (or nothing sendable). */
    data object Done : SyncOutcome

    /** Network error, timeout or 5xx: retry with exponential backoff. */
    data class Retry(val reason: String) : SyncOutcome

    /** 429 / 503: wait what Retry-After says. */
    data class RetryAfter(val delayMs: Long, val reason: String) : SyncOutcome

    /** 401: the key was revoked. The queue is kept (guide §4.4). */
    data object Unauthorized : SyncOutcome
}

/** Retry delays: 5 s, 10 s, 20 s… up to 5 min (guide §7.4). */
object Backoff {
    const val FIRST_MS = 5_000L
    const val MAX_MS = 5 * 60_000L

    fun delayMs(attempt: Int): Long {
        if (attempt <= 0) return FIRST_MS
        val shift = attempt.coerceAtMost(20)
        return (FIRST_MS shl shift).coerceAtMost(MAX_MS)
    }
}

/**
 * Sends the queue (guide §6, §7.3): first each match's creation with its exact stored body, then its
 * events, one match per request, at most [maxEvents] events and [maxBytes] per batch, `sentAt`
 * recomputed on every attempt. Everything is idempotent, so any step can be retried.
 */
class SyncEngine(
    private val store: SyncStore,
    private val api: SyncApi,
    private val now: () -> Long = System::currentTimeMillis,
    private val maxEvents: Int = MAX_EVENTS_PER_BATCH,
    private val maxBytes: Int = MAX_BATCH_BYTES,
) {
    private val mutex = Mutex()

    /** One pass over all the work. Concurrent calls wait for each other. */
    suspend fun syncOnce(): SyncOutcome = mutex.withLock {
        repeat(MAX_ROUNDS) {
            val matches = store.matchesWithWork()
            if (matches.isEmpty()) return SyncOutcome.Done
            for (match in matches) {
                val stop = syncMatch(match)
                if (stop != null) return stop
            }
        }
        // Still work after many rounds (e.g. a 404 that never clears): try later.
        SyncOutcome.Retry("too_many_rounds")
    }

    /** Returns an outcome to stop the whole pass, or null to continue with the next match. */
    private suspend fun syncMatch(match: SyncMatch): SyncOutcome? {
        if (match.status == CreateStatus.PENDING) {
            val body = match.creationBody
            if (body == null) {
                store.setCreateStatus(match.id, CreateStatus.REJECTED, "no_creation_body")
                return null
            }
            when (val r = api.createMatch(body)) {
                is ApiResult.Ok -> store.setCreateStatus(match.id, CreateStatus.CREATED, null)
                is ApiResult.HttpError -> when {
                    r.status == 409 -> {
                        // Should not happen: the body never changes. Logged on the match, its events are kept.
                        store.setCreateStatus(match.id, CreateStatus.CONFLICT, r.code)
                        return null
                    }
                    r.status == 410 -> {
                        store.setCreateStatus(match.id, CreateStatus.DELETED, r.code)
                        return null
                    }
                    else -> {
                        fatalForMatch(r)?.let { reason ->
                            store.setCreateStatus(match.id, CreateStatus.REJECTED, reason)
                            return null
                        }
                        return stopFor(r)
                    }
                }
                is ApiResult.NetworkError -> return SyncOutcome.Retry(r.message)
            }
        }
        return sendEvents(match)
    }

    private suspend fun sendEvents(match: SyncMatch): SyncOutcome? {
        while (true) {
            val pending = store.pendingEvents(match.id, maxEvents)
            if (pending.isEmpty()) return null
            when (val r = sendBatch(match, fitBatch(pending))) {
                BatchResult.Sent -> continue
                BatchResult.MatchClosed -> return null
                is BatchResult.Stop -> return r.outcome
            }
        }
    }

    private sealed interface BatchResult {
        data object Sent : BatchResult

        /** Deleted (410), needs its creation (404) or not sendable: go on with other matches. */
        data object MatchClosed : BatchResult
        data class Stop(val outcome: SyncOutcome) : BatchResult
    }

    private suspend fun sendBatch(match: SyncMatch, events: List<QueuedEvent>): BatchResult {
        val body = EventBatchBody(sentAt = EventClock.iso(now()), events = events.map { it.dto })
        when (val r = api.postEvents(match.id, body)) {
            is ApiResult.Ok -> {
                val byId = r.value.results.filter { it.id != null }.associateBy { it.id!!.lowercase() }
                val sent = mutableListOf<String>()
                var missing = false
                for (e in events) {
                    val result = byId[e.id.lowercase()]
                    when (result?.status) {
                        "accepted", "duplicate" -> sent += e.id
                        "rejected" -> store.markRejected(match.id, e.id, result.reason ?: "rejected")
                        else -> missing = true
                    }
                }
                if (sent.isNotEmpty()) store.markSent(match.id, sent)
                store.saveSnapshot(match.id, ServerSnapshot(r.value.state, r.value.clockOffsetMs, r.value.serverTime))
                // An event without a result stays queued; stop instead of looping on it.
                return if (missing) BatchResult.Stop(SyncOutcome.Retry("incomplete_results")) else BatchResult.Sent
            }
            is ApiResult.HttpError -> return when {
                r.status == 413 -> {
                    if (events.size == 1) {
                        store.markRejected(match.id, events[0].id, "payload_too_large")
                        BatchResult.Sent
                    } else {
                        val half = events.size / 2
                        val first = sendBatch(match, events.subList(0, half))
                        if (first != BatchResult.Sent) first else sendBatch(match, events.subList(half, events.size))
                    }
                }
                r.status == 404 -> {
                    if (match.creationBody != null) {
                        // The creation is missing on the server: send it first, then the events.
                        store.setCreateStatus(match.id, CreateStatus.PENDING, r.code)
                    } else {
                        store.setCreateStatus(match.id, CreateStatus.REJECTED, "not_found")
                    }
                    BatchResult.MatchClosed
                }
                r.status == 410 -> {
                    store.setCreateStatus(match.id, CreateStatus.DELETED, r.code)
                    BatchResult.MatchClosed
                }
                r.status == 403 -> {
                    store.setCreateStatus(match.id, CreateStatus.REJECTED, r.code)
                    BatchResult.MatchClosed
                }
                else -> BatchResult.Stop(stopFor(r))
            }
            is ApiResult.NetworkError -> return BatchResult.Stop(SyncOutcome.Retry(r.message))
        }
    }

    /** Takes events in queue order while they fit in one request. Always at least one. */
    private fun fitBatch(pending: List<QueuedEvent>): List<QueuedEvent> {
        var size = ENVELOPE_BYTES
        var count = 0
        for (e in pending) {
            val bytes = ApiJson.encodeToString(EventDto.serializer(), e.dto).toByteArray(Charsets.UTF_8).size + 1
            if (count > 0 && (size + bytes > maxBytes || count >= maxEvents)) break
            size += bytes
            count++
        }
        return pending.subList(0, count.coerceAtLeast(1))
    }

    /** Errors that make a match's creation unsendable as is (validation, permission). */
    private fun fatalForMatch(r: ApiResult.HttpError): String? = when (r.status) {
        400, 403, 413, 415, 422 -> r.reason ?: r.code
        else -> null
    }

    private fun stopFor(r: ApiResult.HttpError): SyncOutcome = when {
        r.status == 401 -> SyncOutcome.Unauthorized
        r.status == 429 -> SyncOutcome.RetryAfter((r.retryAfterSeconds ?: RATE_LIMIT_FALLBACK_S) * 1000, r.code)
        r.status == 503 -> SyncOutcome.RetryAfter((r.retryAfterSeconds ?: BUSY_FALLBACK_S) * 1000, r.code)
        else -> SyncOutcome.Retry("http_${r.status}")
    }

    companion object {
        const val MAX_EVENTS_PER_BATCH = 200
        const val MAX_BATCH_BYTES = 64 * 1024

        /** `{"sentAt":"…","events":[]}` plus a safety margin. */
        private const val ENVELOPE_BYTES = 256
        private const val MAX_ROUNDS = 20
        private const val RATE_LIMIT_FALLBACK_S = 30L
        private const val BUSY_FALLBACK_S = 5L
    }
}
