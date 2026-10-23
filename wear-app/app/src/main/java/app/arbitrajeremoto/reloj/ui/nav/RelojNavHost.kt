package app.arbitrajeremoto.reloj.ui.nav

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.wear.compose.material3.AppScaffold
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import app.arbitrajeremoto.reloj.ui.MainViewModel
import app.arbitrajeremoto.reloj.ui.StartDestination
import app.arbitrajeremoto.reloj.ui.home.HomeScreen
import app.arbitrajeremoto.reloj.ui.pairing.PairScreen
import app.arbitrajeremoto.reloj.ui.settings.SettingsScreen

object Routes {
    const val LOADING = "loading"
    const val PAIR = "pair"
    const val HOME = "home"
    const val SETTINGS = "settings"
}

/** Swipe right (and the back button) goes back one screen. */
@Composable
fun RelojNavHost(viewModel: MainViewModel) {
    val navController = rememberSwipeDismissableNavController()
    val start by viewModel.start.collectAsState()
    val settings by viewModel.settings.collectAsState()

    LaunchedEffect(start) {
        val route = when (start) {
            StartDestination.Loading -> return@LaunchedEffect
            is StartDestination.Pair -> Routes.PAIR
            StartDestination.Home -> Routes.HOME
        }
        navController.navigate(route) {
            popUpTo(navController.graph.id) { inclusive = true }
            launchSingleTop = true
        }
    }

    AppScaffold {
        SwipeDismissableNavHost(navController = navController, startDestination = Routes.LOADING) {
            composable(Routes.LOADING) { }
            composable(Routes.PAIR) {
                PairScreen(revoked = (start as? StartDestination.Pair)?.revoked == true, onPaired = viewModel::onPaired)
            }
            composable(Routes.HOME) {
                HomeScreen(onSettings = { navController.navigate(Routes.SETTINGS) })
            }
            composable(Routes.SETTINGS) {
                SettingsScreen(
                    settings = settings,
                    onServer = { viewModel.setServerUrl(it) },
                    onPairAgain = viewModel::pairAgain,
                )
            }
        }
    }
}
