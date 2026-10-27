package app.arbitrajeremoto.reloj.data.db

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RelojDatabaseTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val name = "reloj-test.db"

    @After
    fun tearDown() {
        context.deleteDatabase(name)
    }

    @Test
    fun `the real builder keeps data across reopenings (no destructive fallback)`() = runBlocking {
        val first = RelojDatabase.builder(context, name).allowMainThreadQueries().build()
        first.dao().insertMatch(
            MatchEntity("m1", "{}", "Local", "Visitante", null, null, 2, 45, Origin.LOCAL, CreateState.PENDING, null, 1, 0, null, null, null),
        )
        first.close()
        val second = RelojDatabase.builder(context, name).allowMainThreadQueries().build()
        try {
            assertEquals("m1", second.dao().match("m1")?.id)
            assertEquals(1, second.openHelper.readableDatabase.version)
        } finally {
            second.close()
        }
    }
}
