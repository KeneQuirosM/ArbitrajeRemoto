package app.arbitrajeremoto.reloj.ui.home

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.material3.FilledTonalButton
import androidx.wear.compose.material3.Text
import app.arbitrajeremoto.reloj.R
import app.arbitrajeremoto.reloj.data.MatchView
import app.arbitrajeremoto.reloj.ui.components.BodyText
import app.arbitrajeremoto.reloj.ui.components.RelojList
import app.arbitrajeremoto.reloj.ui.components.ScreenTitle
import app.arbitrajeremoto.reloj.ui.components.WideButton
import app.arbitrajeremoto.reloj.ui.match.statusLine
import app.arbitrajeremoto.reloj.ui.theme.RelojColors
import app.arbitrajeremoto.reloj.ui.theme.RelojType

/** "Quick match", then the matches stored on the watch (newest first). */
@Composable
fun HomeScreen(
    matches: List<MatchView>,
    now: Long,
    onQuickMatch: () -> Unit,
    onOpenMatch: (String) -> Unit,
    onSettings: () -> Unit,
    extraItems: androidx.wear.compose.foundation.lazy.ScalingLazyListScope.() -> Unit = {},
) {
    RelojList {
        item { ScreenTitle(stringResource(R.string.app_name)) }
        item { WideButton(stringResource(R.string.home_quick_match), onQuickMatch, primary = true) }
        extraItems()
        item { BodyText(stringResource(R.string.home_local_matches), color = RelojColors.textMuted) }
        if (matches.isEmpty()) {
            item { BodyText(stringResource(R.string.home_no_matches), color = RelojColors.textMuted) }
        }
        items(matches, key = { it.match.id }) { view ->
            val score = view.state.score
            FilledTonalButton(
                onClick = { onOpenMatch(view.match.id) },
                modifier = Modifier.fillMaxWidth(),
                secondaryLabel = { Text(statusLine(view, now), fontSize = RelojType.caption) },
                label = {
                    Text(
                        stringResource(R.string.home_match_item, view.match.homeTeamName, score.home, score.away, view.match.awayTeamName),
                        fontSize = RelojType.label,
                        maxLines = 2,
                    )
                },
            )
        }
        item { WideButton(stringResource(R.string.home_settings), onSettings) }
    }
}
