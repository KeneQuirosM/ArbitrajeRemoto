package app.arbitrajeremoto.reloj.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MatchActionsTest {
    private val rules = MatchRules(2, 45)
    private val k = 1_792_944_000_000L
    private fun state(vararg e: MatchEvent) = Derive.deriveState(rules, e.toList())

    @Test
    fun `the clock button follows the derived phase`() {
        assertEquals(ClockAction.Start(1), ClockControls.primary(state(), rules))
        val start = ev(EventType.PERIOD_START, k, period = 1)
        assertEquals(ClockAction.Pause, ClockControls.primary(state(start), rules))
        val pause = ev(EventType.PERIOD_PAUSE, k + MIN)
        assertEquals(ClockAction.Resume, ClockControls.primary(state(start, pause), rules))
        val end1 = ev(EventType.PERIOD_END, k + 46 * MIN, period = 1)
        assertEquals(ClockAction.Start(2), ClockControls.primary(state(start, end1), rules))
        assertEquals(listOf(ClockAction.EndMatch), ClockControls.rare(state(start, end1)))
        assertEquals(listOf(ClockAction.EndPeriod(1), ClockAction.EndMatch), ClockControls.rare(state(start)))
        val finished = state(start, ev(EventType.MATCH_END, k + 2 * MIN))
        assertNull(ClockControls.primary(finished, rules))
        assertEquals(emptyList<ClockAction>(), ClockControls.rare(finished))
    }

    @Test
    fun `undo targets the last effective event and skips what was already undone`() {
        val start = ev(EventType.PERIOD_START, k, period = 1)
        val goal = ev(EventType.GOAL, k + MIN, team = TeamSide.HOME, playerNumber = 9)
        val card = ev(EventType.YELLOW_CARD, k + 2 * MIN, team = TeamSide.AWAY)
        assertEquals(card.id, Undo.target(state(start, goal, card))?.id)
        val undoCard = ev(EventType.VOID, k + 3 * MIN, voidsEventId = card.id)
        assertEquals(goal.id, Undo.target(state(start, goal, card, undoCard))?.id)
        assertNull(Undo.target(state()))
    }

    @Test
    fun `event clock never repeats a millisecond and formats UTC with millis`() {
        var now = 1_000L
        val clock = EventClock { now }
        assertEquals(1_000L, clock.next())
        assertEquals(1_001L, clock.next())
        now = 5_000
        assertEquals(5_000L, clock.next())
        now = 4_000 // the device clock went back
        assertEquals(5_001L, clock.next())
        val restarted = EventClock { 10L }.apply { seed(20) }
        assertEquals(21L, restarted.next())
        assertEquals("2026-10-25T16:00:00.000Z", EventClock.iso(k))
        assertEquals("2026-10-25T16:00:02.005Z", EventClock.iso(k + 2_005))
    }
}
