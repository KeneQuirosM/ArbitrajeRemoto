package app.arbitrajeremoto.reloj.domain

// Kotlin port of core/clock.ts. The clock is never stored as accumulated seconds:
// it is always rebuilt from period_start / pause / resume / end timestamps (docs/CRONOMETRO.md).

object Clock {
    /** Device clocks closer than this to the server are trusted as-is. */
    const val CLOCK_SKEW_THRESHOLD_MS = 30_000L

    /** Played milliseconds of the current period at [nowMs] (same time base as `anchorAt`). */
    fun elapsedAt(clock: ClockState, nowMs: Long): Long {
        if (!clock.running || clock.anchorAt == null) return clock.elapsedMs
        return clock.elapsedMs + maxOf(0, nowMs - clock.anchorAt)
    }

    /**
     * Football minute label for a moment [elapsedMs] into [period].
     * The first minute of a 45' half is "1"; 45:00 played is already "45+1".
     * Second half of 2×45 starts at "46".
     */
    fun minuteLabel(period: Int, elapsedMs: Long, periodMinutes: Int): String {
        val minute = Math.floorDiv(maxOf(0L, elapsedMs), 60_000L) + 1
        val base = (period - 1).toLong() * periodMinutes
        if (minute > periodMinutes) return "${base + periodMinutes}+${minute - periodMinutes}"
        return (base + minute).toString()
    }

    /** Absolute minute number (no "+"). */
    fun absoluteMinute(period: Int, elapsedMs: Long, periodMinutes: Int): Long =
        (period - 1).toLong() * periodMinutes + Math.floorDiv(maxOf(0L, elapsedMs), 60_000L) + 1

    /**
     * Correction the server applies to a batch, given its time when the batch arrived and
     * the device time when it was sent (`sentAt`). Small differences are ignored.
     */
    fun clockOffsetMs(serverNowMs: Long, sentAtMs: Long?, thresholdMs: Long = CLOCK_SKEW_THRESHOLD_MS): Long {
        if (sentAtMs == null) return 0
        val offset = serverNowMs - sentAtMs
        return if (Math.abs(offset) > thresholdMs) offset else 0
    }

    /** "mm:ss" for a clock display. Minutes keep counting past 59 (e.g. "92:05"). */
    fun formatClock(elapsedMs: Long): String {
        val total = Math.floorDiv(maxOf(0L, elapsedMs), 1000L)
        val m = total / 60
        val s = total % 60
        return m.toString().padStart(2, '0') + ":" + s.toString().padStart(2, '0')
    }
}
