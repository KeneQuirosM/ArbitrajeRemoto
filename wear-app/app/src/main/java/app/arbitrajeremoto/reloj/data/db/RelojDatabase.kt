package app.arbitrajeremoto.reloj.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration

/**
 * Schema exported to `wear-app/app/schemas/` (checked by the CI). To change it: bump [version],
 * add a `Migration(n, n + 1)` to [MIGRATIONS] and a test that opens version n with data.
 * There is no destructive fallback: queued events must never be lost.
 */
@Database(entities = [MatchEntity::class, EventEntity::class, CacheEntity::class], version = 1, exportSchema = true)
abstract class RelojDatabase : RoomDatabase() {
    abstract fun dao(): RelojDao

    companion object {
        const val NAME = "reloj.db"

        /** Future migrations go here, in order. */
        val MIGRATIONS: Array<Migration> = arrayOf()

        fun builder(context: Context, name: String = NAME): RoomDatabase.Builder<RelojDatabase> =
            Room.databaseBuilder(context, RelojDatabase::class.java, name).addMigrations(*MIGRATIONS)
    }
}
