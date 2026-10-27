package app.arbitrajeremoto.reloj.ui.match

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.arbitrajeremoto.reloj.container
import app.arbitrajeremoto.reloj.data.MatchView
import app.arbitrajeremoto.reloj.domain.EventDraft
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** Activity-scoped: shared by the match screen and its pickers. */
class MatchViewModel(app: Application) : AndroidViewModel(app) {
    private val container = app.container

    val matches: StateFlow<List<MatchView>> =
        container.matches.observeMatches().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    /** Last rejection by local validation (shown once on the match screen). */
    private val _lastError = MutableStateFlow<String?>(null)
    val lastError: StateFlow<String?> = _lastError.asStateFlow()

    private val views = mutableMapOf<String, StateFlow<MatchView?>>()

    /**
     * One shared state per match, kept 5 s after its last screen closes: going from the match to a
     * picker and back shows the data at once instead of an empty frame while the database is read.
     */
    fun match(matchId: String): StateFlow<MatchView?> = views.getOrPut(matchId) {
        container.matches.observeMatch(matchId).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
    }

    fun createQuickMatch(onCreated: (String) -> Unit) {
        viewModelScope.launch { onCreated(container.matches.createQuickMatch()) }
    }

    /** Stores the event first (it shows at once), vibrates, then asks for a send. */
    fun record(matchId: String, draft: EventDraft) {
        viewModelScope.launch {
            container.matches.record(matchId, draft)
                .onSuccess {
                    _lastError.value = null
                    container.haptics.confirm()
                    container.onLocalChange()
                }
                .onFailure { _lastError.value = it.message }
        }
    }

    fun clearError() {
        _lastError.value = null
    }
}
