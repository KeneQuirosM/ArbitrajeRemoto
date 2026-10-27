package app.arbitrajeremoto.reloj.ui.match

import app.arbitrajeremoto.reloj.domain.Validate

/** Result of a key press on the shirt-number pad. */
sealed interface PadResult {
    /** Still typing: the digits shown. */
    data class Typing(val digits: String) : PadResult

    /** Chosen: a shirt number, or null for "No number". */
    data class Done(val number: Int?) : PadResult
}

/**
 * Shirt-number pad (1–999, futsal uses numbers like 108). Digits only build the number; it is
 * always confirmed with ✓, and ✓ with nothing typed is "No number". [exclude] is the player going
 * out in a substitution.
 */
object NumberPad {
    const val MAX_DIGITS = 3

    /** No leading 0, at most three digits. */
    fun digitEnabled(digits: String, digit: Int): Boolean =
        digits.length < MAX_DIGITS && !(digits.isEmpty() && digit == 0)

    fun press(digits: String, digit: Int): PadResult.Typing =
        PadResult.Typing(if (digitEnabled(digits, digit)) digits + digit else digits)

    fun delete(digits: String): String = digits.dropLast(1)

    fun canConfirm(digits: String, allowNone: Boolean, exclude: Int? = null): Boolean {
        if (digits.isEmpty()) return allowNone
        val number = digits.toIntOrNull() ?: return false
        return valid(number) && number != exclude
    }

    /** ✓: the typed number, or "No number" when nothing was typed and that is allowed. */
    fun confirm(digits: String, allowNone: Boolean, exclude: Int? = null): PadResult.Done? {
        if (!canConfirm(digits, allowNone, exclude)) return null
        return PadResult.Done(digits.toIntOrNull())
    }

    private fun valid(number: Int) = number in Validate.MIN_PLAYER_NUMBER..Validate.MAX_PLAYER_NUMBER
}
