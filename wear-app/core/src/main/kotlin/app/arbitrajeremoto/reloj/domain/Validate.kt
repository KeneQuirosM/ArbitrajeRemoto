package app.arbitrajeremoto.reloj.domain

import java.text.Normalizer

// Kotlin port of the parts of core/validate.ts the watch needs, so it never queues an event
// the server would reject. Reasons are the server's (`invalid_*`, `missing_*`, ...).

/** Fields of an event, before it gets an id and a timestamp. */
data class EventDraft(
    val type: EventType,
    val team: TeamSide? = null,
    val playerNumber: Int? = null,
    val playerOutNumber: Int? = null,
    val playerInNumber: Int? = null,
    val text: String? = null,
    val voidsEventId: String? = null,
    val period: Int? = null,
    val minutes: Int? = null,
)

sealed interface Validated {
    data class Ok(val draft: EventDraft) : Validated
    data class Invalid(val reason: String) : Validated
}

object Validate {
    const val MIN_PLAYER_NUMBER = 1
    const val MAX_PLAYER_NUMBER = 999
    const val MAX_PERIODS = 4
    const val MAX_ADDED_MINUTES = 30
    const val NOTE_TEXT = 500

    private val UUID_RE = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

    // C0/C1 control characters except tab and newline.
    private val CONTROL_RE = Regex("[\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F]")

    fun isUuid(value: String?): Boolean = value != null && UUID_RE.matches(value.lowercase())

    /** Trims, normalizes Unicode and strips control characters. Newlines are kept only when allowed. */
    fun cleanText(value: String, allowNewlines: Boolean = false): String {
        var text = CONTROL_RE.replace(Normalizer.normalize(value, Normalizer.Form.NFC), "")
        text = if (allowNewlines) text.replace("\t", " ") else text.replace(Regex("[\\t\\n]+"), " ")
        return text.trim()
    }

    fun playerNumber(value: Int?, field: String = "playerNumber", required: Boolean = false): String? = when {
        value == null -> if (required) "missing_$field" else null
        value < MIN_PLAYER_NUMBER || value > MAX_PLAYER_NUMBER -> "invalid_$field"
        else -> null
    }

    private fun intRange(value: Int?, field: String, min: Int, max: Int, required: Boolean): String? = when {
        value == null -> if (required) "missing_$field" else null
        value < min || value > max -> "invalid_$field"
        else -> null
    }

    /**
     * validateEvent of core/validate.ts for an event with [id]: fields that do not apply to the type
     * are dropped. With [periods], a period above the match's is rejected (`period_out_of_range`).
     */
    fun event(id: String, draft: EventDraft, periods: Int? = null): Validated {
        if (!isUuid(id)) return Validated.Invalid("invalid_id")
        fun bad(reason: String?) = reason?.let { Validated.Invalid(it) }
        val base = EventDraft(draft.type)
        val normalized = when (draft.type) {
            EventType.GOAL, EventType.OWN_GOAL, EventType.YELLOW_CARD, EventType.RED_CARD -> {
                if (draft.team == null) return Validated.Invalid("missing_team")
                bad(playerNumber(draft.playerNumber))?.let { return it }
                base.copy(team = draft.team, playerNumber = draft.playerNumber)
            }
            EventType.SUBSTITUTION -> {
                if (draft.team == null) return Validated.Invalid("missing_team")
                bad(playerNumber(draft.playerOutNumber, "playerOutNumber", required = true))?.let { return it }
                bad(playerNumber(draft.playerInNumber, "playerInNumber", required = true))?.let { return it }
                if (draft.playerOutNumber == draft.playerInNumber) return Validated.Invalid("same_player_in_and_out")
                base.copy(team = draft.team, playerOutNumber = draft.playerOutNumber, playerInNumber = draft.playerInNumber)
            }
            EventType.NOTE -> {
                val text = draft.text?.let { cleanText(it, allowNewlines = true) }
                if (text.isNullOrEmpty()) return Validated.Invalid("missing_text")
                if (text.length > NOTE_TEXT) return Validated.Invalid("text_too_long")
                bad(playerNumber(draft.playerNumber))?.let { return it }
                base.copy(text = text, team = draft.team, playerNumber = draft.playerNumber)
            }
            EventType.PERIOD_START, EventType.PERIOD_END -> {
                bad(intRange(draft.period, "period", 1, MAX_PERIODS, required = true))?.let { return it }
                base.copy(period = draft.period)
            }
            EventType.PERIOD_PAUSE, EventType.PERIOD_RESUME -> {
                bad(intRange(draft.period, "period", 1, MAX_PERIODS, required = false))?.let { return it }
                base.copy(period = draft.period)
            }
            EventType.ADDED_TIME -> {
                bad(intRange(draft.minutes, "minutes", 0, MAX_ADDED_MINUTES, required = true))?.let { return it }
                bad(intRange(draft.period, "period", 1, MAX_PERIODS, required = false))?.let { return it }
                base.copy(minutes = draft.minutes, period = draft.period)
            }
            EventType.MATCH_END -> base
            EventType.VOID -> {
                val target = draft.voidsEventId?.lowercase()
                if (!isUuid(target)) return Validated.Invalid("invalid_voidsEventId")
                if (target == id.lowercase()) return Validated.Invalid("cannot_void_itself")
                base.copy(voidsEventId = target)
            }
        }
        val period = normalized.period
        if (periods != null && period != null && period > periods) return Validated.Invalid("period_out_of_range")
        return Validated.Ok(normalized)
    }
}
