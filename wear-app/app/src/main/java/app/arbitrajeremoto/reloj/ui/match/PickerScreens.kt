package app.arbitrajeremoto.reloj.ui.match

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.FilledTonalButton
import androidx.wear.compose.material3.Text
import app.arbitrajeremoto.reloj.R
import app.arbitrajeremoto.reloj.data.MatchView
import app.arbitrajeremoto.reloj.domain.ClockAction
import app.arbitrajeremoto.reloj.domain.ClockControls
import app.arbitrajeremoto.reloj.domain.Undo
import app.arbitrajeremoto.reloj.domain.Validate
import app.arbitrajeremoto.reloj.ui.components.BodyText
import app.arbitrajeremoto.reloj.ui.components.RelojList
import app.arbitrajeremoto.reloj.ui.components.ScreenTitle
import app.arbitrajeremoto.reloj.ui.components.WideButton
import app.arbitrajeremoto.reloj.ui.theme.RelojColors
import app.arbitrajeremoto.reloj.ui.theme.RelojType

/** A shirt number of a team's roster (block R4), with the player's name when known. */
data class RosterPlayer(val number: Int, val name: String?)

/**
 * Shirt-number picker without a keyboard: a list turned with the crown/bezel or by swiping.
 * Roster players first (with names), then "No number" (when allowed) and 1–99.
 */
@Composable
fun NumberPickerScreen(
    title: String,
    roster: List<RosterPlayer>,
    allowNone: Boolean,
    exclude: Int? = null,
    onPick: (Int?) -> Unit,
) {
    val numbers = remember(exclude) { (Validate.MIN_PLAYER_NUMBER..Validate.MAX_PLAYER_NUMBER).filter { it != exclude } }
    val players = remember(roster, exclude) { roster.filter { it.number != exclude } }
    RelojList {
        item { ScreenTitle(title) }
        items(players, key = { "p${it.number}" }) { p ->
            val label = if (p.name.isNullOrBlank()) p.number.toString() else stringResource(R.string.picker_player, p.number, p.name)
            Button(
                onClick = { onPick(p.number) },
                modifier = Modifier.fillMaxWidth(),
                label = { Text(label, fontSize = RelojType.title, maxLines = 1) },
            )
        }
        if (allowNone) {
            item(key = "none") {
                FilledTonalButton(
                    onClick = { onPick(null) },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text(stringResource(R.string.picker_no_number), fontSize = RelojType.title) },
                )
            }
        }
        items(numbers, key = { "n$it" }) { n ->
            val spoken = stringResource(R.string.picker_number, n)
            FilledTonalButton(
                onClick = { onPick(n) },
                modifier = Modifier
                    .fillMaxWidth()
                    .semantics { contentDescription = spoken },
                label = { Text(n.toString(), fontSize = RelojType.title) },
            )
        }
    }
}

/** Own goal and substitution for each team, and the announced added time. */
@Composable
fun MoreScreen(
    view: MatchView,
    onOwnGoal: (app.arbitrajeremoto.reloj.domain.TeamSide) -> Unit,
    onSubstitution: (app.arbitrajeremoto.reloj.domain.TeamSide) -> Unit,
    onAddedTime: () -> Unit,
) {
    RelojList {
        item { ScreenTitle(stringResource(R.string.more_title)) }
        for (side in app.arbitrajeremoto.reloj.domain.TeamSide.entries) {
            item { WideButton(stringResource(R.string.more_own_goal, view.teamName(side)), { onOwnGoal(side) }) }
        }
        for (side in app.arbitrajeremoto.reloj.domain.TeamSide.entries) {
            item { WideButton(stringResource(R.string.more_substitution, view.teamName(side)), { onSubstitution(side) }) }
        }
        if (view.state.clock.period != null) {
            item { WideButton(stringResource(R.string.more_added_time), onAddedTime) }
        }
    }
}

/** 0–30 announced minutes. */
@Composable
fun AddedTimeScreen(onPick: (Int) -> Unit) {
    RelojList {
        item { ScreenTitle(stringResource(R.string.added_title)) }
        items((0..Validate.MAX_ADDED_MINUTES).toList(), key = { it }) { m ->
            FilledTonalButton(
                onClick = { onPick(m) },
                modifier = Modifier.fillMaxWidth(),
                label = { Text(stringResource(R.string.added_minutes, m), fontSize = RelojType.title) },
            )
        }
    }
}

/** The rare clock actions (long press on the clock button): end of period, end of match. */
@Composable
fun ClockRareScreen(view: MatchView, onAction: (ClockAction) -> Unit, onCancel: () -> Unit) {
    val actions = ClockControls.rare(view.state)
    RelojList {
        item { ScreenTitle(stringResource(R.string.clock_rare_title)) }
        for (action in actions) {
            item {
                Button(
                    onClick = { onAction(action) },
                    modifier = Modifier.fillMaxWidth(),
                    colors = if (action == ClockAction.EndMatch) {
                        ButtonDefaults.buttonColors(containerColor = RelojColors.red, contentColor = RelojColors.onRed)
                    } else {
                        ButtonDefaults.buttonColors()
                    },
                    label = { Text(clockActionLabel(action), fontSize = RelojType.label) },
                )
            }
        }
        item { WideButton(stringResource(R.string.action_cancel), onCancel) }
    }
}

/** Shows what will be undone ("Undo goal of Local, 9?") and creates a `void` for it. */
@Composable
fun UndoScreen(view: MatchView, onUndo: (String) -> Unit, onCancel: () -> Unit) {
    val target = Undo.target(view.state)
    RelojList {
        item { ScreenTitle(stringResource(R.string.undo_title)) }
        if (target == null) {
            item { BodyText(stringResource(R.string.undo_nothing)) }
            item { WideButton(stringResource(R.string.action_cancel), onCancel) }
        } else {
            item { BodyText(undoQuestion(view, target)) }
            item {
                Button(
                    onClick = { onUndo(target.id) },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = RelojColors.red, contentColor = RelojColors.onRed),
                    label = { Text(stringResource(R.string.action_undo), fontSize = RelojType.label) },
                )
            }
            item { WideButton(stringResource(R.string.action_cancel), onCancel) }
        }
    }
}

/** Loads a match for a sub-screen; shows nothing until it is read from the database. */
@Composable
fun WithMatch(viewModel: MatchViewModel, matchId: String, content: @Composable (MatchView) -> Unit) {
    val view by remember(matchId) { viewModel.observe(matchId) }.collectAsState(initial = null)
    view?.let { content(it) }
}
