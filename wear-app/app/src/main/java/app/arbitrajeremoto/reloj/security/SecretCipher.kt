package app.arbitrajeremoto.reloj.security

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Encrypts small secrets (the deviceKey). */
interface SecretCipher {
    fun encrypt(plain: ByteArray): ByteArray

    /** Throws [GeneralSecurityException] if the blob was altered or the key is gone. */
    fun decrypt(blob: ByteArray): ByteArray
}

/**
 * AES-256/GCM. Output: `[ivLength][iv][ciphertext+tag]`. The IV is chosen by the cipher
 * (the Android Keystore requires that), so every encryption differs.
 */
class AesGcmCipher(private val key: () -> SecretKey) : SecretCipher {

    override fun encrypt(plain: ByteArray): ByteArray {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val iv = cipher.iv
        val sealed = cipher.doFinal(plain)
        return byteArrayOf(iv.size.toByte()) + iv + sealed
    }

    override fun decrypt(blob: ByteArray): ByteArray {
        if (blob.isEmpty()) throw GeneralSecurityException("empty")
        val ivLength = blob[0].toInt()
        if (ivLength !in 12..16 || blob.size <= 1 + ivLength) throw GeneralSecurityException("bad blob")
        val iv = blob.copyOfRange(1, 1 + ivLength)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, iv))
        return cipher.doFinal(blob, 1 + ivLength, blob.size - 1 - ivLength)
    }

    companion object {
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val TAG_BITS = 128
    }
}

/** AES key that lives in the Android Keystore: it cannot be read out and is not backed up. */
object AndroidKeystoreKey {
    private const val PROVIDER = "AndroidKeyStore"
    const val ALIAS = "arbitraje_device_key_v1"

    @Synchronized
    fun getOrCreate(alias: String = ALIAS): SecretKey {
        val keyStore = KeyStore.getInstance(PROVIDER).apply { load(null) }
        (keyStore.getKey(alias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER)
        generator.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }
}
