package app.arbitrajeremoto.reloj.ui.home

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import app.arbitrajeremoto.reloj.R
import app.arbitrajeremoto.reloj.ui.components.RelojList
import app.arbitrajeremoto.reloj.ui.components.ScreenTitle
import app.arbitrajeremoto.reloj.ui.components.WideButton

@Composable
fun HomeScreen(onSettings: () -> Unit) {
    RelojList {
        item { ScreenTitle(stringResource(R.string.app_name)) }
        item { WideButton(stringResource(R.string.home_settings), onSettings) }
    }
}
