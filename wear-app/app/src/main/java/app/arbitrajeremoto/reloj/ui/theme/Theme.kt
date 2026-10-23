package app.arbitrajeremoto.reloj.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.ColorScheme
import androidx.wear.compose.material3.MaterialTheme

/** Dark only (AMOLED: black saves battery). Pairs used together keep ≥ 4.5:1 contrast. */
object RelojColors {
    val background = Color(0xFF000000)
    val surface = Color(0xFF1E2321)
    val textPrimary = Color(0xFFE6E8E6)
    val textMuted = Color(0xFFA9B0AC)

    val primary = Color(0xFF8BD8A0)
    val onPrimary = Color(0xFF00391A)
    val primaryContainer = Color(0xFF1B5E30)
    val onPrimaryContainer = Color(0xFFC8F5D2)

    val home = Color(0xFF1E4F8C)
    val away = Color(0xFF7A2E8C)
    val onTeam = Color(0xFFFFFFFF)
    val yellow = Color(0xFFF2C94C)
    val onYellow = Color(0xFF2B2100)
    val red = Color(0xFFB3261E)
    val onRed = Color(0xFFFFFFFF)

    val synced = Color(0xFF7EE2A8)
    val pending = Color(0xFFF6C98A)
    val offline = Color(0xFF8A9094)

    val error = Color(0xFFF2B8B5)
    val onError = Color(0xFF601410)
}

object RelojType {
    val caption = 12.sp
    val label = 14.sp
    val body = 15.sp
    val title = 16.sp
    val score = 30.sp
    val code = 34.sp
}

private val RelojColorScheme = ColorScheme(
    primary = RelojColors.primary,
    onPrimary = RelojColors.onPrimary,
    primaryContainer = RelojColors.primaryContainer,
    onPrimaryContainer = RelojColors.onPrimaryContainer,
    background = RelojColors.background,
    onBackground = RelojColors.textPrimary,
    onSurface = RelojColors.textPrimary,
    onSurfaceVariant = RelojColors.textMuted,
    error = RelojColors.error,
    onError = RelojColors.onError,
)

@Composable
fun RelojTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = RelojColorScheme, content = content)
}
