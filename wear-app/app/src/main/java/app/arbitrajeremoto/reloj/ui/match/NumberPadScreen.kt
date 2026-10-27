package app.arbitrajeremoto.reloj.ui.match

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.Text
import app.arbitrajeremoto.reloj.R
import app.arbitrajeremoto.reloj.ui.theme.RelojColors
import app.arbitrajeremoto.reloj.ui.theme.RelojType

/**
 * Shirt-number pad sized to the square inscribed in the round screen: a display line and a
 * 1–9 / ⌫ 0 ✓ grid. Two digits pick at once; ✓ with nothing typed is "No number" (when allowed).
 * Roster names (block R4) show under the typed number.
 */
@Composable
fun NumberPadScreen(
    title: String,
    roster: List<RosterPlayer>,
    allowNone: Boolean,
    exclude: Int? = null,
    onPick: (Int?) -> Unit,
) {
    var digits by remember { mutableStateOf("") }
    var done by remember { mutableStateOf(false) }
    fun finish(result: PadResult) {
        when (result) {
            is PadResult.Typing -> digits = result.digits
            is PadResult.Done -> if (!done) {
                done = true
                onPick(result.number)
            }
        }
    }

    // The square inscribed in a round screen is about 70% of its diameter
    val side = (LocalConfiguration.current.screenWidthDp * 0.72f).dp
    val gap = 4.dp
    val displayHeight = side * 0.22f
    val keyHeight = (side - displayHeight - gap * 4) / 4
    val keyWidth = (side - gap * 2) / 3

    Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize().background(RelojColors.background)) {
        Column(verticalArrangement = Arrangement.spacedBy(gap), modifier = Modifier.width(side)) {
            Display(digits, title, roster, allowNone, exclude, displayHeight)
            for (row in listOf(listOf(1, 2, 3), listOf(4, 5, 6), listOf(7, 8, 9))) {
                Row(horizontalArrangement = Arrangement.spacedBy(gap)) {
                    for (d in row) {
                        DigitKey(d, digits, exclude, keyWidth, keyHeight) { finish(it) }
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(gap)) {
                Key(
                    label = "⌫",
                    description = stringResource(R.string.pad_delete),
                    enabled = digits.isNotEmpty() && !done,
                    width = keyWidth,
                    height = keyHeight,
                    container = RelojColors.surface,
                    content = RelojColors.textMuted,
                ) { digits = NumberPad.delete(digits) }
                DigitKey(0, digits, exclude, keyWidth, keyHeight) { finish(it) }
                val confirmDescription = if (digits.isEmpty()) stringResource(R.string.picker_no_number) else stringResource(R.string.picker_number, digits.toInt())
                Key(
                    label = "✓",
                    description = confirmDescription,
                    enabled = NumberPad.canConfirm(digits, allowNone, exclude) && !done,
                    width = keyWidth,
                    height = keyHeight,
                    container = RelojColors.primaryContainer,
                    content = RelojColors.onPrimaryContainer,
                ) { NumberPad.confirm(digits, allowNone, exclude)?.let { finish(it) } }
            }
        }
    }
}

/** Title and hint before typing; then the number, the roster name or why ✓ is off. */
@Composable
private fun Display(digits: String, title: String, roster: List<RosterPlayer>, allowNone: Boolean, exclude: Int?, height: Dp) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
        modifier = Modifier
            .fillMaxWidth()
            .height(height)
            .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
    ) {
        if (digits.isEmpty()) {
            Text(title, fontSize = RelojType.caption, color = RelojColors.textPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
            Text(
                stringResource(if (allowNone) R.string.pad_hint_none else R.string.pad_hint),
                fontSize = RelojType.caption,
                color = RelojColors.textMuted,
                maxLines = 1,
                textAlign = TextAlign.Center,
            )
        } else {
            val number = digits.toInt()
            Text(digits, fontSize = 26.sp, fontWeight = FontWeight.Bold, color = RelojColors.textPrimary, maxLines = 1)
            val name = roster.firstOrNull { it.number == number }?.name
            when {
                number == exclude -> Text(stringResource(R.string.pad_same_player), fontSize = RelojType.caption, color = RelojColors.error, maxLines = 1)
                !name.isNullOrBlank() -> Text(name, fontSize = RelojType.caption, color = RelojColors.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
private fun DigitKey(digit: Int, digits: String, exclude: Int?, width: Dp, height: Dp, onResult: (PadResult) -> Unit) {
    Key(
        label = digit.toString(),
        description = digit.toString(),
        enabled = NumberPad.digitEnabled(digits, digit),
        width = width,
        height = height,
        container = RelojColors.surface,
        content = RelojColors.textPrimary,
    ) { onResult(NumberPad.press(digits, digit, exclude)) }
}

@Composable
private fun Key(
    label: String,
    description: String,
    enabled: Boolean,
    width: Dp,
    height: Dp,
    container: Color,
    content: Color,
    onClick: () -> Unit,
) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .width(width)
            .height(height)
            .clip(RoundedCornerShape(height / 2))
            .background(if (enabled) container else container.copy(alpha = 0.35f))
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = description },
    ) {
        Text(label, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = if (enabled) content else content.copy(alpha = 0.4f))
    }
}
