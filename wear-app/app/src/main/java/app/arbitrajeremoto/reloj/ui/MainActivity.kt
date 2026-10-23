package app.arbitrajeremoto.reloj.ui

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import app.arbitrajeremoto.reloj.BuildConfig
import app.arbitrajeremoto.reloj.ui.nav.RelojNavHost
import app.arbitrajeremoto.reloj.ui.theme.RelojTheme

class MainActivity : ComponentActivity() {
    private val viewModel: MainViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        applyDebugServerUrl(intent)
        setContent {
            RelojTheme {
                RelojNavHost(viewModel)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        applyDebugServerUrl(intent)
    }

    /**
     * Debug only: `adb shell am start -n app.arbitrajeremoto.reloj/.ui.MainActivity --es server_url <url>`
     * sets the server without typing. Ignored in release, where any app could send this intent.
     */
    private fun applyDebugServerUrl(intent: Intent?) {
        if (!BuildConfig.DEBUG) return
        val url = intent?.getStringExtra(EXTRA_SERVER_URL) ?: return
        viewModel.setServerUrl(url)
    }

    companion object {
        const val EXTRA_SERVER_URL = "server_url"
    }
}
