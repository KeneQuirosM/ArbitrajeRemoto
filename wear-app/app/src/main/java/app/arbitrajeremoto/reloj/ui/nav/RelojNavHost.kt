package app.arbitrajeremoto.reloj.ui.nav

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.wear.compose.material3.AppScaffold
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import app.arbitrajeremoto.reloj.R
import app.arbitrajeremoto.reloj.domain.EventDraft
import app.arbitrajeremoto.reloj.domain.EventType
import app.arbitrajeremoto.reloj.domain.TeamSide
import app.arbitrajeremoto.reloj.ui.MainViewModel
import app.arbitrajeremoto.reloj.ui.StartDestination
import app.arbitrajeremoto.reloj.ui.home.HomeScreen
import app.arbitrajeremoto.reloj.ui.match.AddedTimeScreen
import app.arbitrajeremoto.reloj.ui.match.ClockRareScreen
import app.arbitrajeremoto.reloj.ui.match.MatchScreen
import app.arbitrajeremoto.reloj.ui.match.MatchViewModel
import app.arbitrajeremoto.reloj.ui.match.MoreScreen
import app.arbitrajeremoto.reloj.ui.match.NumberPickerScreen
import app.arbitrajeremoto.reloj.ui.match.UndoScreen
import app.arbitrajeremoto.reloj.ui.match.WithMatch
import app.arbitrajeremoto.reloj.ui.match.eventName
import app.arbitrajeremoto.reloj.ui.match.rememberNow
import app.arbitrajeremoto.reloj.ui.match.teamName
import app.arbitrajeremoto.reloj.ui.pairing.PairScreen
import app.arbitrajeremoto.reloj.ui.server.ServerMatchesScreen
import app.arbitrajeremoto.reloj.ui.server.ServerViewModel
import app.arbitrajeremoto.reloj.ui.match.RosterPlayer
import app.arbitrajeremoto.reloj.ui.components.WideButton
import app.arbitrajeremoto.reloj.data.MatchView
import app.arbitrajeremoto.reloj.data.RemoteRepository
import kotlinx.coroutines.delay
import app.arbitrajeremoto.reloj.ui.settings.SettingsScreen

/** How often an open match reads new server events. */
private const val REFRESH_MS = 20_000L

object Routes {
    const val LOADING = "loading"
    const val PAIR = "pair"
    const val HOME = "home"
    const val SETTINGS = "settings"
    const val MATCH = "match/{id}"
    const val PICK = "pick/{id}/{type}/{team}"
    const val SUB_OUT = "subout/{id}/{team}"
    const val SUB_IN = "subin/{id}/{team}/{out}"
    const val MORE = "more/{id}"
    const val ADDED = "added/{id}"
    const val CLOCK = "clock/{id}"
    const val UNDO = "undo/{id}"
    const val SERVER = "server"

    fun match(id: String) = "match/$id"
    fun pick(id: String, type: String, team: TeamSide) = "pick/$id/$type/${team.wire}"
    fun subOut(id: String, team: TeamSide) = "subout/$id/${team.wire}"
    fun subIn(id: String, team: TeamSide, out: Int) = "subin/$id/${team.wire}/$out"
    fun more(id: String) = "more/$id"
    fun added(id: String) = "added/$id"
    fun clock(id: String) = "clock/$id"
    fun undo(id: String) = "undo/$id"
}

/** Swipe right (and the back button) goes back one screen. */
@Composable
fun RelojNavHost(viewModel: MainViewModel) {
    val navController = rememberSwipeDismissableNavController()
    val start by viewModel.start.collectAsState()
    val settings by viewModel.settings.collectAsState()
    // Activity-scoped, shared by the match screen and its pickers
    val matchViewModel: MatchViewModel = viewModel()
    val serverViewModel: ServerViewModel = viewModel()
    val teams by serverViewModel.teams.collectAsState()
    // Shirt numbers with names when the match side has a roster (block R4)
    val rosterOf: (MatchView, TeamSide) -> List<RosterPlayer> = { view, side ->
        teams?.value?.teams?.let { RemoteRepository.roster(it, view.match, side) }.orEmpty()
    }

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

    val backToMatch: () -> Unit = { navController.popBackStack(Routes.MATCH, inclusive = false) }
    fun record(id: String, draft: EventDraft) {
        matchViewModel.record(id, draft)
        backToMatch()
    }

    AppScaffold {
        SwipeDismissableNavHost(navController = navController, startDestination = Routes.LOADING) {
            composable(Routes.LOADING) { }
            composable(Routes.PAIR) {
                PairScreen(revoked = (start as? StartDestination.Pair)?.revoked == true, onPaired = viewModel::onPaired)
            }
            composable(Routes.HOME) {
                val matches by matchViewModel.matches.collectAsState()
                HomeScreen(
                    matches = matches,
                    now = rememberNow(),
                    onQuickMatch = { matchViewModel.createQuickMatch { navController.navigate(Routes.match(it)) } },
                    onOpenMatch = { navController.navigate(Routes.match(it)) },
                    onSettings = { navController.navigate(Routes.SETTINGS) },
                    extraItems = {
                        item {
                            WideButton(stringResource(R.string.home_server_matches), {
                                serverViewModel.refresh()
                                navController.navigate(Routes.SERVER)
                            })
                        }
                    },
                )
            }
            composable(Routes.SERVER) {
                val list by serverViewModel.todayMatches.collectAsState()
                val busy by serverViewModel.busy.collectAsState()
                val error by serverViewModel.error.collectAsState()
                ServerMatchesScreen(
                    list = list,
                    busy = busy,
                    error = error,
                    onRefresh = serverViewModel::refresh,
                    onOpen = { id -> serverViewModel.open(id) { navController.navigate(Routes.match(it)) } },
                )
            }
            composable(Routes.SETTINGS) {
                SettingsScreen(
                    settings = settings,
                    onServer = { viewModel.setServerUrl(it) },
                    onPairAgain = viewModel::pairAgain,
                )
            }
            composable(Routes.MATCH) { entry ->
                val id = entry.arguments?.getString("id").orEmpty()
                val online by viewModel.online.collectAsState()
                // While the match is open and there is network, read what the web added (?since=lastSeq)
                LaunchedEffect(id, online) {
                    while (online) {
                        serverViewModel.refreshEvents(id)
                        delay(REFRESH_MS)
                    }
                }
                MatchScreen(
                    viewModel = matchViewModel,
                    matchId = id,
                    online = online,
                    onPick = { type, team -> navController.navigate(Routes.pick(id, type, team)) },
                    onMore = { navController.navigate(Routes.more(id)) },
                    onClockRare = { navController.navigate(Routes.clock(id)) },
                    onUndo = { navController.navigate(Routes.undo(id)) },
                )
            }
            composable(Routes.PICK) { entry ->
                val id = entry.arguments?.getString("id").orEmpty()
                val type = EventType.fromWire(entry.arguments?.getString("type")) ?: EventType.GOAL
                val team = TeamSide.fromWire(entry.arguments?.getString("team")) ?: TeamSide.HOME
                WithMatch(matchViewModel, id) { view ->
                    NumberPickerScreen(
                        title = stringResource(R.string.picker_title, stringResource(eventName(type)), view.teamName(team)),
                        roster = rosterOf(view, team),
                        allowNone = true,
                        onPick = { number -> record(id, EventDraft(type, team = team, playerNumber = number)) },
                    )
                }
            }
            composable(Routes.SUB_OUT) { entry ->
                val id = entry.arguments?.getString("id").orEmpty()
                val team = TeamSide.fromWire(entry.arguments?.getString("team")) ?: TeamSide.HOME
                WithMatch(matchViewModel, id) { view ->
                    NumberPickerScreen(
                        title = stringResource(R.string.picker_sub_out, view.teamName(team)),
                        roster = rosterOf(view, team),
                        allowNone = false,
                        onPick = { out -> if (out != null) navController.navigate(Routes.subIn(id, team, out)) },
                    )
                }
            }
            composable(Routes.SUB_IN) { entry ->
                val id = entry.arguments?.getString("id").orEmpty()
                val team = TeamSide.fromWire(entry.arguments?.getString("team")) ?: TeamSide.HOME
                val out = entry.arguments?.getString("out")?.toIntOrNull() ?: 0
                WithMatch(matchViewModel, id) { view ->
                    NumberPickerScreen(
                        title = stringResource(R.string.picker_sub_in, view.teamName(team), out),
                        roster = rosterOf(view, team),
                        allowNone = false,
                        exclude = out,
                        onPick = { inn ->
                            if (inn != null) {
                                record(id, EventDraft(EventType.SUBSTITUTION, team = team, playerOutNumber = out, playerInNumber = inn))
                            }
                        },
                    )
                }
            }
            composable(Routes.MORE) { entry ->
                val id = entry.arguments?.getString("id").orEmpty()
                WithMatch(matchViewModel, id) { view ->
                    MoreScreen(
                        view = view,
                        onOwnGoal = { navController.navigate(Routes.pick(id, EventType.OWN_GOAL.wire, it)) },
                        onSubstitution = { navController.navigate(Routes.subOut(id, it)) },
                        onAddedTime = { navController.navigate(Routes.added(id)) },
                    )
                }
            }
            composable(Routes.ADDED) { entry ->
                val id = entry.arguments?.getString("id").orEmpty()
                WithMatch(matchViewModel, id) { view ->
                    AddedTimeScreen { minutes ->
                        record(id, EventDraft(EventType.ADDED_TIME, minutes = minutes, period = view.state.clock.period))
                    }
                }
            }
            composable(Routes.CLOCK) { entry ->
                val id = entry.arguments?.getString("id").orEmpty()
                WithMatch(matchViewModel, id) { view ->
                    ClockRareScreen(view, onAction = { record(id, it.toDraft()) }, onCancel = backToMatch)
                }
            }
            composable(Routes.UNDO) { entry ->
                val id = entry.arguments?.getString("id").orEmpty()
                WithMatch(matchViewModel, id) { view ->
                    UndoScreen(
                        view,
                        onUndo = { target -> record(id, EventDraft(EventType.VOID, voidsEventId = target)) },
                        onCancel = backToMatch,
                    )
                }
            }
        }
    }
}
