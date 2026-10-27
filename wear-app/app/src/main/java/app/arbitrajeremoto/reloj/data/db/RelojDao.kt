package app.arbitrajeremoto.reloj.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
abstract class RelojDao {
    // --- matches

    @Insert(onConflict = OnConflictStrategy.ABORT)
    abstract suspend fun insertMatch(match: MatchEntity)

    @Upsert
    abstract suspend fun upsertMatch(match: MatchEntity)

    @Query("SELECT * FROM matches WHERE id = :id")
    abstract suspend fun match(id: String): MatchEntity?

    @Query("SELECT * FROM matches WHERE id = :id")
    abstract fun observeMatch(id: String): Flow<MatchEntity?>

    @Query("SELECT * FROM matches ORDER BY createdAtMs DESC")
    abstract fun observeMatches(): Flow<List<MatchEntity>>

    @Query("UPDATE matches SET createState = :state, createError = :error WHERE id = :id")
    abstract suspend fun setCreateState(id: String, state: String, error: String?)

    @Query("UPDATE matches SET serverStateJson = :stateJson, serverTime = :serverTime, clockOffsetMs = :clockOffsetMs WHERE id = :id")
    abstract suspend fun saveServerSnapshot(id: String, stateJson: String, serverTime: String, clockOffsetMs: Long?)

    @Query("UPDATE matches SET lastSeq = :lastSeq WHERE id = :id AND lastSeq < :lastSeq")
    abstract suspend fun raiseLastSeq(id: String, lastSeq: Long)

    // --- events

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    abstract suspend fun insertEvent(event: EventEntity): Long

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    abstract suspend fun insertEvents(events: List<EventEntity>): List<Long>

    @Query("SELECT * FROM events WHERE matchId = :matchId")
    abstract suspend fun events(matchId: String): List<EventEntity>

    @Query("SELECT * FROM events WHERE matchId = :matchId")
    abstract fun observeEvents(matchId: String): Flow<List<EventEntity>>

    @Query("SELECT * FROM events")
    abstract fun observeAllEvents(): Flow<List<EventEntity>>

    @Query("SELECT COALESCE(MAX(queueOrder), 0) FROM events")
    abstract suspend fun maxQueueOrder(): Long

    @Query("SELECT MAX(t) FROM events WHERE origin = 'LOCAL'")
    abstract suspend fun maxLocalT(): Long?

    /** Adds a local event at the end of the queue. */
    @Transaction
    open suspend fun enqueue(event: EventEntity) {
        insertEvent(event.copy(queueOrder = maxQueueOrder() + 1, syncState = SyncState.PENDING))
    }

    // --- queue

    @Query("SELECT * FROM events WHERE matchId = :matchId AND syncState = 'PENDING' ORDER BY queueOrder LIMIT :limit")
    abstract suspend fun pendingEvents(matchId: String, limit: Int): List<EventEntity>

    @Query("SELECT COUNT(*) FROM events WHERE syncState = 'PENDING'")
    abstract fun observePendingCount(): Flow<Int>

    /** Matches with something to send: their creation, or pending events (not deleted/conflicting ones). */
    @Query(
        "SELECT * FROM matches WHERE createState = 'PENDING' OR (createState = 'CREATED' AND id IN " +
            "(SELECT DISTINCT matchId FROM events WHERE syncState = 'PENDING')) ORDER BY createdAtMs",
    )
    abstract suspend fun matchesWithWork(): List<MatchEntity>

    @Query("UPDATE events SET syncState = 'SENT' WHERE id IN (:ids) AND syncState = 'PENDING'")
    abstract suspend fun markSent(ids: List<String>)

    @Query("UPDATE events SET syncState = 'REJECTED', rejectReason = :reason WHERE id = :id AND syncState = 'PENDING'")
    abstract suspend fun markRejected(id: String, reason: String)

    @Query("UPDATE events SET seq = :seq WHERE id = :id")
    abstract suspend fun setSeq(id: String, seq: Long)

    // --- cache

    @Upsert
    abstract suspend fun putCache(entry: CacheEntity)

    @Query("SELECT * FROM cache WHERE `key` = :key")
    abstract suspend fun cache(key: String): CacheEntity?

    @Query("SELECT * FROM cache WHERE `key` = :key")
    abstract fun observeCache(key: String): Flow<CacheEntity?>
}
