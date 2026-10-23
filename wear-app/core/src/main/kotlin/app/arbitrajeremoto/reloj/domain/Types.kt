package app.arbitrajeremoto.reloj.domain

// Kotlin port of core/types.ts (only what the watch needs). Wire names are the API's.

enum class TeamSide(val wire: String) {
    HOME("home"),
    AWAY("away");

    val opponent: TeamSide get() = if (this == HOME) AWAY else HOME

    companion object {
        fun fromWire(value: String?): TeamSide? = entries.firstOrNull { it.wire == value }
    }
}

enum class MatchStatus(val wire: String) {
    SCHEDULED("scheduled"),
    LIVE("live"),
    HALFTIME("halftime"),
    FINISHED("finished");

    companion object {
        fun fromWire(value: String?): MatchStatus? = entries.firstOrNull { it.wire == value }
    }
}

enum class EventType(val wire: String) {
    GOAL("goal"),
    OWN_GOAL("own_goal"),
    YELLOW_CARD("yellow_card"),
    RED_CARD("red_card"),
    SUBSTITUTION("substitution"),
    NOTE("note"),
    PERIOD_START("period_start"),
    PERIOD_PAUSE("period_pause"),
    PERIOD_RESUME("period_resume"),
    PERIOD_END("period_end"),
    ADDED_TIME("added_time"),
    MATCH_END("match_end"),
    VOID("void");

    companion object {
        fun fromWire(value: String?): EventType? = entries.firstOrNull { it.wire == value }
    }
}

/**
 * An event of the match log (StoredEvent in core/types.ts, without the server-only fields).
 * [t] is the effective time in epoch ms used for ordering and the clock.
 */
data class MatchEvent(
    val id: String,
    val type: EventType,
    val t: Long,
    val team: TeamSide? = null,
    val playerNumber: Int? = null,
    val playerOutNumber: Int? = null,
    val playerInNumber: Int? = null,
    val text: String? = null,
    val voidsEventId: String? = null,
    val period: Int? = null,
    val minutes: Int? = null,
    val seq: Long = 0,
)

data class MatchRules(val periods: Int, val periodMinutes: Int)

data class ClockState(
    /** Current period number, or null before kick-off. */
    val period: Int?,
    val running: Boolean,
    /** Played ms in the current period up to [anchorAt] (or in total if not running). */
    val elapsedMs: Long,
    /** Epoch ms when the clock was last started/resumed; null if not running. */
    val anchorAt: Long?,
    /** Announced added minutes for the current period, if any. */
    val addedMinutes: Int?,
)

data class PlayerDiscipline(
    val team: TeamSide,
    val playerNumber: Int,
    val yellow: Int,
    val red: Boolean,
    /** True when the red card came from a second yellow. */
    val secondYellow: Boolean,
)

data class DerivedEvent(
    val id: String,
    val type: EventType,
    val team: TeamSide?,
    val playerNumber: Int?,
    val playerOutNumber: Int?,
    val playerInNumber: Int?,
    val text: String?,
    val period: Int?,
    val minutes: Int?,
    val t: Long,
    /** Period the event happened in, derived from the clock (null before kick-off). */
    val atPeriod: Int?,
    /** Football minute label, e.g. "23", "45+2". Null before kick-off. */
    val minuteLabel: String?,
)

data class Warning(val eventId: String, val code: String)

data class Score(val home: Int, val away: Int)

data class MatchState(
    val status: MatchStatus,
    val score: Score,
    val clock: ClockState,
    val discipline: List<PlayerDiscipline>,
    /** Effective (non-voided, non-void) events in time order with derived minutes. */
    val timeline: List<DerivedEvent>,
    val voidedEventIds: List<String>,
    /** Events that were kept but ignored by the clock state machine. */
    val warnings: List<Warning>,
    val lastSeq: Long,
)
