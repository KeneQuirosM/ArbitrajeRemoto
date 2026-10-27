package app.arbitrajeremoto.reloj.ui.match

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NumberPadTest {
    @Test
    fun `two digits pick at once`() {
        val first = NumberPad.press("", 1)
        assertEquals(PadResult.Typing("1"), first)
        assertEquals(PadResult.Done(10), NumberPad.press("1", 0))
        assertEquals(PadResult.Done(99), NumberPad.press("9", 9))
    }

    @Test
    fun `one digit needs the check key`() {
        assertEquals(PadResult.Typing("9"), NumberPad.press("", 9))
        assertTrue(NumberPad.canConfirm("9", allowNone = true))
        assertEquals(PadResult.Done(9), NumberPad.confirm("9", allowNone = true))
    }

    @Test
    fun `no leading zero and never more than two digits`() {
        assertFalse(NumberPad.digitEnabled("", 0))
        assertEquals(PadResult.Typing(""), NumberPad.press("", 0))
        assertTrue(NumberPad.digitEnabled("1", 0))
        assertFalse(NumberPad.digitEnabled("12", 3))
    }

    @Test
    fun `check with nothing typed is no number only when allowed`() {
        assertEquals(PadResult.Done(null), NumberPad.confirm("", allowNone = true))
        assertNull(NumberPad.confirm("", allowNone = false))
        assertFalse(NumberPad.canConfirm("", allowNone = false))
    }

    @Test
    fun `the player going out cannot come in`() {
        // Two digits equal to the excluded number stay on screen instead of being picked
        assertEquals(PadResult.Typing("10"), NumberPad.press("1", 0, exclude = 10))
        assertFalse(NumberPad.canConfirm("10", allowNone = false, exclude = 10))
        assertFalse(NumberPad.canConfirm("7", allowNone = false, exclude = 7))
        assertEquals(PadResult.Done(14), NumberPad.press("1", 4, exclude = 10))
    }

    @Test
    fun `delete removes the last digit`() {
        assertEquals("1", NumberPad.delete("10"))
        assertEquals("", NumberPad.delete("1"))
        assertEquals("", NumberPad.delete(""))
    }
}
