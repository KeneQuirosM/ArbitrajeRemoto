package app.arbitrajeremoto.reloj.api

import kotlinx.serialization.Serializable

/** Body of `POST /matches`. Encoded once, stored, and resent byte for byte (guide §6). */
@Serializable
data class CreateMatchBody(
    val id: String,
    val deviceId: String,
    val homeTeamName: String? = null,
    val awayTeamName: String? = null,
    val periods: Int? = null,
    val periodMinutes: Int? = null,
)

@Serializable
data class MatchDto(
    val id: String,
    val homeTeamId: String? = null,
    val awayTeamId: String? = null,
    val homeTeamName: String,
    val awayTeamName: String,
    val scheduledAt: String? = null,
    val periods: Int = 2,
    val periodMinutes: Int = 45,
    val tournament: String? = null,
)

@Serializable
data class ScoreDto(val home: Int, val away: Int)

@Serializable
data class ClockDto(
    val period: Int? = null,
    val running: Boolean = false,
    val elapsedMs: Long = 0,
    val anchorAt: Long? = null,
    val addedMinutes: Int? = null,
)

@Serializable
data class DisciplineDto(
    val team: String,
    val playerNumber: Int,
    val yellow: Int,
    val red: Boolean,
    val secondYellow: Boolean,
)

/** `state` in responses (compact: no timeline). */
@Serializable
data class CompactStateDto(
    val status: String,
    val score: ScoreDto,
    val clock: ClockDto = ClockDto(),
    val discipline: List<DisciplineDto> = emptyList(),
    val lastSeq: Long = 0,
)

@Serializable
data class CreateMatchResponse(val match: MatchDto, val state: CompactStateDto, val duplicate: Boolean = false)

/** An event as the watch sends it. Null fields are left out of the JSON. */
@Serializable
data class EventDto(
    val id: String,
    val type: String,
    val clientTimestamp: String,
    val team: String? = null,
    val playerNumber: Int? = null,
    val playerOutNumber: Int? = null,
    val playerInNumber: Int? = null,
    val text: String? = null,
    val voidsEventId: String? = null,
    val period: Int? = null,
    val minutes: Int? = null,
)

@Serializable
data class EventBatchBody(val sentAt: String, val events: List<EventDto>)

@Serializable
data class EventResultDto(val id: String? = null, val status: String, val reason: String? = null)

@Serializable
data class EventBatchResponse(
    val results: List<EventResultDto>,
    val state: CompactStateDto,
    val clockOffsetMs: Long = 0,
    val serverTime: String,
)

/** An event as the server stores it (`seq` and the corrected time `t` added). */
@Serializable
data class StoredEventDto(
    val id: String,
    val type: String,
    val clientTimestamp: String,
    val team: String? = null,
    val playerNumber: Int? = null,
    val playerOutNumber: Int? = null,
    val playerInNumber: Int? = null,
    val text: String? = null,
    val voidsEventId: String? = null,
    val period: Int? = null,
    val minutes: Int? = null,
    val seq: Long,
    val t: Long,
    val clockOffsetMs: Long = 0,
)

@Serializable
data class MatchDetailResponse(
    val match: MatchDto,
    val state: CompactStateDto,
    val events: List<StoredEventDto> = emptyList(),
    val serverTime: String,
)

@Serializable
data class EventsSinceResponse(
    val events: List<StoredEventDto>,
    val lastSeq: Long,
    val state: CompactStateDto,
    val serverTime: String,
)

/** A row of `GET /matches?fields=…`: only `id` is always present. */
@Serializable
data class MatchSummaryDto(
    val id: String,
    val homeTeamName: String? = null,
    val awayTeamName: String? = null,
    val scheduledAt: String? = null,
    val status: String? = null,
    val score: ScoreDto? = null,
    val periods: Int? = null,
    val periodMinutes: Int? = null,
)

@Serializable
data class MatchListResponse(val matches: List<MatchSummaryDto>, val serverTime: String)

@Serializable
data class PlayerDto(val id: String? = null, val number: Int, val name: String? = null)

@Serializable
data class TeamDto(val id: String, val name: String, val players: List<PlayerDto> = emptyList())

@Serializable
data class TeamsResponse(val teams: List<TeamDto>)
