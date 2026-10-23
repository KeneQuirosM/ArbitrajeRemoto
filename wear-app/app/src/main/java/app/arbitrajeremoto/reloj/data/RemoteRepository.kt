package app.arbitrajeremoto.reloj.data

import app.arbitrajeremoto.reloj.api.ApiClient
import app.arbitrajeremoto.reloj.api.ApiJson
import app.arbitrajeremoto.reloj.api.ApiResult
import app.arbitrajeremoto.reloj.api.MatchListResponse
import app.arbitrajeremoto.reloj.api.StoredEventDto
import app.arbitrajeremoto.reloj.api.TeamDto
import app.arbitrajeremoto.reloj.api.TeamsResponse
import app.arbitrajeremoto.reloj.data.db.CacheEntity
import app.arbitrajeremoto.reloj.data.db.CreateState
import app.arbitrajeremoto.reloj.data.db.EventEntity
import app.arbitrajeremoto.reloj.data.db.MatchEntity
import app.arbitrajeremoto.reloj.data.db.Origin
import app.arbitrajeremoto.reloj.data.db.RelojDao
import app.arbitrajeremoto.reloj.data.db.SyncState
import app.arbitrajeremoto.reloj.domain.TeamSide
import app.arbitrajeremoto.reloj.ui.match.RosterPlayer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer

/** Last answer of a server list kept on the watch, with when it was read. */
data class Cached<T>(val value: T, val updatedAtMs: Long)

/**
 * Guide §9: reads from the server, stored on the watch so they work without network.
 * Matches of the day, rosters (shirt numbers with names) and matches started in the web.
 */
class RemoteRepository(
    private val dao: RelojDao,
    private val api: ApiClient,
    private val now: () -> Long = System::currentTimeMillis,
) {
    fun observeTodayMatches(): Flow<Cached<MatchListResponse>?> = observe(KEY_MATCHES, MatchListResponse.serializer())

    fun observeTeams(): Flow<Cached<TeamsResponse>?> = observe(KEY_TEAMS, TeamsResponse.serializer())

    /** `GET /matches?status=scheduled,live&fields=…`. On failure the last stored list stays. */
    suspend fun refreshTodayMatches(): ApiResult<MatchListResponse> {
        val result = io { api.listMatches() }
        if (result is ApiResult.Ok) put(KEY_MATCHES, MatchListResponse.serializer(), result.value)
        return result
    }

    /** `GET /teams`, for the shirt-number picker. */
    suspend fun refreshTeams(): ApiResult<TeamsResponse> {
        val result = io { api.teams() }
        if (result is ApiResult.Ok) put(KEY_TEAMS, TeamsResponse.serializer(), result.value)
        return result
    }

    /**
     * Opens a match created in the web: `GET /matches/{id}?include=events`, stored as a server match
     * (no creation body: it already exists) with its events already sent. A match already on the
     * watch is not re-created; only its new events are added.
     */
    suspend fun openServerMatch(id: String): ApiResult<Unit> {
        val result = io { api.getMatchWithEvents(id) }
        if (result !is ApiResult.Ok) return result.map()
        val detail = result.value
        val m = detail.match
        if (dao.match(id) == null) {
            dao.insertMatch(
                MatchEntity(
                    id = m.id,
                    creationBody = null,
                    homeTeamName = m.homeTeamName,
                    awayTeamName = m.awayTeamName,
                    homeTeamId = m.homeTeamId,
                    awayTeamId = m.awayTeamId,
                    periods = m.periods,
                    periodMinutes = m.periodMinutes,
                    origin = Origin.SERVER,
                    createState = CreateState.CREATED,
                    createError = null,
                    createdAtMs = now(),
                    lastSeq = 0,
                    serverStateJson = null,
                    serverTime = null,
                    clockOffsetMs = null,
                ),
            )
        }
        store(id, detail.events, detail.state.lastSeq)
        return ApiResult.Ok(result.status, Unit)
    }

    /** What is new on the server since the last read: `GET /matches/{id}/events?since=<lastSeq>`. */
    suspend fun refreshEvents(id: String): ApiResult<Unit> {
        val match = dao.match(id) ?: return ApiResult.NetworkError("unknown_match")
        // Not on the server yet (or deleted there): nothing to read
        if (match.createState != CreateState.CREATED) return ApiResult.Ok(0, Unit)
        val result = io { api.eventsSince(id, match.lastSeq) }
        if (result !is ApiResult.Ok) return result.map()
        store(id, result.value.events, result.value.lastSeq)
        return ApiResult.Ok(result.status, Unit)
    }

    /** Server events are inserted as already sent; events this watch already has are left as they are. */
    private suspend fun store(matchId: String, events: List<StoredEventDto>, lastSeq: Long) {
        if (events.isNotEmpty()) dao.insertEvents(events.map { it.toEntity(matchId) })
        dao.raiseLastSeq(matchId, lastSeq)
    }

    private fun StoredEventDto.toEntity(matchId: String) = EventEntity(
        id = id,
        matchId = matchId,
        type = type,
        team = team,
        playerNumber = playerNumber,
        playerOutNumber = playerOutNumber,
        playerInNumber = playerInNumber,
        text = text,
        voidsEventId = voidsEventId,
        period = period,
        minutes = minutes,
        clientTimestamp = clientTimestamp,
        t = t,
        origin = Origin.SERVER,
        syncState = SyncState.SENT,
        rejectReason = null,
        queueOrder = 0,
        seq = seq,
    )

    private fun <T> observe(key: String, serializer: KSerializer<T>): Flow<Cached<T>?> =
        dao.observeCache(key).map { entry ->
            entry?.let { e -> runCatching { Cached(ApiJson.decodeFromString(serializer, e.json), e.updatedAtMs) }.getOrNull() }
        }

    private suspend fun <T> put(key: String, serializer: KSerializer<T>, value: T) {
        dao.putCache(CacheEntity(key, ApiJson.encodeToString(serializer, value), now()))
    }

    private suspend fun <T> io(block: () -> T): T = withContext(Dispatchers.IO) { block() }

    private fun ApiResult<*>.map(): ApiResult<Unit> = when (this) {
        is ApiResult.Ok -> ApiResult.Ok(status, Unit)
        is ApiResult.HttpError -> this
        is ApiResult.NetworkError -> this
    }

    companion object {
        const val KEY_MATCHES = "matches_today"
        const val KEY_TEAMS = "teams"

        /** The roster of one side of a match, when the match has a team with players. */
        fun roster(teams: List<TeamDto>, match: MatchEntity, side: TeamSide): List<RosterPlayer> {
            val teamId = if (side == TeamSide.HOME) match.homeTeamId else match.awayTeamId
            val team = teams.firstOrNull { it.id == teamId } ?: return emptyList()
            return team.players.sortedBy { it.number }.map { RosterPlayer(it.number, it.name) }
        }
    }
}
