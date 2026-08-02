package com.miniweb.browser.ui.theme

import android.app.Activity
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private val DarkColors = darkColorScheme(
    primary = Coral,
    onPrimary = InkBackground,
    secondary = CoralMuted,
    background = InkBackground,
    surface = InkSurface,
    surfaceVariant = InkSurfaceElevated,
    onBackground = InkOnSurface,
    onSurface = InkOnSurface,
    onSurfaceVariant = InkOnSurfaceMuted,
    outline = InkOutline,
    error = ErrorRed
)

private val LightColors = lightColorScheme(
    primary = CoralDark,
    onPrimary = PaperSurface,
    secondary = CoralMuted,
    background = PaperBackground,
    surface = PaperSurface,
    surfaceVariant = PaperSurfaceElevated,
    onBackground = PaperOnSurface,
    onSurface = PaperOnSurface,
    onSurfaceVariant = PaperOnSurfaceMuted,
    outline = PaperOutline,
    error = ErrorRed
)

@Composable
fun MiniWebTheme(
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
        typography = MiniWebTypography,
        content = content
    )
}
