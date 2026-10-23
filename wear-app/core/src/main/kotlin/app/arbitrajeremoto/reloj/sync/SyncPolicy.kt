package app.arbitrajeremoto.reloj.sync

/** What to do after a sync pass: pure, so it is unit-tested. */
sealed interface NextStep {
    /** Everything sent: reset the attempt counter, schedule nothing. */
    data object Idle : NextStep

    data class RunIn(val delayMs: Long, val attempt: Int) : NextStep

    /** 401: mark the key revoked (back to pairing), keep the queue, schedule nothing. */
    data object Unpaired : NextStep
}

object SyncPolicy {
    fun next(outcome: SyncOutcome, attempt: Int): NextStep = when (outcome) {
        SyncOutcome.Done -> NextStep.Idle
        is SyncOutcome.Retry -> NextStep.RunIn(Backoff.delayMs(attempt), attempt + 1)
        // Retry-After is a minimum: never retry sooner than the exponential delay either
        is SyncOutcome.RetryAfter -> NextStep.RunIn(maxOf(outcome.delayMs, Backoff.delayMs(attempt)), attempt + 1)
        SyncOutcome.Unauthorized -> NextStep.Unpaired
    }
}
