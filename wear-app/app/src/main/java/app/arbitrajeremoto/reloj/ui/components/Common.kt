package app.arbitrajeremoto.reloj.ui.components

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.ScalingLazyListScope
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.FilledTonalButton
import androidx.wear.compose.material3.ListHeader
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import app.arbitrajeremoto.reloj.ui.theme.RelojColors
import app.arbitrajeremoto.reloj.ui.theme.RelojType

/**
 * Standard screen: a scaling list inside ScreenScaffold (time, scroll indicator, round-screen
 * padding). The crown/bezel scrolls it.
 */
@Composable
fun RelojList(content: ScalingLazyListScope.() -> Unit) {
    val listState = rememberScalingLazyListState()
    ScreenScaffold(scrollState = listState) { contentPadding ->
        ScalingLazyColumn(
            modifier = Modifier.fillMaxSize(),
            state = listState,
            contentPadding = contentPadding,
            content = content,
        )
    }
}

/** Screen title, announced as a heading by TalkBack. */
@Composable
fun ScreenTitle(title: String) {
    ListHeader(modifier = Modifier.semantics { heading() }) {
        Text(title, fontSize = RelojType.title, textAlign = TextAlign.Center)
    }
}

@Composable
fun BodyText(text: String, color: Color = RelojColors.textPrimary, modifier: Modifier = Modifier) {
    Text(
        text,
        textAlign = TextAlign.Center,
        fontSize = RelojType.body,
        color = color,
        modifier = modifier.fillMaxWidth().padding(horizontal = 8.dp),
    )
}

/** Full-width button with an optional second line. */
@Composable
fun WideButton(label: String, onClick: () -> Unit, secondary: String? = null, primary: Boolean = false) {
    if (primary) {
        Button(
            onClick = onClick,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(),
            secondaryLabel = if (secondary != null) {
                { Text(secondary, fontSize = RelojType.caption) }
            } else {
                null
            },
            label = { Text(label, fontSize = RelojType.label) },
        )
    } else {
        FilledTonalButton(
            onClick = onClick,
            modifier = Modifier.fillMaxWidth(),
            secondaryLabel = if (secondary != null) {
                { Text(secondary, fontSize = RelojType.caption) }
            } else {
                null
            },
            label = { Text(label, fontSize = RelojType.label) },
        )
    }
}
