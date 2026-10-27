package app.arbitrajeremoto.reloj.data

import app.arbitrajeremoto.reloj.pairing.DeviceCredentials
import app.arbitrajeremoto.reloj.security.AesGcmCipher
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/**
 * The real [AesGcmCipher] with a software AES-256 key: the Android Keystore itself only exists on a
 * device (its part is "por verificar" in wear-app/docs/PRUEBAS.md).
 */
class DeviceKeyRepositoryTest {
    private val aesKey: SecretKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    private val cipher = AesGcmCipher { aesKey }
    private val deviceKey = "ark1_0123456789abcdef_c2VjcmV0LXNlY3JldC1zZWNyZXQ"

    @Test
    fun `stores the key encrypted and reads it back`() = runBlocking {
        val store = FakeDataStore()
        DeviceKeyRepository(store, cipher).save(DeviceCredentials(deviceKey, "0123456789abcdef", "Galaxy Watch 4"))

        val stored = store.state.value[DeviceKeyRepository.ENCRYPTED_KEY]!!
        assertFalse(stored.contains("ark1"))
        assertFalse(String(Base64.getDecoder().decode(stored), Charsets.ISO_8859_1).contains("ark1"))
        // A fresh repository (app restart) decrypts it
        assertEquals(deviceKey, DeviceKeyRepository(store, cipher).current())
        assertEquals(false, store.state.value[SettingsRepository.KEY_REVOKED])
    }

    @Test
    fun `every encryption uses a new IV`() {
        val a = cipher.encrypt(deviceKey.toByteArray())
        val b = cipher.encrypt(deviceKey.toByteArray())
        assertNotEquals(Base64.getEncoder().encodeToString(a), Base64.getEncoder().encodeToString(b))
        assertEquals(deviceKey, String(cipher.decrypt(a)))
    }

    @Test
    fun `an altered blob or another key gives no key instead of garbage`() = runBlocking {
        val store = FakeDataStore()
        DeviceKeyRepository(store, cipher).save(DeviceCredentials(deviceKey, null, null))
        val bytes = Base64.getDecoder().decode(store.state.value[DeviceKeyRepository.ENCRYPTED_KEY]!!)
        bytes[bytes.size - 1] = (bytes[bytes.size - 1].toInt() xor 1).toByte()
        store.updateData { p -> p.toMutablePreferences().apply { set(DeviceKeyRepository.ENCRYPTED_KEY, Base64.getEncoder().encodeToString(bytes)) } }
        assertNull(DeviceKeyRepository(store, cipher).current())

        val otherKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val good = FakeDataStore()
        DeviceKeyRepository(good, cipher).save(DeviceCredentials(deviceKey, null, null))
        assertNull(DeviceKeyRepository(good, AesGcmCipher { otherKey }).current())
    }

    @Test
    fun `deviceId is generated once, and a new server asks for pairing without deleting the key`() = runBlocking {
        val store = FakeDataStore()
        val settings = SettingsRepository(store, "https://a.test/api/v1")
        val id = settings.deviceId()
        assertTrue(id.startsWith("watch-"))
        assertEquals(id, settings.deviceId())
        assertTrue(settings.current().needsPairing)

        DeviceKeyRepository(store, cipher).save(DeviceCredentials(deviceKey, null, null))
        assertFalse(settings.current().needsPairing)
        settings.setServerUrl("https://a.test/api/v1")
        assertFalse(settings.current().keyRevoked)
        settings.setServerUrl("https://b.test/api/v1")
        val after = settings.settings.first()
        assertTrue(after.keyRevoked && after.hasKey)
        assertEquals(id, after.deviceId)
    }
}
