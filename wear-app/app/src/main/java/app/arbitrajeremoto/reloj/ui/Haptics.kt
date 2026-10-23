package app.arbitrajeremoto.reloj.ui

import android.content.Context
import android.os.VibrationEffect
import android.os.VibratorManager

/** Short vibration to confirm an event without looking at the watch (guide §10). */
class Haptics(context: Context) {
    private val vibrator = (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator

    fun confirm() {
        vibrator?.vibrate(VibrationEffect.createOneShot(CONFIRM_MS, VibrationEffect.DEFAULT_AMPLITUDE))
    }

    companion object {
        private const val CONFIRM_MS = 80L
    }
}
