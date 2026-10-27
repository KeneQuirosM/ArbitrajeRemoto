package app.arbitrajeremoto.reloj.domain

import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/** Clock button actions, derived from the state (never from stored seconds). */
sealed interface ClockAction {
    data class Start(val period: Int) : ClockAction
    data object Pause : ClockAction
    data object Resume : ClockAction
    data class EndPeriod(val period: Int) : ClockAction
    data object EndMatch : ClockAction

    fun toDraft(): EventDraft = when (this) {
        is Start -> EventDraft(EventType.PERIOD_START, period = period)
        Pause -> EventDraft(EventType.PERIOD_PAUSE)
        Resume -> EventDraft(EventType.PERIOD_RESUME)
        is EndPeriod -> EventDraft(EventType.PERIOD_END, period = period)
        EndMatch -> EventDraft(EventType.MATCH_END)
    }
}

object ClockControls {
    /** The big button: Start / Pause / Resume / start of the next period; nothing once finished. */
    fun primary(state: MatchState, rules: MatchRules): ClockAction? = when (state.status) {
        MatchStatus.SCHEDULED -> ClockAction.Start(1)
        MatchStatus.LIVE -> if (state.clock.running) ClockAction.Pause else ClockAction.Resume
        MatchStatus.HALFTIME -> state.clock.period?.let { if (it < rules.periods) ClockAction.Start(it + 1) else null }
        MatchStatus.FINISHED -> null
    }

    /** Rare actions, behind a long press: end of the period, end of the match (also to abandon it). */
    fun rare(state: MatchState): List<ClockAction> = when (state.status) {
        MatchStatus.LIVE -> listOfNotNull(state.clock.period?.let { ClockAction.EndPeriod(it) }, ClockAction.EndMatch)
        MatchStatus.SCHEDULED, MatchStatus.HALFTIME -> listOf(ClockAction.EndMatch)
        MatchStatus.FINISHED -> emptyList()
    }
}

object Undo {
    /** What "Undo" would void: the last effective event, if any (a `void` can never be undone). */
    fun target(state: MatchState): DerivedEvent? = state.timeline.lastOrNull()
}

/**
 * Event timestamps of this watch: `t = max(now, last_t + 1 ms)` (guide §7.1), so a double tap never
 * gives two events the same millisecond. [seed] with the latest stored local `t` after a restart.
 */
class EventClock(private val now: () -> Long = System::currentTimeMillis) {
    private var last = Long.MIN_VALUE

    @Synchronized
    fun seed(lastT: Long) {
        last = maxOf(last, lastT)
    }

    @Synchronized
    fun next(): Long {
        val t = if (last == Long.MIN_VALUE) now() else maxOf(now(), last + 1)
        last = t
        return t
    }

    companion object {
        private val ISO = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

        /** UTC ISO 8601 with milliseconds, e.g. `2026-10-25T16:00:02.000Z`. */
        fun iso(epochMs: Long): String = ISO.format(Instant.ofEpochMilli(epochMs))
    }
}
