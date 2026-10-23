package app.arbitrajeremoto.reloj.data.db

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** SDK 34: Robolectric's SDK 35 image needs JDK 21. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RelojDaoTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val db = Room.inMemoryDatabaseBuilder(context, RelojDatabase::class.java).allowMainThreadQueries().build()
    private val dao = db.dao()

    @After
    fun tearDown() = db.close()

    private fun match(id: String, state: String = CreateState.PENDING, at: Long = 1) = MatchEntity(
        id, """{"id":"$id","deviceId":"watch-1"}""", "Local", "Visitante", null, null, 2, 45,
        Origin.LOCAL, state, null, at, 0, null, null, null,
    )

    private fun event(id: String, matchId: String, t: Long) = EventEntity(
        id, matchId, "goal", "home", 9, null, null, null, null, null, null, "2026-10-25T16:00:00.000Z", t,
        Origin.LOCAL, SyncState.PENDING, null, 0, 0,
    )

    @Test
    fun `the queue keeps registration order and only pending events`() = runBlocking {
        dao.insertMatch(match("m1"))
        dao.enqueue(event("e2", "m1", 2_000))
        dao.enqueue(event("e1", "m1", 1_000))
        dao.enqueue(event("e3", "m1", 3_000))
        assertEquals(listOf("e2", "e1", "e3"), dao.pendingEvents("m1", 200).map { it.id })
        assertEquals(listOf(1L, 2L, 3L), dao.pendingEvents("m1", 200).map { it.queueOrder })
        assertEquals(listOf("e2"), dao.pendingEvents("m1", 1).map { it.id })

        dao.markSent(listOf("e2"))
        dao.markRejected("e1", "invalid_playerNumber")
        assertEquals(listOf("e3"), dao.pendingEvents("m1", 200).map { it.id })
        assertEquals(1, dao.observePendingCount().first())
        val rejected = dao.events("m1").first { it.id == "e1" }
        assertEquals(SyncState.REJECTED, rejected.syncState)
        assertEquals("invalid_playerNumber", rejected.rejectReason)
        // A rejected event is final: markSent does not bring it back
        dao.markSent(listOf("e1"))
        assertEquals(SyncState.REJECTED, dao.events("m1").first { it.id == "e1" }.syncState)
    }

    @Test
    fun `events are immutable - a second insert with the same id is ignored`() = runBlocking {
        dao.insertMatch(match("m1"))
        dao.enqueue(event("e1", "m1", 1_000))
        dao.enqueue(event("e1", "m1", 9_999).copy(playerNumber = 10))
        val stored = dao.events("m1").single()
        assertEquals(9, stored.playerNumber)
        assertEquals(1_000L, stored.t)
        assertEquals(1_000L, dao.maxLocalT())
    }

    @Test
    fun `matches with work - pending creation or pending events, never deleted or conflicting ones`() = runBlocking {
        dao.insertMatch(match("a", CreateState.PENDING, at = 1))
        dao.insertMatch(match("b", CreateState.CREATED, at = 2))
        dao.insertMatch(match("c", CreateState.CREATED, at = 3))
        dao.insertMatch(match("d", CreateState.DELETED, at = 4))
        dao.insertMatch(match("e", CreateState.CONFLICT, at = 5))
        dao.enqueue(event("e1", "b", 1))
        dao.enqueue(event("e2", "d", 1))
        dao.enqueue(event("e3", "e", 1))
        assertEquals(listOf("a", "b"), dao.matchesWithWork().map { it.id })

        dao.setCreateState("a", CreateState.CREATED, null)
        dao.markSent(listOf("e1"))
        assertEquals(emptyList<String>(), dao.matchesWithWork().map { it.id })
    }

    @Test
    fun `server snapshot, lastSeq and cache`() = runBlocking {
        dao.insertMatch(match("m1"))
        dao.saveServerSnapshot("m1", """{"status":"live"}""", "2026-10-25T16:40:00.120Z", 0)
        dao.raiseLastSeq("m1", 7)
        dao.raiseLastSeq("m1", 3)
        val m = dao.match("m1")!!
        assertEquals("2026-10-25T16:40:00.120Z", m.serverTime)
        assertEquals(7L, m.lastSeq)
        assertNull(dao.cache("teams"))
        dao.putCache(CacheEntity("teams", "[]", 5))
        dao.putCache(CacheEntity("teams", "[1]", 6))
        assertEquals("[1]", dao.cache("teams")!!.json)
    }
}
