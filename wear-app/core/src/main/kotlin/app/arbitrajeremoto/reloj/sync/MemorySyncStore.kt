package app.arbitrajeremoto.reloj.sync

import app.arbitrajeremoto.reloj.api.EventDto

/** In-memory [SyncStore] for unit and contract tests (same contract as the Room store). Single-threaded use only. */
class MemorySyncStore : SyncStore {
    data class Match(val id: String, val creationBody: String?, var status: CreateStatus, var error: String? = null)
    data class Event(val matchId: String, val dto: EventDto, var state: String = PENDING, var reason: String? = null)

    val matches = LinkedHashMap<String, Match>()
    val events = mutableListOf<Event>()
    val snapshots = mutableMapOf<String, ServerSnapshot>()

    fun addMatch(id: String, creationBody: String?, status: CreateStatus = CreateStatus.PENDING) {
        matches[id] = Match(id, creationBody, status)
    }

    fun enqueue(matchId: String, dto: EventDto) {
        if (events.none { it.dto.id == dto.id }) events += Event(matchId, dto)
    }

    fun stateOf(id: String): String? = events.firstOrNull { it.dto.id == id }?.state

    override suspend fun matchesWithWork(): List<SyncMatch> = matches.values
        .filter { m ->
            m.status == CreateStatus.PENDING ||
                (m.status == CreateStatus.CREATED && events.any { it.matchId == m.id && it.state == PENDING })
        }
        .map { SyncMatch(it.id, it.creationBody, it.status) }

    override suspend fun pendingEvents(matchId: String, limit: Int): List<QueuedEvent> =
        events.filter { it.matchId == matchId && it.state == PENDING }.take(limit).map { QueuedEvent(it.dto.id, it.dto) }

    override suspend fun setCreateStatus(matchId: String, status: CreateStatus, error: String?) {
        matches[matchId]?.let {
            it.status = status
            it.error = error
        }
    }

    override suspend fun markSent(matchId: String, ids: List<String>) {
        events.filter { it.dto.id in ids && it.state == PENDING }.forEach { it.state = SENT }
    }

    override suspend fun markRejected(matchId: String, id: String, reason: String) {
        events.filter { it.dto.id == id && it.state == PENDING }.forEach {
            it.state = REJECTED
            it.reason = reason
        }
    }

    override suspend fun saveSnapshot(matchId: String, snapshot: ServerSnapshot) {
        snapshots[matchId] = snapshot
    }

    companion object {
        const val PENDING = "PENDING"
        const val SENT = "SENT"
        const val REJECTED = "REJECTED"
    }
}
