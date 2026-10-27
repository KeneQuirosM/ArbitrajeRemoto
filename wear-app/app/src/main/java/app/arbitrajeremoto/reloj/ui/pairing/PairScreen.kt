package app.arbitrajeremoto.reloj.ui.pairing

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.wear.compose.material3.CircularProgressIndicator
import androidx.wear.compose.material3.Text
import app.arbitrajeremoto.reloj.R
import app.arbitrajeremoto.reloj.pairing.PairingController
import app.arbitrajeremoto.reloj.pairing.PairingState
import app.arbitrajeremoto.reloj.ui.components.BodyText
import app.arbitrajeremoto.reloj.ui.components.RelojList
import app.arbitrajeremoto.reloj.ui.components.ScreenTitle
import app.arbitrajeremoto.reloj.ui.components.WideButton
import app.arbitrajeremoto.reloj.ui.theme.RelojColors
import app.arbitrajeremoto.reloj.ui.theme.RelojType
import kotlinx.coroutines.delay

/**
 * Guide §4: the code is shown here and typed in the web (Settings → Watches).
 * [revoked] adds the "watch unpaired" message after a 401 (guide §4.4).
 */
@Composable
fun PairScreen(revoked: Boolean, onPaired: () -> Unit, viewModel: PairingViewModel = viewModel()) {
    val state by viewModel.state.collectAsState()
    val now = remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            now.longValue = System.currentTimeMillis()
            delay(1_000)
        }
    }
    LaunchedEffect(state) {
        if (state is PairingState.Paired) {
            delay(1_500)
            onPaired()
        }
    }

    RelojList {
        item { ScreenTitle(stringResource(R.string.pair_title)) }
        if (revoked && state !is PairingState.Paired) {
            item { BodyText(stringResource(R.string.pair_revoked), color = RelojColors.pending) }
        }
        when (val s = state) {
            is PairingState.ShowingCode -> {
                item { CodeView(s.code) }
                item {
                    BodyText(
                        stringResource(R.string.pair_expires_in, PairingController.formatRemaining(s.expiresAtMs, now.longValue)),
                        color = RelojColors.textMuted,
                    )
                }
                item { BodyText(stringResource(R.string.pair_instructions)) }
                item { Status(stringResource(if (s.networkProblem) R.string.pair_no_network else R.string.pair_waiting), busy = true) }
            }
            is PairingState.Requesting ->
                item { Status(stringResource(if (s.networkProblem) R.string.pair_no_network else R.string.pair_requesting), busy = true) }
            PairingState.Saving -> item { Status(stringResource(R.string.pair_saving), busy = true) }
            is PairingState.Paired -> {
                item { Status(stringResource(R.string.pair_done), busy = false, color = RelojColors.synced) }
                item { WideButton(stringResource(R.string.pair_continue), onPaired, primary = true) }
            }
            is PairingState.RateLimited -> item {
                Status(
                    stringResource(R.string.pair_rate_limited, PairingController.formatRemaining(s.retryAtMs, now.longValue)),
                    busy = true,
                )
            }
            PairingState.Expired -> failure(R.string.pair_expired, viewModel)
            PairingState.CodeUsed -> failure(R.string.pair_used, viewModel)
            PairingState.CodeUnknown -> failure(R.string.pair_unknown, viewModel)
            is PairingState.Failed -> {
                item { Status(stringResource(R.string.pair_failed, s.code), busy = false, color = RelojColors.error) }
                item { WideButton(stringResource(R.string.pair_new_code), viewModel::start, primary = true) }
            }
        }
    }
}

private fun androidx.wear.compose.foundation.lazy.ScalingLazyListScope.failure(text: Int, viewModel: PairingViewModel) {
    item { Status(stringResource(text), busy = false, color = RelojColors.error) }
    item { WideButton(stringResource(R.string.pair_new_code), viewModel::start, primary = true) }
}

/** The code, large, in two groups. TalkBack reads it letter by letter. */
@Composable
private fun CodeView(code: String) {
    val spoken = stringResource(R.string.pair_code_description, code.toCharArray().joinToString(" "))
    Text(
        PairingController.formatCode(code),
        fontSize = RelojType.code,
        fontFamily = FontFamily.Monospace,
        fontWeight = FontWeight.Bold,
        textAlign = TextAlign.Center,
        color = RelojColors.textPrimary,
        modifier = Modifier
            .fillMaxWidth()
            .semantics { contentDescription = spoken },
    )
}

@Composable
private fun Status(text: String, busy: Boolean, color: androidx.compose.ui.graphics.Color = RelojColors.textMuted) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp)
            .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
    ) {
        if (busy) CircularProgressIndicator(modifier = Modifier.size(24.dp))
        Text(text, textAlign = TextAlign.Center, fontSize = RelojType.label, color = color, modifier = Modifier.padding(top = 4.dp))
    }
}
