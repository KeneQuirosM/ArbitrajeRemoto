package app.arbitrajeremoto.reloj.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.arbitrajeremoto.reloj.api.ServerConfig
import app.arbitrajeremoto.reloj.container
import app.arbitrajeremoto.reloj.data.AppSettings
import app.arbitrajeremoto.reloj.pairing.KeyStatus
import app.arbitrajeremoto.reloj.pairing.SessionCheck
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Where the app opens: pairing, or the home screen. */
sealed interface StartDestination {
    data object Loading : StartDestination
    data class Pair(val revoked: Boolean) : StartDestination
    data object Home : StartDestination
}

class MainViewModel(app: Application) : AndroidViewModel(app) {
    val container = app.container

    private val _start = MutableStateFlow<StartDestination>(StartDestination.Loading)
    val start: StateFlow<StartDestination> = _start.asStateFlow()

    val settings: StateFlow<AppSettings?> =
        container.settings.settings.stateIn(viewModelScope, SharingStarted.Eagerly, null)

    val online: StateFlow<Boolean> = container.network.online

    init {
        // A 401 during sync marks the key revoked: go back to pairing, keep everything else (guide §4.4)
        viewModelScope.launch {
            container.settings.settings.collect { s ->
                if (s.keyRevoked && _start.value == StartDestination.Home) _start.value = StartDestination.Pair(revoked = true)
            }
        }
        viewModelScope.launch {
            val hasKey = container.prepareApi()
            val s = container.settings.current()
            _start.value = if (!hasKey || s.keyRevoked) StartDestination.Pair(revoked = s.keyRevoked) else StartDestination.Home
            if (hasKey && !s.keyRevoked) checkKey()
        }
    }

    /** Guide §4.4: `GET /session` with the key; 401 → back to pairing, nothing else is deleted. */
    private suspend fun checkKey() {
        val status = withContext(Dispatchers.IO) { SessionCheck.evaluate(container.api.session()) }
        if (status == KeyStatus.REVOKED) {
            container.settings.setKeyRevoked(true)
            _start.value = StartDestination.Pair(revoked = true)
        } else {
            container.onKeyAvailable()
        }
    }

    fun onPaired() {
        _start.value = StartDestination.Home
    }

    fun pairAgain() {
        _start.value = StartDestination.Pair(revoked = false)
    }

    /** Settings → Server. Only accepted URLs are stored (HTTPS; http in debug). */
    fun setServerUrl(raw: String): Boolean {
        val url = ServerConfig.normalizeBaseUrl(raw, container.allowHttp) ?: return false
        viewModelScope.launch {
            val before = container.settings.current().serverUrl
            container.settings.setServerUrl(url)
            container.baseUrl = url
            if (before != url && container.settings.current().keyRevoked) _start.value = StartDestination.Pair(revoked = false)
        }
        return true
    }
}
