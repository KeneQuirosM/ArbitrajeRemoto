package app.arbitrajeremoto.reloj.domain

import java.util.UUID

// Port of the helpers in test/helpers.ts used by core/derive.test.ts.

const val MIN = 60_000L

private var counter = 0L

/** A stored event for pure derivation tests. */
fun ev(
    type: EventType,
    t: Long,
    id: String = UUID.randomUUID().toString(),
    team: TeamSide? = null,
    playerNumber: Int? = null,
    playerOutNumber: Int? = null,
    playerInNumber: Int? = null,
    text: String? = null,
    voidsEventId: String? = null,
    period: Int? = null,
    minutes: Int? = null,
): MatchEvent {
    counter++
    return MatchEvent(id, type, t, team, playerNumber, playerOutNumber, playerInNumber, text, voidsEventId, period, minutes, seq = counter)
}

/**
 * Seeded shuffle with the same LCG as test/helpers.ts. Exact 64-bit arithmetic here; JavaScript loses
 * precision above 2^53, so the permutations differ — the test only needs 20 different orders.
 */
fun <T> shuffle(items: List<T>, seed: Int): List<T> {
    val out = items.toMutableList()
    var s = seed.toLong()
    for (i in out.size - 1 downTo 1) {
        s = (s * 1103515245L + 12345L) % 2147483648L
        val j = (s % (i + 1)).toInt()
        val tmp = out[i]
        out[i] = out[j]
        out[j] = tmp
    }
    return out
}
