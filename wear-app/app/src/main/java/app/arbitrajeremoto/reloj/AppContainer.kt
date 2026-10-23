package app.arbitrajeremoto.reloj

import android.content.Context
import android.os.Build
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStore
import app.arbitrajeremoto.reloj.api.ApiClient
import app.arbitrajeremoto.reloj.api.UrlConnectionTransport
import app.arbitrajeremoto.reloj.data.DeviceKeyRepository
import app.arbitrajeremoto.reloj.data.MatchRepository
import app.arbitrajeremoto.reloj.data.db.RelojDatabase
import app.arbitrajeremoto.reloj.domain.EventClock
import app.arbitrajeremoto.reloj.ui.Haptics
import app.arbitrajeremoto.reloj.data.SettingsRepository
import app.arbitrajeremoto.reloj.security.AesGcmCipher
import app.arbitrajeremoto.reloj.security.AndroidKeystoreKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import app.arbitrajeremoto.reloj.api.EventBatchBody
import app.arbitrajeremoto.reloj.pairing.PairingState
import app.arbitrajeremoto.reloj.sync.NetworkMonitor
import app.arbitrajeremoto.reloj.sync.NextStep
import app.arbitrajeremoto.reloj.sync.RoomSyncStore
import app.arbitrajeremoto.reloj.sync.SyncApi
import app.arbitrajeremoto.reloj.sync.SyncEngine
import app.arbitrajeremoto.reloj.sync.SyncPolicy
import app.arbitrajeremoto.reloj.sync.SyncScheduler

/** Single DataStore file: settings, deviceId and the encrypted key. Excluded from backups (res/xml). */
private val Context.relojDataStore: DataStore<Preferences> by preferencesDataStore(name = "reloj_prefs")

/** Manual dependency wiring: one instance per process, created by [RelojApp]. */
class AppContainer(context: Context) {
    val appContext: Context = context.applicationContext
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private val dataStore = appContext.relojDataStore
    val settings = SettingsRepository(dataStore, BuildConfig.DEFAULT_BASE_URL)
    val deviceKeys = DeviceKeyRepository(dataStore, AesGcmCipher { AndroidKeystoreKey.getOrCreate() })

    /** Base URL read on every call, kept in memory and updated by the settings flow. */
    @Volatile
    var baseUrl: String = BuildConfig.DEFAULT_BASE_URL

    val api = ApiClient({ baseUrl }, UrlConnectionTransport(), { deviceKeys.cachedKey() })

    val database: RelojDatabase = RelojDatabase.builder(appContext).build()
    val eventClock = EventClock()
    val matches = MatchRepository(database.dao(), eventClock, deviceId = { settings.deviceId() })
    val haptics = Haptics(appContext)

    val deviceName: String = Build.MODEL.orEmpty().take(40).ifBlank { "Wear OS" }

    val allowHttp: Boolean = BuildConfig.ALLOW_HTTP

    // --- Sync (guide §7.3, §7.4)

    private val syncApi = object : SyncApi {
        override suspend fun createMatch(rawBody: String) = withContext(Dispatchers.IO) { api.createMatch(rawBody) }
        override suspend fun postEvents(matchId: String, body: EventBatchBody) = withContext(Dispatchers.IO) { api.postEvents(matchId, body) }
    }
    val syncEngine = SyncEngine(RoomSyncStore(database.dao()), syncApi)
    private val scheduler = SyncScheduler(appContext)
    val network = NetworkMonitor(appContext) { syncSoon() }

    @Volatile
    private var syncAttempt = 0

    fun onPaired(state: PairingState) {
        if (state is PairingState.Paired) onKeyAvailable()
    }

    fun onKeyAvailable() = syncSoon()

    /** A local event or match was stored: send it now if there is network, else when it returns. */
    fun onLocalChange() = syncSoon()

    fun syncSoon() {
        appScope.launch {
            if (network.online.value) syncAndReschedule() else scheduler.schedule(0)
        }
    }

    /** One pass, then the next run: backoff 5 s … 5 min, Retry-After, or nothing. */
    suspend fun syncAndReschedule() {
        if (!prepareApi() || settings.current().keyRevoked) return
        when (val step = SyncPolicy.next(syncEngine.syncOnce(), syncAttempt)) {
            NextStep.Idle -> syncAttempt = 0
            is NextStep.RunIn -> {
                syncAttempt = step.attempt
                scheduler.schedule(step.delayMs)
            }
            // 401: back to pairing; the queue stays and is sent with the new key (guide §4.4)
            NextStep.Unpaired -> settings.setKeyRevoked(true)
        }
    }

    /** Loads the base URL and the key before any API call (the settings flow may not have emitted yet). */
    suspend fun prepareApi(): Boolean {
        baseUrl = settings.current().serverUrl
        return deviceKeys.current() != null
    }
}
