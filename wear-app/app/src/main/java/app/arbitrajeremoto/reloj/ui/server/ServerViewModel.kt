package app.arbitrajeremoto.reloj.ui.server

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.arbitrajeremoto.reloj.api.ApiResult
import app.arbitrajeremoto.reloj.api.MatchListResponse
import app.arbitrajeremoto.reloj.api.TeamsResponse
import app.arbitrajeremoto.reloj.container
import app.arbitrajeremoto.reloj.data.Cached
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** Activity-scoped: server lists (stored on the watch) and opening web matches. */
class ServerViewModel(app: Application) : AndroidViewModel(app) {
    private val container = app.container
    private val remote = container.remote

    val todayMatches: StateFlow<Cached<MatchListResponse>?> =
        remote.observeTodayMatches().stateIn(viewModelScope, SharingStarted.Eagerly, null)
    val teams: StateFlow<Cached<TeamsResponse>?> =
        remote.observeTeams().stateIn(viewModelScope, SharingStarted.Eagerly, null)

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    /** Last error code of a refresh/open, or null. */
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    fun refresh() {
        viewModelScope.launch {
            _busy.value = true
            container.prepareApi()
            remote.refreshTeams()
            _error.value = remote.refreshTodayMatches().errorCode()
            _busy.value = false
        }
    }

    /** Fetches the match with its events, stores it, then opens it. */
    fun open(id: String, onOpened: (String) -> Unit) {
        viewModelScope.launch {
            _busy.value = true
            container.prepareApi()
            val result = remote.openServerMatch(id)
            _busy.value = false
            _error.value = result.errorCode()
            if (result is ApiResult.Ok) onOpened(id)
        }
    }

    /** New events from the web while a match is open (`?since=lastSeq`). */
    suspend fun refreshEvents(id: String) {
        container.prepareApi()
        remote.refreshEvents(id)
    }

    private fun ApiResult<*>.errorCode(): String? = when (this) {
        is ApiResult.Ok -> null
        is ApiResult.HttpError -> code
        is ApiResult.NetworkError -> "NETWORK"
    }
}
