package app.arbitrajeremoto.reloj.ui.match

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import app.arbitrajeremoto.reloj.R
import app.arbitrajeremoto.reloj.data.MatchView
import app.arbitrajeremoto.reloj.domain.Clock
import app.arbitrajeremoto.reloj.domain.ClockAction
import app.arbitrajeremoto.reloj.domain.DerivedEvent
import app.arbitrajeremoto.reloj.domain.EventType
import app.arbitrajeremoto.reloj.domain.MatchStatus
import app.arbitrajeremoto.reloj.domain.TeamSide

fun eventName(type: EventType): Int = when (type) {
    EventType.GOAL -> R.string.ev_goal
    EventType.OWN_GOAL -> R.string.ev_own_goal
    EventType.YELLOW_CARD -> R.string.ev_yellow_card
    EventType.RED_CARD -> R.string.ev_red_card
    EventType.SUBSTITUTION -> R.string.ev_substitution
    EventType.NOTE -> R.string.ev_note
    EventType.PERIOD_START -> R.string.ev_period_start
    EventType.PERIOD_PAUSE -> R.string.ev_period_pause
    EventType.PERIOD_RESUME -> R.string.ev_period_resume
    EventType.PERIOD_END -> R.string.ev_period_end
    EventType.ADDED_TIME -> R.string.ev_added_time
    EventType.MATCH_END -> R.string.ev_match_end
    EventType.VOID -> R.string.ev_void
}

fun MatchView.teamName(side: TeamSide): String = if (side == TeamSide.HOME) match.homeTeamName else match.awayTeamName

@Composable
fun clockActionLabel(action: ClockAction): String = when (action) {
    is ClockAction.Start -> stringResource(R.string.clock_start, action.period)
    ClockAction.Pause -> stringResource(R.string.clock_pause)
    ClockAction.Resume -> stringResource(R.string.clock_resume)
    is ClockAction.EndPeriod -> stringResource(R.string.clock_end_period, action.period)
    ClockAction.EndMatch -> stringResource(R.string.clock_end_match)
}

/** "23′ · 22:14", "Paused · 45+2′", "Break", "Full time". */
@Composable
fun statusLine(view: MatchView, nowMs: Long): String {
    val state = view.state
    val clock = state.clock
    val elapsed = Clock.elapsedAt(clock, nowMs)
    val minute = clock.period?.let { Clock.minuteLabel(it, elapsed, view.match.periodMinutes) }
    return when (state.status) {
        MatchStatus.SCHEDULED -> stringResource(R.string.status_scheduled)
        MatchStatus.LIVE ->
            if (clock.running) stringResource(R.string.status_live, minute.orEmpty(), Clock.formatClock(elapsed))
            else stringResource(R.string.status_paused, minute.orEmpty())
        MatchStatus.HALFTIME -> stringResource(R.string.status_halftime)
        MatchStatus.FINISHED -> stringResource(R.string.status_finished)
    }
}

/** "¿Deshacer gol de Local, 9?" */
@Composable
fun undoQuestion(view: MatchView, target: DerivedEvent): String {
    val name = stringResource(eventName(target.type))
    val team = target.team
    val number = target.playerNumber ?: target.playerInNumber
    return when {
        team != null && number != null -> stringResource(R.string.undo_question_team_number, name, view.teamName(team), number)
        team != null -> stringResource(R.string.undo_question_team, name, view.teamName(team))
        else -> stringResource(R.string.undo_question, name)
    }
}

/** One line of the recent events list: "23′ goal Local 9". */
@Composable
fun eventLine(view: MatchView, e: DerivedEvent): String {
    val parts = mutableListOf<String>()
    e.minuteLabel?.let { parts += "$it′" }
    parts += stringResource(eventName(e.type))
    e.team?.let { parts += view.teamName(it) }
    when {
        e.type == EventType.SUBSTITUTION -> parts += "${e.playerOutNumber} → ${e.playerInNumber}"
        e.type == EventType.ADDED_TIME -> parts += "+${e.minutes}"
        e.playerNumber != null -> parts += e.playerNumber.toString()
    }
    return parts.joinToString(" ")
}
