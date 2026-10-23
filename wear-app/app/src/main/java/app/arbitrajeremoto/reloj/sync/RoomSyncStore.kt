package app.arbitrajeremoto.reloj.sync

import app.arbitrajeremoto.reloj.api.ApiJson
import app.arbitrajeremoto.reloj.api.CompactStateDto
import app.arbitrajeremoto.reloj.api.EventDto
import app.arbitrajeremoto.reloj.data.db.EventEntity
import app.arbitrajeremoto.reloj.data.db.RelojDao

/** [SyncStore] on the watch's Room database. Create states are stored with the same names. */
class RoomSyncStore(private val dao: RelojDao) : SyncStore {

    override suspend fun matchesWithWork(): List<SyncMatch> =
        dao.matchesWithWork().map { SyncMatch(it.id, it.creationBody, CreateStatus.valueOf(it.createState)) }

    override suspend fun pendingEvents(matchId: String, limit: Int): List<QueuedEvent> =
        dao.pendingEvents(matchId, limit).map { QueuedEvent(it.id, it.toDto()) }

    override suspend fun setCreateStatus(matchId: String, status: CreateStatus, error: String?) =
        dao.setCreateState(matchId, status.name, error)

    override suspend fun markSent(matchId: String, ids: List<String>) = dao.markSent(ids)

    override suspend fun markRejected(matchId: String, id: String, reason: String) = dao.markRejected(id, reason)

    override suspend fun saveSnapshot(matchId: String, snapshot: ServerSnapshot) =
        dao.saveServerSnapshot(
            matchId,
            ApiJson.encodeToString(CompactStateDto.serializer(), snapshot.state),
            snapshot.serverTime,
            snapshot.clockOffsetMs,
        )

    companion object {
        /** The event exactly as it was stored: resends are byte-for-byte the same content. */
        fun EventEntity.toDto() = EventDto(
            id = id,
            type = type,
            clientTimestamp = clientTimestamp,
            team = team,
            playerNumber = playerNumber,
            playerOutNumber = playerOutNumber,
            playerInNumber = playerInNumber,
            text = text,
            voidsEventId = voidsEventId,
            period = period,
            minutes = minutes,
        )
    }
}
