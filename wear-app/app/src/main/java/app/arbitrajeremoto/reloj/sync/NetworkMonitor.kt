package app.arbitrajeremoto.reloj.sync

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Whether the watch has internet (through the phone over Bluetooth, Wi-Fi or a hotspot;
 * Wear OS switches by itself). Only used for the grey dot and to send at once when it returns.
 */
class NetworkMonitor(context: Context, private val onAvailable: () -> Unit) {
    private val connectivity = context.getSystemService(ConnectivityManager::class.java)
    private val _online = MutableStateFlow(isOnlineNow())
    val online: StateFlow<Boolean> = _online.asStateFlow()

    fun start() {
        connectivity?.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                val wasOnline = _online.value
                _online.value = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                if (_online.value && !wasOnline) onAvailable()
            }

            override fun onLost(network: Network) {
                _online.value = false
            }
        })
    }

    private fun isOnlineNow(): Boolean {
        val caps = connectivity?.getNetworkCapabilities(connectivity.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }
}
