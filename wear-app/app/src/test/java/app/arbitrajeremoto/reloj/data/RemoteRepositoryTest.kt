package app.arbitrajeremoto.reloj.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import app.arbitrajeremoto.reloj.api.ApiClient
import app.arbitrajeremoto.reloj.api.ApiResult
import app.arbitrajeremoto.reloj.api.HttpRequest
import app.arbitrajeremoto.reloj.api.HttpResponse
import app.arbitrajeremoto.reloj.api.HttpTransport
import app.arbitrajeremoto.reloj.data.db.CreateState
import app.arbitrajeremoto.reloj.data.db.Origin
import app.arbitrajeremoto.reloj.data.db.RelojDatabase
import app.arbitrajeremoto.reloj.data.db.SyncState
import app.arbitrajeremoto.reloj.domain.EventClock
import app.arbitrajeremoto.reloj.domain.MatchStatus
import app.arbitrajeremoto.reloj.domain.Score
import app.arbitrajeremoto.reloj.domain.TeamSide
import app.arbitrajeremoto.reloj.ui.match.RosterPlayer
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.IOException

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RemoteRepositoryTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val db = Room.inMemoryDatabaseBuilder(context, RelojDatabase::class.java).allowMainThreadQueries().build()
    private val answers = mutableMapOf<String, String>()
    private val urls = mutableListOf<String>()
    private var offline = false
    private val transport = HttpTransport { r: HttpRequest ->
        urls += r.url.removePrefix(BASE)
        if (offline) throw IOException("offline")
        HttpResponse(200, emptyMap(), answers[r.url.removePrefix(BASE)] ?: error("no answer for ${r.url}"))
    }
    private val repo = RemoteRepository(db.dao(), ApiClient({ BASE }, transport, { "ark1_k_s" }), now = { 5_000 })

    private val matchId = "0b0e3a1c-0000-4000-8000-000000000001"
    private val home = "11111111-0000-4000-8000-000000000001"
    private val k = 1_792_944_000_000L

    private fun event(id: Int, type: String, seq: Int, t: Long, extra: String = "") =
        """{"id":"00000000-0000-4000-8000-00000000000$id","type":"$type","clientTimestamp":"2026-10-25T16:00:00.000Z","seq":$seq,"t":$t,"matchId":"$matchId","deviceId":"web-1","createdAt":"x","clockOffsetMs":0$extra}"""

    @After
    fun tearDown() = db.close()

    @Test
    fun `today's matches and teams are stored for offline use`() = runBlocking {
        answers["/matches?status=scheduled,live&fields=homeTeamName,awayTeamName,scheduledAt,status,score,periods,periodMinutes"] =
            """{"matches":[{"id":"$matchId","homeTeamName":"Halcones","awayTeamName":"Toros","scheduledAt":"2026-10-25T16:00:00.000Z","status":"scheduled","score":{"home":0,"away":0},"periods":2,"periodMinutes":45}],"serverTime":"2026-10-25T15:00:00.000Z"}"""
        answers["/teams"] = """{"teams":[{"id":"$home","name":"Halcones","players":[{"id":"p1","number":9,"name":"Delantera"},{"id":"p2","number":1,"name":null}],"createdAt":"x","updatedAt":"x"}]}"""
        assertTrue(repo.refreshTodayMatches() is ApiResult.Ok)
        assertTrue(repo.refreshTeams() is ApiResult.Ok)
        offline = true
        assertTrue(repo.refreshTodayMatches() is ApiResult.NetworkError)
        val cached = repo.observeTodayMatches().first()!!
        assertEquals("Halcones", cached.value.matches.single().homeTeamName)
        assertEquals(5_000L, cached.updatedAtMs)
        val teams = repo.observeTeams().first()!!.value.teams
        assertEquals(listOf(RosterPlayer(1, null), RosterPlayer(9, "Delantera")), RemoteRepository.roster(teams, matchEntity(), TeamSide.HOME))
        assertEquals(emptyList<RosterPlayer>(), RemoteRepository.roster(teams, matchEntity(), TeamSide.AWAY))
    }

    private fun matchEntity() = app.arbitrajeremoto.reloj.data.db.MatchEntity(
        matchId, null, "Halcones", "Toros", home, null, 2, 45, Origin.SERVER, CreateState.CREATED, null, 0, 0, null, null, null,
    )

    @Test
    fun `a web match is opened with its events, then only new ones are read`() = runBlocking {
        answers["/matches/$matchId?include=events"] =
            """{"match":{"id":"$matchId","homeTeamId":"$home","awayTeamId":null,"homeTeamName":"Halcones","awayTeamName":"Toros","periods":2,"periodMinutes":45},"state":{"status":"live","score":{"home":1,"away":0},"lastSeq":2},"events":[${event(1, "period_start", 1, k, ",\"period\":1")},${event(2, "goal", 2, k + 60_000, ",\"team\":\"home\",\"playerNumber\":9")}],"serverTime":"2026-10-25T16:05:00.000Z"}"""
        answers["/matches/$matchId/events?since=2"] =
            """{"events":[${event(3, "goal", 3, k + 120_000, ",\"team\":\"away\"")}],"lastSeq":3,"state":{"status":"live","score":{"home":1,"away":1},"lastSeq":3},"serverTime":"2026-10-25T16:06:00.000Z"}"""
        assertTrue(repo.openServerMatch(matchId) is ApiResult.Ok)
        val stored = db.dao().match(matchId)!!
        assertEquals(null, stored.creationBody)
        assertEquals(CreateState.CREATED, stored.createState)
        assertEquals(home, stored.homeTeamId)
        assertEquals(2L, stored.lastSeq)

        assertTrue(repo.refreshEvents(matchId) is ApiResult.Ok)
        val view = MatchRepository.view(db.dao().match(matchId)!!, db.dao().events(matchId))
        assertEquals(MatchStatus.LIVE, view.state.status)
        assertEquals(Score(1, 1), view.state.score)
        assertEquals(0, view.pendingCount)
        assertTrue(view.events.all { it.syncState == SyncState.SENT && it.origin == Origin.SERVER })
        assertEquals(3L, db.dao().match(matchId)!!.lastSeq)
        assertEquals("/matches/$matchId/events?since=2", urls.last())

        // Opening again does not duplicate anything
        repo.openServerMatch(matchId)
        assertEquals(3, db.dao().events(matchId).size)
        assertEquals(EventClock.iso(k), "2026-10-25T16:00:00.000Z")
    }

    companion object {
        private const val BASE = "https://example.test/api/v1"
    }
}
