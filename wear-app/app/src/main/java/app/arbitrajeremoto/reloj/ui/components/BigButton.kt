package app.arbitrajeremoto.reloj.ui.components

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.Text
import app.arbitrajeremoto.reloj.ui.theme.RelojType

/**
 * Large touch target (≥ 52 dp) with an optional long press for rare actions. TalkBack reads
 * [description] and offers the long press as a custom action labelled [longClickLabel].
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun BigButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    container: Color,
    content: Color,
    description: String? = null,
    onLongClick: (() -> Unit)? = null,
    longClickLabel: String? = null,
    enabled: Boolean = true,
    fontSize: TextUnit = RelojType.label,
) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .heightIn(min = 52.dp)
            .clip(RoundedCornerShape(26.dp))
            .background(if (enabled) container else container.copy(alpha = 0.4f))
            .combinedClickable(
                enabled = enabled,
                role = Role.Button,
                onLongClickLabel = longClickLabel,
                onLongClick = onLongClick,
                onClick = onClick,
            )
            .semantics { if (description != null) contentDescription = description }
            .padding(horizontal = 6.dp, vertical = 6.dp),
    ) {
        Text(label, color = content, fontSize = fontSize, textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}
