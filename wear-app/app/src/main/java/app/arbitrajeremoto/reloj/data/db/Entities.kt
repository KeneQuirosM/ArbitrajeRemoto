package app.arbitrajeremoto.reloj.data.db

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/** Who created a row: this watch, or the server (a match opened from the web, events read back). */
object Origin {
    const val LOCAL = "LOCAL"
    const val SERVER = "SERVER"
}

/** State of `POST /matches` for a match. */
object CreateState {
    /** Still to be sent. */
    const val PENDING = "PENDING"

    /** 201 or 200 duplicate (or the match came from the server). */
    const val CREATED = "CREATED"

    /** 409 ID_CONFLICT: logged; its events are not sent. */
    const val CONFLICT = "CONFLICT"

    /** 410: deleted in the web; nothing more is sent. */
    const val DELETED = "DELETED"

    /** 422 or a 404 for a match without creation body: not sendable. */
    const val REJECTED = "REJECTED"
}

/** Queue state of an event. */
object SyncState {
    const val PENDING = "PENDING"
    const val SENT = "SENT"

    /** Rejected by the server (final, with its reason): out of the queue, never resent. */
    const val REJECTED = "REJECTED"
}

@Entity(tableName = "matches")
data class MatchEntity(
    @PrimaryKey val id: String,
    /** Exact `POST /matches` body, stored once and always resent the same. Null for server matches. */
    val creationBody: String?,
    val homeTeamName: String,
    val awayTeamName: String,
    val homeTeamId: String?,
    val awayTeamId: String?,
    val periods: Int,
    val periodMinutes: Int,
    val origin: String,
    val createState: String,
    val createError: String?,
    val createdAtMs: Long,
    /** Highest server `seq` read for this match (for `?since=`). */
    val lastSeq: Long,
    /** Last `state` returned by the server (JSON), `serverTime` and `clockOffsetMs`: display only (guide §8). */
    val serverStateJson: String?,
    val serverTime: String?,
    val clockOffsetMs: Long?,
)

/**
 * Immutable event. Only [syncState]/[rejectReason] change. The queue is the PENDING events in
 * [queueOrder] (the order they were registered).
 */
@Entity(
    tableName = "events",
    indices = [Index("matchId"), Index(value = ["syncState", "queueOrder"])],
)
data class EventEntity(
    @PrimaryKey val id: String,
    val matchId: String,
    val type: String,
    val team: String?,
    val playerNumber: Int?,
    val playerOutNumber: Int?,
    val playerInNumber: Int?,
    val text: String?,
    val voidsEventId: String?,
    val period: Int?,
    val minutes: Int?,
    /** ISO 8601 UTC, exactly as sent. */
    val clientTimestamp: String,
    /** Effective time in epoch ms: this watch's clock for local events, the server's `t` for server events. */
    val t: Long,
    val origin: String,
    val syncState: String,
    val rejectReason: String?,
    val queueOrder: Long,
    /** Server `seq`, 0 until known. */
    val seq: Long,
)

/** Last server answers (matches of the day, teams) for offline use. */
@Entity(tableName = "cache")
data class CacheEntity(
    @PrimaryKey val key: String,
    val json: String,
    val updatedAtMs: Long,
)
