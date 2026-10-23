package app.arbitrajeremoto.reloj.ui.pairing

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.arbitrajeremoto.reloj.api.ApiResult
import app.arbitrajeremoto.reloj.api.PairingPollResponse
import app.arbitrajeremoto.reloj.api.PairingRequestResponse
import app.arbitrajeremoto.reloj.container
import app.arbitrajeremoto.reloj.pairing.PairingApi
import app.arbitrajeremoto.reloj.pairing.PairingController
import app.arbitrajeremoto.reloj.pairing.PairingState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class PairingViewModel(app: Application) : AndroidViewModel(app) {
    private val container = app.container
    private val _state = MutableStateFlow<PairingState>(PairingState.Requesting())
    val state: StateFlow<PairingState> = _state.asStateFlow()
    private var job: Job? = null

    private val api = object : PairingApi {
        override suspend fun request(deviceId: String, deviceName: String?): ApiResult<PairingRequestResponse> =
            withContext(Dispatchers.IO) { container.api.requestPairing(deviceId, deviceName) }

        override suspend fun poll(code: String, pollToken: String): ApiResult<PairingPollResponse> =
            withContext(Dispatchers.IO) { container.api.pollPairing(code, pollToken) }
    }

    init {
        start()
    }

    /** First code, or "Ask for another code". */
    fun start() {
        job?.cancel()
        job = viewModelScope.launch {
            container.prepareApi()
            val controller = PairingController(
                api = api,
                deviceId = container.settings.deviceId(),
                deviceName = container.deviceName,
                saveKey = { container.deviceKeys.save(it) },
                now = System::currentTimeMillis,
            )
            launch { controller.state.collect { _state.value = it } }
            controller.run()
            container.onPaired(_state.value)
        }
    }
}
