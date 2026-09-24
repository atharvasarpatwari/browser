package com.nova.browser.ui.theme

import androidx.compose.ui.graphics.Color

// ─────────────────────────────────────────────────────────────────────────
// Nova's real palette — mirrors the desktop app's actual design tokens
// (styles.css: "Dark-glass minimalism … deep obsidian · electric cyan
// accent · warm amber secondary"), not an independently invented brand.
// Values below are the desktop CSS custom properties converted 1:1 so the
// two front ends read as the same product: --ob-950/900/750/700 for
// surfaces, --cyan-500/600 and --amber-400 for accents, white/black at the
// same opacities for text, and the reserved --purple-500/400 tokens (never
// consumed on desktop) repurposed here for incognito, which desktop has no
// window to render at all.
// ─────────────────────────────────────────────────────────────────────────

// Dark theme surfaces — obsidian, the primary identity (--ob-950…--ob-700)
val ObsidianBackground = Color(0xFF060810)   // --ob-950 / --bg-base
val ObsidianSurface = Color(0xFF0A0D17)      // --ob-900 / --bg-chrome
val ObsidianInput = Color(0xFF121828)        // --ob-750 / --bg-input (address bar)
val ObsidianElevated = Color(0xFF161D30)     // --ob-700 / --bg-surface-2 (selected/elevated)
val ObsidianOutline = Color(0x1AFFFFFF)      // --bd-default (white @ 10%)

// Dark theme text — white at the design system's fixed opacities
val StarlightPrimary = Color(0xEBFFFFFF)     // --tx-primary (.92)
val StarlightSecondary = Color(0x8FFFFFFF)   // --tx-secondary (.56)
val StarlightTertiary = Color(0x52FFFFFF)    // --tx-tertiary (.32)

// Light theme surfaces — daylight paper (light-mode override of the same tokens)
val PaperBackground = Color(0xFFF4F4F6)
val PaperSurface = Color(0xFFFFFFFF)
val PaperInput = Color(0xFFF0F0F3)
val PaperElevated = Color(0xFFE8E8EC)
val PaperOutline = Color(0x1A000000)         // --bd-default, light mode (black @ 10%)

// Light theme text — black at the design system's fixed opacities
val InkPrimary = Color(0xE0000000)           // .88
val InkSecondary = Color(0x8F000000)         // .56
val InkTertiary = Color(0x5C000000)          // .36

// Brand accent — electric cyan is primary in both themes; the light-mode
// value is darker ("for contrast on paper", per the desktop token comment)
val NovaCyan = Color(0xFF06B6D4)             // --cyan-500, dark theme
val NovaCyanLight = Color(0xFF0891B2)        // --cyan-600, light theme
val NovaAmber = Color(0xFFFBBF24)            // --amber-400, secondary accent, both themes
// Cyan and amber are both light/saturated colors regardless of theme mode,
// so content drawn on either always needs dark text/icons — a fixed color,
// not the theme's own background token (which flips to near-white in light
// mode and would be unreadable here).
val OnAccentDark = Color(0xFF0B0E17)

// Semantic — kept distinct from the brand accent, same hue in both themes
val SuccessGreen = Color(0xFF4ADE80)         // --green-400
val ErrorRed = Color(0xFFEF4444)             // --red-500
