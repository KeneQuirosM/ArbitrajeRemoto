package app.arbitrajeremoto.reloj.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import app.arbitrajeremoto.reloj.api.ServerConfig
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

data class AppSettings(
    val serverUrl: String,
    val deviceId: String?,
    /** An encrypted deviceKey is stored. */
    val hasKey: Boolean,
    /** The server answered 401 to the stored key (guide §4.4): pair again, keep the queue. */
    val keyRevoked: Boolean,
    val deviceName: String?,
) {
    val needsPairing: Boolean get() = !hasKey || keyRevoked
}

/** Plain settings in the same DataStore file as the encrypted key (excluded from backups). */
class SettingsRepository(private val store: DataStore<Preferences>, private val defaultUrl: String) {

    val settings: Flow<AppSettings> = store.data.map { p ->
        AppSettings(
            serverUrl = p[SERVER_URL] ?: defaultUrl,
            deviceId = p[DEVICE_ID],
            hasKey = p[DeviceKeyRepository.ENCRYPTED_KEY] != null,
            keyRevoked = p[KEY_REVOKED] ?: false,
            deviceName = p[DeviceKeyRepository.DEVICE_NAME],
        )
    }

    suspend fun current(): AppSettings = settings.first()

    /** `watch-<uuid>`, generated once and kept forever (guide §3: re-pairing the same id revokes old keys). */
    suspend fun deviceId(): String {
        store.data.first()[DEVICE_ID]?.let { return it }
        var id: String? = null
        store.edit { p ->
            id = p[DEVICE_ID] ?: ServerConfig.newDeviceId().also { p[DEVICE_ID] = it }
        }
        return id!!
    }

    /** Changing the server needs a new pairing (the key belongs to the old one); nothing else is deleted. */
    suspend fun setServerUrl(url: String) {
        store.edit { p ->
            val previous = p[SERVER_URL] ?: defaultUrl
            if (previous != url) {
                p[SERVER_URL] = url
                if (p[DeviceKeyRepository.ENCRYPTED_KEY] != null) p[KEY_REVOKED] = true
            }
        }
    }

    suspend fun setKeyRevoked(revoked: Boolean) {
        store.edit { it[KEY_REVOKED] = revoked }
    }

    companion object {
        val SERVER_URL = stringPreferencesKey("server_url")
        val DEVICE_ID = stringPreferencesKey("device_id")
        val KEY_REVOKED = booleanPreferencesKey("key_revoked")
    }
}
