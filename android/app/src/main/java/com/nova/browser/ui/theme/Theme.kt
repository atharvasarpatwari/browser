package com.nova.browser.ui.theme

import android.app.Activity
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat

private val DarkColors = darkColorScheme(
    primary = NovaCyan,
    onPrimary = OnAccentDark,
    secondary = NovaAmber,
    onSecondary = OnAccentDark,
    background = ObsidianBackground,
    surface = ObsidianSurface,
    surfaceVariant = ObsidianInput,
    surfaceContainerHigh = ObsidianElevated,
    onBackground = StarlightPrimary,
    onSurface = StarlightPrimary,
    onSurfaceVariant = StarlightSecondary,
    outline = ObsidianOutline,
    error = ErrorRed
)

private val LightColors = lightColorScheme(
    primary = NovaCyanLight,
    onPrimary = Color.White,
    secondary = NovaAmber,
    onSecondary = OnAccentDark,
    background = PaperBackground,
    surface = PaperSurface,
    surfaceVariant = PaperInput,
    surfaceContainerHigh = PaperElevated,
    onBackground = InkPrimary,
    onSurface = InkPrimary,
    onSurfaceVariant = InkSecondary,
    outline = PaperOutline,
    error = ErrorRed
)

// A slightly tighter, more considered corner scale than Material3's defaults —
// pill-shaped controls (address bar, tab chips) stay hand-tuned per component,
// this governs the rest (sheets, menus, dialogs, cards).
private val NovaShapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(10.dp),
    medium = RoundedCornerShape(14.dp),
    large = RoundedCornerShape(20.dp),
    extraLarge = RoundedCornerShape(28.dp)
)

@Composable
fun NovaBrowserTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) DarkColors else LightColors
    val view = LocalView.current

    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = colorScheme.background.toArgb()
            window.navigationBarColor = colorScheme.background.toArgb()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !darkTheme
                WindowCompat.getInsetsController(window, view).isAppearanceLightNavigationBars = !darkTheme
            }
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = NovaBrowserTypography,
        shapes = NovaShapes,
        content = content
    )
}
