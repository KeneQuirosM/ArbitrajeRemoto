package app.arbitrajeremoto.reloj.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import app.arbitrajeremoto.reloj.container

/** Runs one pass of the queue when there is network; the container decides when to run again. */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        applicationContext.container.syncAndReschedule()
        return Result.success()
    }
}
