package app.arbitrajeremoto.reloj.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import app.arbitrajeremoto.reloj.pairing.DeviceCredentials
import app.arbitrajeremoto.reloj.security.SecretCipher
import kotlinx.coroutines.flow.first
import java.security.GeneralSecurityException
import java.util.Base64

/**
 * The deviceKey, encrypted with [SecretCipher] (AES/GCM, Android Keystore key) and stored in DataStore.
 * It is never logged or shown. The decrypted value is kept in memory only, for the HTTP client.
 */
class DeviceKeyRepository(private val store: DataStore<Preferences>, private val cipher: SecretCipher) {

    @Volatile
    private var cached: String? = null

    @Volatile
    private var loaded = false

    /** Last loaded key, without suspending (for the HTTP client). Call [current] first. */
    fun cachedKey(): String? = cached

    suspend fun current(): String? {
        if (loaded) return cached
        val blob = store.data.first()[ENCRYPTED_KEY]
        cached = blob?.let { decryptOrNull(it) }
        loaded = true
        return cached
    }

    /** Stores the new key and clears the "revoked" mark in one write. */
    suspend fun save(credentials: DeviceCredentials) {
        val blob = Base64.getEncoder().encodeToString(cipher.encrypt(credentials.deviceKey.toByteArray(Charsets.UTF_8)))
        store.edit { p ->
            p[ENCRYPTED_KEY] = blob
            val keyId = credentials.keyId
            val name = credentials.deviceName
            if (keyId != null) p[KEY_ID] = keyId else p.remove(KEY_ID)
            if (name != null) p[DEVICE_NAME] = name else p.remove(DEVICE_NAME)
            p[SettingsRepository.KEY_REVOKED] = false
        }
        cached = credentials.deviceKey
        loaded = true
    }

    private fun decryptOrNull(blob: String): String? = try {
        String(cipher.decrypt(Base64.getDecoder().decode(blob)), Charsets.UTF_8)
    } catch (e: GeneralSecurityException) {
        // Keystore key lost (e.g. data restored on another watch) or data altered: pair again.
        null
    } catch (e: IllegalArgumentException) {
        null
    }

    companion object {
        val ENCRYPTED_KEY = stringPreferencesKey("device_key_enc")
        val KEY_ID = stringPreferencesKey("device_key_id")
        val DEVICE_NAME = stringPreferencesKey("device_name")
    }
}
