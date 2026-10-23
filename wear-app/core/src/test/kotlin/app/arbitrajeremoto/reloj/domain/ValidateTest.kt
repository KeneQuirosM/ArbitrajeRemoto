package app.arbitrajeremoto.reloj.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The cases of core/validate.test.ts that apply to the watch. Not ported: `validateTimestamp`
 * (the watch only produces UTC timestamps with [EventClock.iso]), `validatePlayers` (rosters are
 * edited in the web only) and unknown `type` strings (here the type is an enum).
 */
class ValidateTest {
    private val id = "6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f"

    @Test
    fun `player numbers are 1 to 99`() {
        assertNull(Validate.playerNumber(1))
        assertNull(Validate.playerNumber(99))
        for (bad in listOf(0, 100, -1)) assertEquals("invalid_playerNumber", Validate.playerNumber(bad))
        assertNull(Validate.playerNumber(null))
        assertEquals("missing_playerInNumber", Validate.playerNumber(null, "playerInNumber", required = true))
    }

    @Test
    fun `cleanText strips control characters and trims`() {
        assertEquals("hola mundo", Validate.cleanText("  hola\u0000\u0007 mundo "))
        assertEquals("a\nb", Validate.cleanText("a\nb", allowNewlines = true))
        assertEquals("a b", Validate.cleanText("a\nb"))
    }

    @Test
    fun `normalizes a goal and drops fields that do not apply`() {
        val r = Validate.event(id.uppercase(), EventDraft(EventType.GOAL, team = TeamSide.HOME, playerNumber = 9, text = "ignored"))
        assertEquals(Validated.Ok(EventDraft(EventType.GOAL, team = TeamSide.HOME, playerNumber = 9)), r)
    }

    @Test
    fun `requires a team`() {
        assertEquals(Validated.Invalid("missing_team"), Validate.event(id, EventDraft(EventType.GOAL)))
    }

    @Test
    fun `checks substitutions`() {
        assertEquals(
            Validated.Invalid("same_player_in_and_out"),
            Validate.event(id, EventDraft(EventType.SUBSTITUTION, team = TeamSide.AWAY, playerOutNumber = 5, playerInNumber = 5)),
        )
        assertTrue(Validate.event(id, EventDraft(EventType.SUBSTITUTION, team = TeamSide.AWAY, playerOutNumber = 5)) is Validated.Invalid)
    }

    @Test
    fun `limits note length and keeps text as is`() {
        assertEquals(Validated.Invalid("text_too_long"), Validate.event(id, EventDraft(EventType.NOTE, text = "x".repeat(501))))
        val r = Validate.event(id, EventDraft(EventType.NOTE, text = "<script>alert(1)</script>")) as Validated.Ok
        assertEquals("<script>alert(1)</script>", r.draft.text)
    }

    @Test
    fun `requires period for period_start and end, and a target for void`() {
        assertTrue(Validate.event(id, EventDraft(EventType.PERIOD_START)) is Validated.Invalid)
        assertTrue(Validate.event(id, EventDraft(EventType.PERIOD_START, period = 5)) is Validated.Invalid)
        assertTrue(Validate.event(id, EventDraft(EventType.VOID)) is Validated.Invalid)
        assertEquals(Validated.Invalid("cannot_void_itself"), Validate.event(id, EventDraft(EventType.VOID, voidsEventId = id)))
    }

    @Test
    fun `rejects bad ids and periods above the match`() {
        assertEquals(Validated.Invalid("invalid_id"), Validate.event("abc", EventDraft(EventType.MATCH_END)))
        assertEquals(Validated.Invalid("period_out_of_range"), Validate.event(id, EventDraft(EventType.PERIOD_START, period = 3), periods = 2))
        assertEquals(Validated.Invalid("invalid_minutes"), Validate.event(id, EventDraft(EventType.ADDED_TIME, minutes = 31)))
    }
}
