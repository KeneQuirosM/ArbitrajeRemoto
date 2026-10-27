package app.arbitrajeremoto.reloj.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * Background sending with WorkManager (guide §2, §7.4): one unique job with the CONNECTED
 * constraint. The retry delays (5 s … 5 min, or Retry-After) are scheduled here as the job's
 * initial delay, because WorkManager's own backoff cannot go below 10 s.
 */
class SyncScheduler(private val context: Context) {

    fun schedule(delayMs: Long) {
        val request = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setInitialDelay(delayMs.coerceAtLeast(0), TimeUnit.MILLISECONDS)
            // Only for a crash inside the worker; normal retries are rescheduled explicitly
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.REPLACE, request)
    }

    companion object {
        const val WORK_NAME = "arbitraje-sync"
    }
}
