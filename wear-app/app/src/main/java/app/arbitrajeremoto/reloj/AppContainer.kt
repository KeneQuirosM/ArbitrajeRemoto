package app.arbitrajeremoto.reloj

import android.content.Context
import android.os.Build
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStore
import app.arbitrajeremoto.reloj.api.ApiClient
import app.arbitrajeremoto.reloj.api.UrlConnectionTransport
import app.arbitrajeremoto.reloj.data.DeviceKeyRepository
import app.arbitrajeremoto.reloj.data.SettingsRepository
import app.arbitrajeremoto.reloj.security.AesGcmCipher
import app.arbitrajeremoto.reloj.security.AndroidKeystoreKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

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

    val deviceName: String = Build.MODEL.orEmpty().take(40).ifBlank { "Wear OS" }

    val allowHttp: Boolean = BuildConfig.ALLOW_HTTP

    /** Hook for work that must start once a key is stored (sync, data refresh). */
    fun onPaired(state: app.arbitrajeremoto.reloj.pairing.PairingState) {
        if (state is app.arbitrajeremoto.reloj.pairing.PairingState.Paired) onKeyAvailable()
    }

    /** Overridden by later blocks (sync); nothing to do yet. */
    fun onKeyAvailable() {}

    /** Loads the base URL and the key before any API call (the settings flow may not have emitted yet). */
    suspend fun prepareApi(): Boolean {
        baseUrl = settings.current().serverUrl
        return deviceKeys.current() != null
    }
}
