package app.arbitrajeremoto.reloj.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import app.arbitrajeremoto.reloj.api.ApiJson
import app.arbitrajeremoto.reloj.api.CreateMatchBody
import app.arbitrajeremoto.reloj.data.db.CreateState
import app.arbitrajeremoto.reloj.data.db.RelojDatabase
import app.arbitrajeremoto.reloj.data.db.SyncState
import app.arbitrajeremoto.reloj.domain.EventClock
import app.arbitrajeremoto.reloj.domain.EventDraft
import app.arbitrajeremoto.reloj.domain.EventType
import app.arbitrajeremoto.reloj.domain.MatchStatus
import app.arbitrajeremoto.reloj.domain.Score
import app.arbitrajeremoto.reloj.domain.TeamSide
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.UUID

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MatchRepositoryTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val db = Room.inMemoryDatabaseBuilder(context, RelojDatabase::class.java).allowMainThreadQueries().build()
    private var now = 1_792_944_000_000L
    private val repo = MatchRepository(db.dao(), EventClock { now }, deviceId = { "watch-1" }, now = { now })

    @After
    fun tearDown() = db.close()

    @Test
    fun `a quick match stores its exact creation body once`() = runBlocking {
        val id = repo.createQuickMatch()
        val match = db.dao().match(id)!!
        assertEquals(ApiJson.encodeToString(CreateMatchBody.serializer(), CreateMatchBody(id, "watch-1")), match.creationBody)
        assertEquals("""{"id":"$id","deviceId":"watch-1"}""", match.creationBody)
        assertEquals(CreateState.PENDING, match.createState)
        assertEquals("Local", match.homeTeamName)
        assertEquals(MatchStatus.SCHEDULED, repo.observeMatch(id).first()!!.state.status)
    }

    @Test
    fun `events are validated, timestamped strictly increasing and derive the score at once`() = runBlocking {
        val id = repo.createQuickMatch()
        assertTrue(repo.record(id, EventDraft(EventType.PERIOD_START, period = 1)).isSuccess)
        // Same millisecond (double tap): still strictly increasing
        val goal = repo.record(id, EventDraft(EventType.GOAL, team = TeamSide.HOME, playerNumber = 9)).getOrThrow()
        now += 60_000
        repo.record(id, EventDraft(EventType.YELLOW_CARD, team = TeamSide.AWAY, playerNumber = 4))
        repo.record(id, EventDraft(EventType.YELLOW_CARD, team = TeamSide.AWAY, playerNumber = 4))

        val rejected = repo.record(id, EventDraft(EventType.GOAL, team = TeamSide.HOME, playerNumber = 100))
        assertEquals("invalid_playerNumber", rejected.exceptionOrNull()?.message)
        assertEquals("period_out_of_range", repo.record(id, EventDraft(EventType.PERIOD_START, period = 3)).exceptionOrNull()?.message)

        val view = repo.observeMatch(id).first()!!
        val ts = view.events.sortedBy { it.queueOrder }.map { it.t }
        assertEquals(listOf(now - 60_000, now - 60_000 + 1, now, now + 1), ts)
        assertEquals("2026-10-25T16:00:00.000Z", view.events.minByOrNull { it.t }!!.clientTimestamp)
        assertEquals(Score(1, 0), view.state.score)
        assertTrue(view.state.discipline.single().secondYellow)
        assertEquals(5, view.pendingCount) // creation + 4 events

        repo.record(id, EventDraft(EventType.VOID, voidsEventId = goal))
        assertEquals(Score(0, 0), repo.observeMatch(id).first()!!.state.score)
    }

    @Test
    fun `rejected events are kept but do not count`() = runBlocking {
        val id = repo.createQuickMatch()
        repo.record(id, EventDraft(EventType.PERIOD_START, period = 1))
        val goal = repo.record(id, EventDraft(EventType.GOAL, team = TeamSide.AWAY)).getOrThrow()
        db.dao().markRejected(goal, "timestamp_too_old")
        val view = repo.observeMatch(id).first()!!
        assertEquals(Score(0, 0), view.state.score)
        assertEquals(1, view.rejectedCount)
        assertEquals(SyncState.REJECTED, view.events.first { it.id == goal }.syncState)
    }

    @Test
    fun `after a restart timestamps never go back`() = runBlocking {
        val id = repo.createQuickMatch()
        now += 10_000
        repo.record(id, EventDraft(EventType.PERIOD_START, period = 1))
        now -= 60_000 // clock moved back while the app was closed
        val restarted = MatchRepository(db.dao(), EventClock { now }, deviceId = { "watch-1" }, now = { now }, newId = { UUID.randomUUID().toString() })
        restarted.record(id, EventDraft(EventType.PERIOD_PAUSE))
        val ts = db.dao().events(id).sortedBy { it.queueOrder }.map { it.t }
        assertEquals(ts[0] + 1, ts[1])
    }
}
