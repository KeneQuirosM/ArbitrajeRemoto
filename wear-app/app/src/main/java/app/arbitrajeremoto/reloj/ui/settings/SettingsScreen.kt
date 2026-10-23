package app.arbitrajeremoto.reloj.ui.settings

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import app.arbitrajeremoto.reloj.BuildConfig
import app.arbitrajeremoto.reloj.R
import app.arbitrajeremoto.reloj.data.AppSettings
import app.arbitrajeremoto.reloj.ui.components.BodyText
import app.arbitrajeremoto.reloj.ui.components.RelojList
import app.arbitrajeremoto.reloj.ui.components.ScreenTitle
import app.arbitrajeremoto.reloj.ui.components.WideButton
import app.arbitrajeremoto.reloj.ui.theme.RelojColors

/** Local API addresses for debug builds (no typing on the watch). */
object DebugServers {
    /** `adb reverse tcp:8787 tcp:8787` makes the computer's API reachable at the watch's localhost. */
    const val ADB_REVERSE = "http://127.0.0.1:8787/api/v1"
    const val EMULATOR = "http://10.0.2.2:8787/api/v1"
}

/**
 * Server: the default (HTTPS) or, in debug, a local API. Any other URL is set without typing via
 * `adb shell am start … --es server_url <url>` (debug only, see README).
 */
@Composable
fun SettingsScreen(settings: AppSettings?, onServer: (String) -> Unit, onPairAgain: () -> Unit) {
    RelojList {
        item { ScreenTitle(stringResource(R.string.settings_title)) }
        item { BodyText(stringResource(R.string.settings_server)) }
        item { BodyText(settings?.serverUrl.orEmpty(), color = RelojColors.textMuted) }
        item { WideButton(stringResource(R.string.settings_server_default), { onServer(BuildConfig.DEFAULT_BASE_URL) }) }
        if (BuildConfig.ALLOW_HTTP) {
            item { WideButton(stringResource(R.string.settings_server_adb), { onServer(DebugServers.ADB_REVERSE) }, secondary = DebugServers.ADB_REVERSE) }
            item { WideButton(stringResource(R.string.settings_server_emulator), { onServer(DebugServers.EMULATOR) }, secondary = DebugServers.EMULATOR) }
            item { BodyText(stringResource(R.string.settings_server_adb_hint), color = RelojColors.textMuted) }
        }
        item { WideButton(stringResource(R.string.settings_pair_again), onPairAgain) }
        item { BodyText(stringResource(R.string.settings_device_id) + ": " + settings?.deviceId.orEmpty(), color = RelojColors.textMuted) }
        item { BodyText(stringResource(R.string.settings_version, BuildConfig.VERSION_NAME), color = RelojColors.textMuted) }
    }
}
