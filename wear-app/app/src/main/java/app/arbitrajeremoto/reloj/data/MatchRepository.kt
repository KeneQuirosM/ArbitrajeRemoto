package app.arbitrajeremoto.reloj.data

import app.arbitrajeremoto.reloj.api.ApiJson
import app.arbitrajeremoto.reloj.api.CreateMatchBody
import app.arbitrajeremoto.reloj.data.db.CreateState
import app.arbitrajeremoto.reloj.data.db.EventEntity
import app.arbitrajeremoto.reloj.data.db.MatchEntity
import app.arbitrajeremoto.reloj.data.db.Origin
import app.arbitrajeremoto.reloj.data.db.RelojDao
import app.arbitrajeremoto.reloj.data.db.SyncState
import app.arbitrajeremoto.reloj.domain.Derive
import app.arbitrajeremoto.reloj.domain.EventClock
import app.arbitrajeremoto.reloj.domain.EventDraft
import app.arbitrajeremoto.reloj.domain.EventType
import app.arbitrajeremoto.reloj.domain.MatchEvent
import app.arbitrajeremoto.reloj.domain.MatchRules
import app.arbitrajeremoto.reloj.domain.MatchState
import app.arbitrajeremoto.reloj.domain.TeamSide
import app.arbitrajeremoto.reloj.domain.Validate
import app.arbitrajeremoto.reloj.domain.Validated
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.UUID

/** A match with its events and the state derived from them (never stored). */
data class MatchView(
    val match: MatchEntity,
    val events: List<EventEntity>,
    val state: MatchState,
) {
    val rules: MatchRules get() = MatchRules(match.periods, match.periodMinutes)
    val pendingCount: Int get() = events.count { it.syncState == SyncState.PENDING } + if (match.createState == CreateState.PENDING) 1 else 0
    val rejectedCount: Int get() = events.count { it.syncState == SyncState.REJECTED }
}

/** Local matches and events. Everything is written here first; sending is done by the sync layer. */
class MatchRepository(
    private val dao: RelojDao,
    private val eventClock: EventClock,
    private val deviceId: suspend () -> String,
    private val now: () -> Long = System::currentTimeMillis,
    private val newId: () -> String = { UUID.randomUUID().toString() },
) {
    private val seedLock = Mutex()
    private var seeded = false

    fun observeMatches(): Flow<List<MatchView>> =
        combine(dao.observeMatches(), dao.observeAllEvents()) { matches, events ->
            val byMatch = events.groupBy { it.matchId }
            matches.filter { it.createState != CreateState.DELETED }.map { view(it, byMatch[it.id].orEmpty()) }
        }

    fun observeMatch(id: String): Flow<MatchView?> =
        combine(dao.observeMatch(id), dao.observeEvents(id)) { match, events -> match?.let { view(it, events) } }

    fun observePendingCount(): Flow<Int> = dao.observePendingCount().map { it }

    /**
     * Guide §6: a quick match ("Local" vs "Visitante", 2×45) with a watch-generated id. The creation
     * body is encoded once and stored, so every resend is identical.
     */
    suspend fun createQuickMatch(): String {
        val id = newId()
        val body = ApiJson.encodeToString(CreateMatchBody.serializer(), CreateMatchBody(id = id, deviceId = deviceId()))
        dao.insertMatch(
            MatchEntity(
                id = id,
                creationBody = body,
                homeTeamName = DEFAULT_HOME,
                awayTeamName = DEFAULT_AWAY,
                homeTeamId = null,
                awayTeamId = null,
                periods = 2,
                periodMinutes = 45,
                origin = Origin.LOCAL,
                createState = CreateState.PENDING,
                createError = null,
                createdAtMs = now(),
                lastSeq = 0,
                serverStateJson = null,
                serverTime = null,
                clockOffsetMs = null,
            ),
        )
        return id
    }

    /**
     * Registers one event: validated like the server would, timestamped with
     * `max(now, last + 1 ms)`, stored and queued. Returns the id, or the rejection reason.
     */
    suspend fun record(matchId: String, draft: EventDraft): Result<String> {
        val match = dao.match(matchId) ?: return Result.failure(IllegalArgumentException("unknown_match"))
        val id = newId()
        val normalized = when (val v = Validate.event(id, draft, match.periods)) {
            is Validated.Ok -> v.draft
            is Validated.Invalid -> return Result.failure(IllegalArgumentException(v.reason))
        }
        seedClock()
        val t = eventClock.next()
        dao.enqueue(
            EventEntity(
                id = id,
                matchId = matchId,
                type = normalized.type.wire,
                team = normalized.team?.wire,
                playerNumber = normalized.playerNumber,
                playerOutNumber = normalized.playerOutNumber,
                playerInNumber = normalized.playerInNumber,
                text = normalized.text,
                voidsEventId = normalized.voidsEventId,
                period = normalized.period,
                minutes = normalized.minutes,
                clientTimestamp = EventClock.iso(t),
                t = t,
                origin = Origin.LOCAL,
                syncState = SyncState.PENDING,
                rejectReason = null,
                queueOrder = 0,
                seq = 0,
            ),
        )
        return Result.success(id)
    }

    /** After a restart, never go below the last stored local timestamp. */
    private suspend fun seedClock() = seedLock.withLock {
        if (!seeded) {
            dao.maxLocalT()?.let { eventClock.seed(it) }
            seeded = true
        }
    }

    companion object {
        /** The server's default names for a quick match (server/matches.ts). */
        const val DEFAULT_HOME = "Local"
        const val DEFAULT_AWAY = "Visitante"

        fun view(match: MatchEntity, events: List<EventEntity>): MatchView =
            MatchView(match, events, Derive.deriveState(MatchRules(match.periods, match.periodMinutes), events.filter { it.syncState != SyncState.REJECTED }.mapNotNull { it.toDomain() }))

        fun EventEntity.toDomain(): MatchEvent? {
            val type = EventType.fromWire(type) ?: return null
            return MatchEvent(
                id = id,
                type = type,
                t = t,
                team = TeamSide.fromWire(team),
                playerNumber = playerNumber,
                playerOutNumber = playerOutNumber,
                playerInNumber = playerInNumber,
                text = text,
                voidsEventId = voidsEventId,
                period = period,
                minutes = minutes,
                seq = seq,
            )
        }
    }
}
