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
 * Shirt-number pad (1–99). Two digits are confirmed at once (nothing longer exists); one digit,
 * or no digit for "No number", needs ✓. [exclude] is the player going out in a substitution.
 */
object NumberPad {
    const val MAX_DIGITS = 2

    /** No leading 0, at most two digits. */
    fun digitEnabled(digits: String, digit: Int): Boolean =
        digits.length < MAX_DIGITS && !(digits.isEmpty() && digit == 0)

    fun press(digits: String, digit: Int, exclude: Int? = null): PadResult {
        if (!digitEnabled(digits, digit)) return PadResult.Typing(digits)
        val next = digits + digit
        val number = next.toInt()
        return if (next.length == MAX_DIGITS && number != exclude && valid(number)) PadResult.Done(number) else PadResult.Typing(next)
    }

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
