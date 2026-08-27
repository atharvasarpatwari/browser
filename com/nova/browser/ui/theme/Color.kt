package com.nova.browser.ui.theme

import androidx.compose.ui.graphics.Color

// ─────────────────────────────────────────────────────────────────────────
// Nova's palette: a browser named for a star's sudden brightening, so the
// brand color is a warm gold "flash" against deep space surfaces — not a
// generic accent color. Dark is the primary identity (deep space); light is
// daylight paper, not stark white. Semantic colors (success/warning/error)
// are intentionally distinct hues from the brand accent.
// ─────────────────────────────────────────────────────────────────────────

// Brand — the "nova flash"
val NovaGold = Color(0xFFF6B93B)       // primary, dark theme
val NovaOchre = Color(0xFFA9720F)      // primary, light theme (darker for contrast on paper)
val NovaGoldMuted = Color(0xFFFFDDA0)  // tints, disabled/pressed states

// Secondary — a cool violet counterpoint, used sparingly
val NovaViolet = Color(0xFF8C8FFF)     // secondary, dark theme
val NovaVioletDeep = Color(0xFF5B54D9) // secondary, light theme

// Dark theme surfaces — deep space, never flat black
val SpaceBackground = Color(0xFF10111A)
val SpaceSurface = Color(0xFF171825)
val SpaceSurfaceElevated = Color(0xFF202233)
val SpaceSurfaceContainerHigh = Color(0xFF262940)
val SpaceOutline = Color(0xFF35374A)
val Starlight = Color(0xFFEDEAE2)          // on-surface text, dark theme (warm, not clinical white)
val StarlightMuted = Color(0xFF9B9DB2)

// Light theme surfaces — daylight paper, slightly warm
val PaperBackground = Color(0xFFF6F6F2)
val PaperSurface = Color(0xFFFFFFFF)
val PaperSurfaceElevated = Color(0xFFEFEDE6)
val PaperSurfaceContainerHigh = Color(0xFFE7E4DA)
val PaperOutline = Color(0xFFDEDAD0)
val Ink = Color(0xFF1B1A17)                // on-surface text, light theme
val InkMuted = Color(0xFF6B6862)

// Semantic — deliberately separate hues from the brand accent
val SuccessGreen = Color(0xFF4FC08D)
val WarningAmber = Color(0xFFE2963D)
val ErrorRed = Color(0xFFF2685F)       // error, dark theme
val ErrorRedDeep = Color(0xFFC4433C)   // error, light theme

// Incognito — its own cool-violet identity, independent of the active theme
val IncognitoSurface = Color(0xFF17182B)
val IncognitoContent = Color(0xFFC9CBFF)
