package app.arbitrajeremoto.reloj.domain

import org.junit.Assert.assertEquals
import org.junit.Test

/** Every case of core/clock.test.ts. */
class ClockTest {
    @Test
    fun `minuteLabel counts the first minute as 1`() {
        assertEquals("1", Clock.minuteLabel(1, 0, 45))
        assertEquals("1", Clock.minuteLabel(1, 59_999, 45))
        assertEquals("2", Clock.minuteLabel(1, 60_000, 45))
    }

    @Test
    fun `minuteLabel switches to added time once the period length is played`() {
        assertEquals("45", Clock.minuteLabel(1, 44 * 60_000L + 59_999, 45))
        assertEquals("45+1", Clock.minuteLabel(1, 45 * 60_000L, 45))
        assertEquals("45+3", Clock.minuteLabel(1, 47 * 60_000L + 30_000, 45))
    }

    @Test
    fun `minuteLabel continues from the previous periods`() {
        assertEquals("46", Clock.minuteLabel(2, 0, 45))
        assertEquals("90+1", Clock.minuteLabel(2, 45 * 60_000L + 1, 45))
        assertEquals("31", Clock.minuteLabel(2, 10 * 60_000L, 20))
    }

    @Test
    fun `minuteLabel never goes below the first minute`() {
        assertEquals("1", Clock.minuteLabel(1, -5000, 45))
        assertEquals(46L, Clock.absoluteMinute(2, -1, 45))
    }

    @Test
    fun `elapsedAt adds running time since the anchor`() {
        val clock = ClockState(period = 1, running = true, elapsedMs = 10_000, anchorAt = 1_000, addedMinutes = null)
        assertEquals(15_000L, Clock.elapsedAt(clock, 6_000))
    }

    @Test
    fun `elapsedAt is frozen while paused and never negative when now is before the anchor`() {
        assertEquals(7_000L, Clock.elapsedAt(ClockState(1, false, 7_000, null, null), 99_999))
        assertEquals(7_000L, Clock.elapsedAt(ClockState(1, true, 7_000, 10_000, null), 5_000))
    }

    @Test
    fun `clockOffsetMs ignores small differences (latency, normal drift)`() {
        assertEquals(0L, Clock.clockOffsetMs(100_000, 95_000))
        assertEquals(0L, Clock.clockOffsetMs(100_000, 129_000))
    }

    @Test
    fun `clockOffsetMs corrects a device clock that is clearly ahead or behind`() {
        assertEquals(-5 * 60_000L, Clock.clockOffsetMs(1_000_000, 1_000_000 + 5 * 60_000L))
        assertEquals(2 * 60_000L, Clock.clockOffsetMs(1_000_000, 1_000_000 - 2 * 60_000L))
    }

    @Test
    fun `clockOffsetMs does nothing without sentAt`() {
        assertEquals(0L, Clock.clockOffsetMs(1_000_000, null))
    }

    @Test
    fun `formatClock formats mm ss and keeps counting past 59 minutes`() {
        assertEquals("00:00", Clock.formatClock(0))
        assertEquals("01:05", Clock.formatClock(65_400))
        assertEquals("92:05", Clock.formatClock(92 * 60_000L + 5_000))
    }
}
