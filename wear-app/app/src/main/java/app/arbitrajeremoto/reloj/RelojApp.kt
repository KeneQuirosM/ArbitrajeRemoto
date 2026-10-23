package app.arbitrajeremoto.reloj

import android.app.Application
import kotlinx.coroutines.launch

class RelojApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        container.appScope.launch {
            container.settings.settings.collect { container.baseUrl = it.serverUrl }
        }
    }
}

val android.content.Context.container: AppContainer
    get() = (applicationContext as RelojApp).container
