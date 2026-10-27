package app.arbitrajeremoto.reloj.ui.server

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.material3.CircularProgressIndicator
import androidx.wear.compose.material3.FilledTonalButton
import androidx.wear.compose.material3.Text
import app.arbitrajeremoto.reloj.R
import app.arbitrajeremoto.reloj.api.MatchListResponse
import app.arbitrajeremoto.reloj.api.MatchSummaryDto
import app.arbitrajeremoto.reloj.data.Cached
import app.arbitrajeremoto.reloj.domain.MatchStatus
import app.arbitrajeremoto.reloj.ui.components.BodyText
import app.arbitrajeremoto.reloj.ui.components.RelojList
import app.arbitrajeremoto.reloj.ui.components.ScreenTitle
import app.arbitrajeremoto.reloj.ui.components.WideButton
import app.arbitrajeremoto.reloj.ui.theme.RelojColors
import app.arbitrajeremoto.reloj.ui.theme.RelojType
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val HOUR = DateTimeFormatter.ofPattern("HH:mm")

/** Local "HH:mm" of an ISO instant, or null. */
fun localTime(iso: String?): String? = iso?.let {
    runCatching { HOUR.format(Instant.parse(it).atZone(ZoneId.systemDefault())) }.getOrNull()
}

/** Matches of the day from the server (the last list stored on the watch when offline). */
@Composable
fun ServerMatchesScreen(
    list: Cached<MatchListResponse>?,
    busy: Boolean,
    error: String?,
    onRefresh: () -> Unit,
    onOpen: (String) -> Unit,
) {
    RelojList {
        item { ScreenTitle(stringResource(R.string.server_matches_title)) }
        item { WideButton(stringResource(R.string.server_matches_refresh), onRefresh) }
        if (busy) item { CircularProgressIndicator(modifier = Modifier.size(24.dp)) }
        if (error != null) {
            item {
                val text = if (error == "NETWORK") stringResource(R.string.server_matches_offline) else stringResource(R.string.server_open_failed, error)
                BodyText(text, color = RelojColors.error)
            }
        }
        if (list == null) {
            item { BodyText(stringResource(R.string.server_matches_never), color = RelojColors.textMuted) }
        } else {
            item {
                val at = HOUR.format(Instant.ofEpochMilli(list.updatedAtMs).atZone(ZoneId.systemDefault()))
                BodyText(stringResource(R.string.server_matches_updated, at), color = RelojColors.textMuted)
            }
            if (list.value.matches.isEmpty()) {
                item { BodyText(stringResource(R.string.server_matches_empty), color = RelojColors.textMuted) }
            }
            items(list.value.matches, key = { it.id }) { m -> MatchRow(m, onOpen) }
        }
    }
}

@Composable
private fun MatchRow(m: MatchSummaryDto, onOpen: (String) -> Unit) {
    val title = stringResource(R.string.server_match_item, m.homeTeamName.orEmpty(), m.awayTeamName.orEmpty())
    val status = when (MatchStatus.fromWire(m.status)) {
        MatchStatus.LIVE -> stringResource(R.string.status_in_play)
        MatchStatus.HALFTIME -> stringResource(R.string.status_halftime)
        MatchStatus.FINISHED -> stringResource(R.string.status_finished)
        else -> stringResource(R.string.status_scheduled)
    }
    val detail = listOfNotNull(localTime(m.scheduledAt), m.score?.let { "${it.home} – ${it.away}" }, status).joinToString(" · ")
    FilledTonalButton(
        onClick = { onOpen(m.id) },
        modifier = Modifier.fillMaxWidth(),
        secondaryLabel = { Text(detail, fontSize = RelojType.caption) },
        label = { Text(title, fontSize = RelojType.label, maxLines = 2) },
    )
}
