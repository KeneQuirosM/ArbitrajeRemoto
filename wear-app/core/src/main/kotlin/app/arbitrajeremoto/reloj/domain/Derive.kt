package app.arbitrajeremoto.reloj.domain

// Kotlin port of core/derive.ts: pure derivation of the match state from its immutable event log.
// Same events in any arrival order => same state. Keep it in line with the TypeScript original.

object Derive {
    private enum class Phase(val status: MatchStatus) {
        PRE(MatchStatus.SCHEDULED),
        RUNNING(MatchStatus.LIVE),
        PAUSED(MatchStatus.LIVE),
        BREAK(MatchStatus.HALFTIME),
        ENDED(MatchStatus.FINISHED),
    }

    /** Deterministic order: effective time, then id (ties are practically impossible). */
    val eventOrder: Comparator<MatchEvent> = compareBy<MatchEvent> { it.t }.thenBy { it.id }

    /** Ids voided by valid `void` events. A void can never target another void. */
    fun voidedIds(events: List<MatchEvent>): Pair<Set<String>, List<Warning>> {
        val byId = events.associateBy { it.id }
        val voided = mutableSetOf<String>()
        val warnings = mutableListOf<Warning>()
        for (e in events) {
            if (e.type != EventType.VOID || e.voidsEventId == null) continue
            val target = byId[e.voidsEventId]
            when {
                // The target may still be in some device's queue; it is applied once it arrives.
                target == null -> warnings += Warning(e.id, "void_target_missing")
                target.type == EventType.VOID -> warnings += Warning(e.id, "void_targets_void")
                else -> voided += target.id
            }
        }
        return voided to warnings
    }

    fun deriveState(rules: MatchRules, events: List<MatchEvent>): MatchState {
        val (voided, voidWarnings) = voidedIds(events)
        val warnings = voidWarnings.toMutableList()
        val effective = events.filter { it.type != EventType.VOID && it.id !in voided }.sortedWith(eventOrder)

        var phase = Phase.PRE
        var period: Int? = null
        var elapsedMs = 0L
        var anchorAt: Long? = null
        val added = mutableMapOf<Int, Int>()
        var home = 0
        var away = 0
        val discipline = LinkedHashMap<String, PlayerDiscipline>()
        val timeline = mutableListOf<DerivedEvent>()

        fun elapsedAtT(t: Long): Long {
            val anchor = anchorAt
            return if (phase == Phase.RUNNING && anchor != null) elapsedMs + maxOf(0L, t - anchor) else elapsedMs
        }
        fun warn(e: MatchEvent, code: String) {
            warnings += Warning(e.id, code)
        }
        fun stopClock(t: Long) {
            elapsedMs = elapsedAtT(t)
            anchorAt = null
        }
        fun score(side: TeamSide) {
            if (side == TeamSide.HOME) home++ else away++
        }

        for (e in effective) {
            // Minute of the event, measured before any clock transition it causes.
            var atPeriod = period
            var atElapsed = elapsedAtT(e.t)

            when (e.type) {
                EventType.PERIOD_START -> {
                    val current = period
                    if ((phase == Phase.PRE && e.period == 1) ||
                        (phase == Phase.BREAK && current != null && e.period == current + 1)
                    ) {
                        if (e.period!! > rules.periods) {
                            warn(e, "period_out_of_range")
                        } else {
                            phase = Phase.RUNNING
                            period = e.period
                            elapsedMs = 0
                            anchorAt = e.t
                            atPeriod = period
                            atElapsed = 0
                        }
                    } else {
                        warn(e, "invalid_period_start")
                    }
                }
                EventType.PERIOD_PAUSE ->
                    if (phase == Phase.RUNNING) {
                        stopClock(e.t)
                        phase = Phase.PAUSED
                    } else {
                        warn(e, "invalid_pause")
                    }
                EventType.PERIOD_RESUME ->
                    if (phase == Phase.PAUSED) {
                        phase = Phase.RUNNING
                        anchorAt = e.t
                    } else {
                        warn(e, "invalid_resume")
                    }
                EventType.PERIOD_END -> {
                    val current = period
                    if ((phase == Phase.RUNNING || phase == Phase.PAUSED) && current != null && e.period == current) {
                        stopClock(e.t)
                        phase = if (current >= rules.periods) Phase.ENDED else Phase.BREAK
                    } else {
                        warn(e, "invalid_period_end")
                    }
                }
                EventType.MATCH_END ->
                    if (phase == Phase.ENDED) {
                        warn(e, "already_finished")
                    } else {
                        if (phase == Phase.RUNNING || phase == Phase.PAUSED) stopClock(e.t)
                        phase = Phase.ENDED
                    }
                EventType.ADDED_TIME -> {
                    val target = e.period ?: period
                    if (target == null) warn(e, "added_time_before_kickoff") else added[target] = e.minutes ?: 0
                }
                EventType.GOAL -> e.team?.let { score(it) }
                // `team` is the side of the player who scored into their own net.
                EventType.OWN_GOAL -> e.team?.let { score(it.opponent) }
                EventType.YELLOW_CARD, EventType.RED_CARD -> {
                    val team = e.team
                    val number = e.playerNumber
                    if (team != null && number != null) {
                        val key = "${team.wire}:$number"
                        var entry = discipline[key] ?: PlayerDiscipline(team, number, yellow = 0, red = false, secondYellow = false)
                        entry = if (e.type == EventType.YELLOW_CARD) {
                            val yellow = entry.yellow + 1
                            if (yellow >= 2 && !entry.red) entry.copy(yellow = yellow, red = true, secondYellow = true) else entry.copy(yellow = yellow)
                        } else {
                            entry.copy(red = true)
                        }
                        discipline[key] = entry
                    }
                }
                EventType.SUBSTITUTION, EventType.NOTE, EventType.VOID -> Unit
            }

            timeline += DerivedEvent(
                id = e.id,
                type = e.type,
                team = e.team,
                playerNumber = e.playerNumber,
                playerOutNumber = e.playerOutNumber,
                playerInNumber = e.playerInNumber,
                text = e.text,
                period = e.period,
                minutes = e.minutes,
                t = e.t,
                atPeriod = atPeriod,
                minuteLabel = atPeriod?.let { Clock.minuteLabel(it, atElapsed, rules.periodMinutes) },
            )
        }

        val clock = ClockState(
            period = period,
            running = phase == Phase.RUNNING,
            elapsedMs = elapsedMs,
            anchorAt = if (phase == Phase.RUNNING) anchorAt else null,
            addedMinutes = period?.let { added[it] },
        )

        return MatchState(
            status = phase.status,
            score = Score(home, away),
            clock = clock,
            discipline = discipline.values.sortedWith(
                compareBy<PlayerDiscipline> { if (it.team == TeamSide.HOME) 0 else 1 }.thenBy { it.playerNumber },
            ),
            timeline = timeline,
            voidedEventIds = voided.sorted(),
            warnings = warnings.sortedWith(compareBy<Warning> { it.eventId }.thenBy { it.code }),
            lastSeq = events.fold(0L) { max, e -> maxOf(max, e.seq) },
        )
    }
}
