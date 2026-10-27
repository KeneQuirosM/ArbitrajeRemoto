package app.arbitrajeremoto.reloj.ui.match

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NumberPadTest {
    @Test
    fun `digits only build the number, check confirms it`() {
        var digits = ""
        for (d in listOf(1, 0, 8)) digits = NumberPad.press(digits, d).digits
        assertEquals("108", digits)
        assertEquals(PadResult.Done(108), NumberPad.confirm(digits, allowNone = true))
        // Two digits no longer pick at once: 10 could be the start of 108
        assertEquals(PadResult.Typing("10"), NumberPad.press("1", 0))
        assertEquals(PadResult.Done(9), NumberPad.confirm("9", allowNone = true))
        assertEquals(PadResult.Done(999), NumberPad.confirm("999", allowNone = false))
    }

    @Test
    fun `no leading zero and never more than three digits`() {
        assertFalse(NumberPad.digitEnabled("", 0))
        assertEquals(PadResult.Typing(""), NumberPad.press("", 0))
        assertTrue(NumberPad.digitEnabled("10", 0))
        assertFalse(NumberPad.digitEnabled("108", 3))
        assertEquals(PadResult.Typing("108"), NumberPad.press("108", 3))
    }

    @Test
    fun `check with nothing typed is no number only when allowed`() {
        assertEquals(PadResult.Done(null), NumberPad.confirm("", allowNone = true))
        assertNull(NumberPad.confirm("", allowNone = false))
        assertFalse(NumberPad.canConfirm("", allowNone = false))
    }

    @Test
    fun `the player going out cannot come in`() {
        assertFalse(NumberPad.canConfirm("108", allowNone = false, exclude = 108))
        assertNull(NumberPad.confirm("7", allowNone = false, exclude = 7))
        assertEquals(PadResult.Done(14), NumberPad.confirm("14", allowNone = false, exclude = 108))
    }

    @Test
    fun `delete removes the last digit`() {
        assertEquals("10", NumberPad.delete("108"))
        assertEquals("", NumberPad.delete("1"))
        assertEquals("", NumberPad.delete(""))
    }
}
