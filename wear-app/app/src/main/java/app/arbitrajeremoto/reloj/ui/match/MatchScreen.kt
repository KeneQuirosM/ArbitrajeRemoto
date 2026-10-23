package app.arbitrajeremoto.reloj.ui.match

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.Text
import app.arbitrajeremoto.reloj.R
import app.arbitrajeremoto.reloj.data.MatchView
import app.arbitrajeremoto.reloj.domain.ClockAction
import app.arbitrajeremoto.reloj.domain.ClockControls
import app.arbitrajeremoto.reloj.domain.MatchStatus
import app.arbitrajeremoto.reloj.domain.TeamSide
import app.arbitrajeremoto.reloj.ui.components.BigButton
import app.arbitrajeremoto.reloj.ui.components.BodyText
import app.arbitrajeremoto.reloj.ui.components.RelojList
import app.arbitrajeremoto.reloj.ui.theme.RelojColors
import app.arbitrajeremoto.reloj.ui.theme.RelojType
import kotlinx.coroutines.delay

/** Send status dot (guide §10): green = all sent, amber = N pending, grey = no network. */
data class SyncDot(val color: Color, val description: String)

/** Ticks once a second; the clock itself is always recomputed from the events. */
@Composable
fun rememberNow(): Long {
    val now = remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            now.longValue = System.currentTimeMillis()
            delay(1_000 - System.currentTimeMillis() % 1_000)
        }
    }
    return now.longValue
}

@Composable
fun MatchScreen(
    viewModel: MatchViewModel,
    matchId: String,
    syncDot: (MatchView) -> SyncDot?,
    onPick: (type: String, team: TeamSide) -> Unit,
    onMore: () -> Unit,
    onClockRare: () -> Unit,
    onUndo: () -> Unit,
) {
    val view by remember(matchId) { viewModel.observe(matchId) }.collectAsState(initial = null)
    val error by viewModel.lastError.collectAsState()
    val now = rememberNow()
    val current = view ?: return
    val state = current.state

    // While the match is being played the screen stays on (see wear-app/README.md, "Pantalla encendida")
    val live = state.status == MatchStatus.LIVE
    val hostView = LocalView.current
    DisposableEffect(live) {
        hostView.keepScreenOn = live
        onDispose { hostView.keepScreenOn = false }
    }

    RelojList {
        item { Scoreboard(current, now, syncDot(current)) }
        item { ClockButton(current, { viewModel.record(matchId, it.toDraft()) }, onClockRare) }
        for (side in TeamSide.entries) {
            item { TeamActions(current, side, onPick) }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                BigButton(
                    stringResource(R.string.action_more),
                    onMore,
                    Modifier.weight(1f),
                    container = RelojColors.surface,
                    content = RelojColors.textPrimary,
                )
                BigButton(
                    stringResource(R.string.action_undo),
                    onUndo,
                    Modifier.weight(1f),
                    container = RelojColors.surface,
                    content = RelojColors.textPrimary,
                )
            }
        }
        error?.let { reason -> item { BodyText(stringResource(R.string.recorded_rejected, reason), color = RelojColors.error) } }
        if (current.rejectedCount > 0) {
            item { BodyText(stringResource(R.string.rejected_count, current.rejectedCount), color = RelojColors.error) }
        }
        val sentOff = state.discipline.filter { it.red }
        if (sentOff.isNotEmpty()) {
            item {
                val secondYellow = stringResource(R.string.second_yellow_short)
                BodyText(
                    stringResource(
                        R.string.red_cards,
                        sentOff.joinToString(", ") { current.teamName(it.team) + " " + it.playerNumber + if (it.secondYellow) " ($secondYellow)" else "" },
                    ),
                    color = RelojColors.textMuted,
                )
            }
        }
        for (e in state.timeline.takeLast(RECENT_EVENTS).asReversed()) {
            item(key = e.id) { BodyText(eventLine(current, e), color = RelojColors.textMuted) }
        }
    }
}

private const val RECENT_EVENTS = 6

/** "Local 0 – 0 Visitante", the minute and the send status; read as one sentence by TalkBack. */
@Composable
private fun Scoreboard(view: MatchView, now: Long, dot: SyncDot?) {
    val status = statusLine(view, now)
    val score = view.state.score
    val spoken = stringResource(R.string.score_description, view.match.homeTeamName, score.home, view.match.awayTeamName, score.away, status) +
        (dot?.let { ". " + it.description } ?: "")
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .fillMaxWidth()
            .semantics(mergeDescendants = true) {
                contentDescription = spoken
                liveRegion = LiveRegionMode.Polite
            },
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            TeamName(view.match.homeTeamName, TextAlign.End, Modifier.weight(1f))
            Text(
                "${score.home} – ${score.away}",
                fontSize = RelojType.score,
                fontWeight = FontWeight.Bold,
                color = RelojColors.textPrimary,
                modifier = Modifier.padding(horizontal = 4.dp),
            )
            TeamName(view.match.awayTeamName, TextAlign.Start, Modifier.weight(1f))
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (dot != null) {
                Box(
                    Modifier
                        .padding(end = 4.dp)
                        .size(8.dp)
                        .background(dot.color, CircleShape),
                )
            }
            Text(status, fontSize = RelojType.label, color = RelojColors.textMuted)
        }
        view.state.clock.addedMinutes?.let {
            Text(stringResource(R.string.added_announced, it), fontSize = RelojType.caption, color = RelojColors.pending)
        }
    }
}

@Composable
private fun TeamName(name: String, align: TextAlign, modifier: Modifier) {
    Text(
        name,
        fontSize = RelojType.caption,
        color = RelojColors.textPrimary,
        textAlign = align,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = modifier,
    )
}

/** Start / Pause / Resume on tap; end of period and end of match behind a long press. */
@Composable
private fun ClockButton(view: MatchView, onClock: (ClockAction) -> Unit, onRare: () -> Unit) {
    val primary = ClockControls.primary(view.state, view.rules)
    val rare = ClockControls.rare(view.state)
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
        BigButton(
            label = primary?.let { clockActionLabel(it) } ?: stringResource(R.string.clock_finished),
            onClick = { primary?.let(onClock) },
            modifier = Modifier.fillMaxWidth(),
            container = RelojColors.primaryContainer,
            content = RelojColors.onPrimaryContainer,
            enabled = primary != null || rare.isNotEmpty(),
            onLongClick = if (rare.isNotEmpty()) onRare else null,
            longClickLabel = stringResource(R.string.clock_more_label),
            fontSize = RelojType.title,
        )
        if (rare.isNotEmpty()) {
            Text(stringResource(R.string.clock_more_hint), fontSize = RelojType.caption, color = RelojColors.textMuted, textAlign = TextAlign.Center)
        }
    }
}

/** Team name, then Goal / Yellow / Red: each opens the shirt-number picker. */
@Composable
private fun TeamActions(view: MatchView, side: TeamSide, onPick: (String, TeamSide) -> Unit) {
    val team = view.teamName(side)
    val teamColor = if (side == TeamSide.HOME) RelojColors.home else RelojColors.away
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
        Text(team, fontSize = RelojType.caption, color = RelojColors.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.fillMaxWidth()) {
            val goal = stringResource(R.string.action_goal)
            val yellow = stringResource(R.string.action_yellow)
            val red = stringResource(R.string.action_red)
            BigButton(goal, { onPick("goal", side) }, Modifier.weight(1f), teamColor, RelojColors.onTeam,
                description = stringResource(R.string.action_for_team, goal, team), fontSize = RelojType.caption)
            BigButton(yellow, { onPick("yellow_card", side) }, Modifier.weight(1f), RelojColors.yellow, RelojColors.onYellow,
                description = stringResource(R.string.action_for_team, yellow, team), fontSize = RelojType.caption)
            BigButton(red, { onPick("red_card", side) }, Modifier.weight(1f), RelojColors.red, RelojColors.onRed,
                description = stringResource(R.string.action_for_team, red, team), fontSize = RelojType.caption)
        }
    }
}
