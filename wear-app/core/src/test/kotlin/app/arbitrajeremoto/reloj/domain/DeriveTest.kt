package app.arbitrajeremoto.reloj.domain

import app.arbitrajeremoto.reloj.domain.EventType.ADDED_TIME
import app.arbitrajeremoto.reloj.domain.EventType.GOAL
import app.arbitrajeremoto.reloj.domain.EventType.MATCH_END
import app.arbitrajeremoto.reloj.domain.EventType.NOTE
import app.arbitrajeremoto.reloj.domain.EventType.OWN_GOAL
import app.arbitrajeremoto.reloj.domain.EventType.PERIOD_END
import app.arbitrajeremoto.reloj.domain.EventType.PERIOD_PAUSE
import app.arbitrajeremoto.reloj.domain.EventType.PERIOD_RESUME
import app.arbitrajeremoto.reloj.domain.EventType.PERIOD_START
import app.arbitrajeremoto.reloj.domain.EventType.RED_CARD
import app.arbitrajeremoto.reloj.domain.EventType.SUBSTITUTION
import app.arbitrajeremoto.reloj.domain.EventType.VOID
import app.arbitrajeremoto.reloj.domain.EventType.YELLOW_CARD
import app.arbitrajeremoto.reloj.domain.TeamSide.AWAY
import app.arbitrajeremoto.reloj.domain.TeamSide.HOME
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/** Every case of core/derive.test.ts, same inputs and expected results. */
class DeriveTest {
    private val rules = MatchRules(periods = 2, periodMinutes = 45)
    private val k = Instant.parse("2026-10-25T16:00:00Z").toEpochMilli()

    private fun derive(vararg events: MatchEvent) = Derive.deriveState(rules, events.toList())

    // --- score and cards

    @Test
    fun `starts scheduled at 0-0`() {
        val s = derive()
        assertEquals(MatchStatus.SCHEDULED, s.status)
        assertEquals(Score(0, 0), s.score)
        assertNull(s.clock.period)
    }

    @Test
    fun `counts goals and gives own goals to the opponent`() {
        val s = derive(
            ev(PERIOD_START, k, period = 1),
            ev(GOAL, k + 10 * MIN, team = HOME, playerNumber = 9),
            ev(OWN_GOAL, k + 20 * MIN, team = HOME, playerNumber = 4),
            ev(GOAL, k + 30 * MIN, team = AWAY),
        )
        assertEquals(Score(1, 2), s.score)
        assertEquals(MatchStatus.LIVE, s.status)
    }

    @Test
    fun `turns a second yellow into a red`() {
        val s = derive(
            ev(PERIOD_START, k, period = 1),
            ev(YELLOW_CARD, k + MIN, team = AWAY, playerNumber = 5),
            ev(YELLOW_CARD, k + 2 * MIN, team = AWAY, playerNumber = 5),
            ev(RED_CARD, k + 3 * MIN, team = HOME, playerNumber = 3),
            ev(YELLOW_CARD, k + 4 * MIN, team = HOME),
        )
        assertEquals(
            listOf(
                PlayerDiscipline(HOME, 3, yellow = 0, red = true, secondYellow = false),
                PlayerDiscipline(AWAY, 5, yellow = 2, red = true, secondYellow = true),
            ),
            s.discipline,
        )
    }

    // --- void (undo)

    @Test
    fun `removes the voided event from score and timeline`() {
        val goal = ev(GOAL, k + MIN, team = HOME, playerNumber = 10)
        val s = derive(ev(PERIOD_START, k, period = 1), goal, ev(VOID, k + 2 * MIN, voidsEventId = goal.id))
        assertEquals(0, s.score.home)
        assertEquals(listOf(goal.id), s.voidedEventIds)
        assertEquals(listOf(PERIOD_START), s.timeline.map { it.type })
    }

    @Test
    fun `ignores a void that targets another void`() {
        val goal = ev(GOAL, k + MIN, team = HOME)
        val undo = ev(VOID, k + 2 * MIN, voidsEventId = goal.id)
        val redo = ev(VOID, k + 3 * MIN, voidsEventId = undo.id)
        val s = derive(ev(PERIOD_START, k, period = 1), goal, undo, redo)
        assertEquals(0, s.score.home)
        assertTrue(s.warnings.contains(Warning(redo.id, "void_targets_void")))
    }

    @Test
    fun `applies a void whose target arrives later`() {
        val goal = ev(GOAL, k + MIN, team = AWAY)
        val undo = ev(VOID, k + 2 * MIN, voidsEventId = goal.id)
        assertEquals(listOf(Warning(undo.id, "void_target_missing")), derive(undo).warnings)
        assertEquals(0, derive(undo, goal).score.away)
    }

    @Test
    fun `can undo a kick-off`() {
        val start = ev(PERIOD_START, k, period = 1)
        assertEquals(MatchStatus.SCHEDULED, derive(start, ev(VOID, k + 5000, voidsEventId = start.id)).status)
    }

    // --- clock from timestamps

    private fun firstHalf() = listOf(
        ev(PERIOD_START, k, period = 1),
        ev(PERIOD_PAUSE, k + 10 * MIN, period = 1),
        ev(PERIOD_RESUME, k + 13 * MIN, period = 1),
    )

    @Test
    fun `excludes paused time`() {
        val s = Derive.deriveState(rules, firstHalf())
        assertEquals(ClockState(period = 1, running = true, elapsedMs = 10 * MIN, anchorAt = k + 13 * MIN, addedMinutes = null), s.clock)
        // A goal 20 real minutes after kick-off with 3 paused minutes is in the 18th minute.
        val goal = ev(GOAL, k + 20 * MIN, team = HOME)
        val s2 = Derive.deriveState(rules, firstHalf() + goal)
        assertEquals("18", s2.timeline.first { it.id == goal.id }.minuteLabel)
    }

    @Test
    fun `goes to halftime, then second half starts at 46`() {
        val goal = ev(GOAL, k + 70 * MIN + 30_000, team = AWAY)
        val s = Derive.deriveState(
            rules,
            firstHalf() + listOf(
                ev(ADDED_TIME, k + 46 * MIN, minutes = 2),
                ev(PERIOD_END, k + 50 * MIN, period = 1),
                ev(PERIOD_START, k + 65 * MIN, period = 2),
                goal,
            ),
        )
        assertEquals(MatchStatus.LIVE, s.status)
        assertEquals(2, s.clock.period)
        assertEquals("45+3", s.timeline.first { it.type == PERIOD_END }.minuteLabel)
        assertEquals("51", s.timeline.first { it.id == goal.id }.minuteLabel)
    }

    @Test
    fun `reports halftime and the added time of the period`() {
        val s = Derive.deriveState(rules, firstHalf() + ev(ADDED_TIME, k + 46 * MIN, minutes = 2))
        assertEquals(2, s.clock.addedMinutes)
        val s2 = Derive.deriveState(rules, firstHalf() + ev(PERIOD_END, k + 50 * MIN, period = 1))
        assertEquals(MatchStatus.HALFTIME, s2.status)
        assertFalse(s2.clock.running)
        assertEquals(47 * MIN, s2.clock.elapsedMs)
    }

    @Test
    fun `finishes after the last period or on match_end`() {
        val base = listOf(ev(PERIOD_START, k, period = 1), ev(PERIOD_END, k + 45 * MIN, period = 1))
        val finished = Derive.deriveState(
            rules,
            base + listOf(ev(PERIOD_START, k + 60 * MIN, period = 2), ev(PERIOD_END, k + 106 * MIN, period = 2)),
        )
        assertEquals(MatchStatus.FINISHED, finished.status)
        val abandoned = Derive.deriveState(rules, base + listOf(ev(PERIOD_START, k + 60 * MIN, period = 2), ev(MATCH_END, k + 70 * MIN)))
        assertEquals(MatchStatus.FINISHED, abandoned.status)
        assertEquals(2, abandoned.clock.period)
        assertFalse(abandoned.clock.running)
        assertEquals(10 * MIN, abandoned.clock.elapsedMs)
    }

    @Test
    fun `keeps but ignores impossible clock transitions`() {
        val resume = ev(PERIOD_RESUME, k + MIN)
        val start2 = ev(PERIOD_START, k + 2 * MIN, period = 2)
        val s = derive(ev(PERIOD_START, k, period = 1), resume, start2)
        assertEquals(1, s.clock.period)
        assertTrue(s.clock.running)
        assertEquals(k, s.clock.anchorAt)
        assertEquals(listOf("invalid_period_start", "invalid_resume"), s.warnings.map { it.code }.sorted())
    }

    @Test
    fun `does not start a period beyond the configured number`() {
        val one = MatchRules(periods = 1, periodMinutes = 40)
        val s = Derive.deriveState(
            one,
            listOf(ev(PERIOD_START, k, period = 1), ev(PERIOD_END, k + 40 * MIN, period = 1), ev(PERIOD_START, k + 50 * MIN, period = 2)),
        )
        assertEquals(MatchStatus.FINISHED, s.status)
    }

    // --- order independence

    @Test
    fun `gives the same state for any arrival order`() {
        val goal = ev(GOAL, k + 5 * MIN, team = HOME, playerNumber = 7)
        val events = listOf(
            ev(PERIOD_START, k, period = 1),
            goal,
            ev(YELLOW_CARD, k + 6 * MIN, team = AWAY, playerNumber = 8),
            ev(VOID, k + 7 * MIN, voidsEventId = goal.id),
            ev(SUBSTITUTION, k + 8 * MIN, team = AWAY, playerOutNumber = 8, playerInNumber = 14),
            ev(PERIOD_PAUSE, k + 9 * MIN, period = 1),
            ev(PERIOD_RESUME, k + 10 * MIN, period = 1),
            ev(GOAL, k + 20 * MIN, team = AWAY, playerNumber = 14),
            ev(NOTE, k + 21 * MIN, text = "Lesión del 3"),
            ev(PERIOD_END, k + 47 * MIN, period = 1),
        )
        val expected = Derive.deriveState(rules, events)
        val orders = mutableSetOf<List<String>>()
        for (seed in 1..20) {
            val shuffled = shuffle(events, seed)
            orders += shuffled.map { it.id }
            assertEquals(expected, Derive.deriveState(rules, shuffled))
        }
        assertTrue("the shuffles must really change the order", orders.size > 10)
        assertEquals(Score(0, 1), expected.score)
    }
}
