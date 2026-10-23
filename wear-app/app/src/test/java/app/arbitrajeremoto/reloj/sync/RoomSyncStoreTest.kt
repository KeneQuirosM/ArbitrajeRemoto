package app.arbitrajeremoto.reloj.sync

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import app.arbitrajeremoto.reloj.api.ApiResult
import app.arbitrajeremoto.reloj.api.CompactStateDto
import app.arbitrajeremoto.reloj.api.CreateMatchResponse
import app.arbitrajeremoto.reloj.api.EventBatchBody
import app.arbitrajeremoto.reloj.api.EventBatchResponse
import app.arbitrajeremoto.reloj.api.EventResultDto
import app.arbitrajeremoto.reloj.api.MatchDto
import app.arbitrajeremoto.reloj.api.ScoreDto
import app.arbitrajeremoto.reloj.data.MatchRepository
import app.arbitrajeremoto.reloj.data.db.CreateState
import app.arbitrajeremoto.reloj.data.db.RelojDatabase
import app.arbitrajeremoto.reloj.data.db.SyncState
import app.arbitrajeremoto.reloj.domain.EventClock
import app.arbitrajeremoto.reloj.domain.EventDraft
import app.arbitrajeremoto.reloj.domain.EventType
import app.arbitrajeremoto.reloj.domain.TeamSide
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The real engine on the real Room queue: creation, batch, results and the 401 rule. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RoomSyncStoreTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val db = Room.inMemoryDatabaseBuilder(context, RelojDatabase::class.java).allowMainThreadQueries().build()
    private var now = 1_792_944_000_000L
    private val repo = MatchRepository(db.dao(), EventClock { now }, deviceId = { "watch-1" }, now = { now })
    private val state = CompactStateDto("live", ScoreDto(1, 0))

    private class Api(val unauthorized: Boolean = false, val rejectSecond: Boolean = false) : SyncApi {
        val bodies = mutableListOf<String>()
        val batches = mutableListOf<EventBatchBody>()
        override suspend fun createMatch(rawBody: String): ApiResult<CreateMatchResponse> {
            bodies += rawBody
            if (unauthorized) return ApiResult.HttpError(401, "UNAUTHORIZED", "")
            return ApiResult.Ok(201, CreateMatchResponse(MatchDto("x", homeTeamName = "Local", awayTeamName = "Visitante"), CompactStateDto("scheduled", ScoreDto(0, 0))))
        }

        override suspend fun postEvents(matchId: String, body: EventBatchBody): ApiResult<EventBatchResponse> {
            batches += body
            return ApiResult.Ok(
                200,
                EventBatchResponse(
                    body.events.mapIndexed { i, e -> if (rejectSecond && i == 1) EventResultDto(e.id, "rejected", "timestamp_too_old") else EventResultDto(e.id, "accepted") },
                    CompactStateDto("live", ScoreDto(1, 0)),
                    0,
                    "2026-10-25T16:40:00.120Z",
                ),
            )
        }
    }

    @After
    fun tearDown() = db.close()

    @Test
    fun `sends the stored creation body, then the queue in order, and records results`() = runBlocking {
        val id = repo.createQuickMatch()
        repo.record(id, EventDraft(EventType.PERIOD_START, period = 1))
        repo.record(id, EventDraft(EventType.GOAL, team = TeamSide.HOME, playerNumber = 9))
        repo.record(id, EventDraft(EventType.YELLOW_CARD, team = TeamSide.AWAY))
        val api = Api(rejectSecond = true)
        assertEquals(SyncOutcome.Done, SyncEngine(RoomSyncStore(db.dao()), api, now = { now }).syncOnce())

        val match = db.dao().match(id)!!
        assertEquals(listOf(match.creationBody), api.bodies)
        assertEquals(CreateState.CREATED, match.createState)
        assertEquals(listOf("period_start", "goal", "yellow_card"), api.batches.single().events.map { it.type })
        assertEquals("""{"status":"live","score":{"home":1,"away":0}}""", match.serverStateJson)
        val events = db.dao().events(id).sortedBy { it.queueOrder }
        assertEquals(listOf(SyncState.SENT, SyncState.REJECTED, SyncState.SENT), events.map { it.syncState })
        assertEquals("timestamp_too_old", events[1].rejectReason)
        assertEquals(state.score, ScoreDto(1, 0))
    }

    @Test
    fun `401 keeps the creation and the events queued`() = runBlocking {
        val id = repo.createQuickMatch()
        repo.record(id, EventDraft(EventType.PERIOD_START, period = 1))
        assertEquals(SyncOutcome.Unauthorized, SyncEngine(RoomSyncStore(db.dao()), Api(unauthorized = true)).syncOnce())
        assertEquals(CreateState.PENDING, db.dao().match(id)!!.createState)
        assertEquals(SyncState.PENDING, db.dao().events(id).single().syncState)
    }
}
