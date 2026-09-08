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
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat

private val DarkColors = darkColorScheme(
    primary = NovaGold,
    onPrimary = Ink,
    secondary = NovaViolet,
    onSecondary = Ink,
    background = SpaceBackground,
    surface = SpaceSurface,
    surfaceVariant = SpaceSurfaceElevated,
    surfaceContainerHigh = SpaceSurfaceContainerHigh,
    onBackground = Starlight,
    onSurface = Starlight,
    onSurfaceVariant = StarlightMuted,
    outline = SpaceOutline,
    error = ErrorRed
)

private val LightColors = lightColorScheme(
    primary = NovaOchre,
    onPrimary = Starlight,
    secondary = NovaVioletDeep,
    onSecondary = Starlight,
    background = PaperBackground,
    surface = PaperSurface,
    surfaceVariant = PaperSurfaceElevated,
    surfaceContainerHigh = PaperSurfaceContainerHigh,
    onBackground = Ink,
    onSurface = Ink,
    onSurfaceVariant = InkMuted,
    outline = PaperOutline,
    error = ErrorRedDeep
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
