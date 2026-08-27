# Installing Nova Browser

This covers installing a built copy of Nova Browser. The rest of this repo's documentation
(`doc/`) is an engineering log — this page is the short version for actually running the app.

---

## Desktop (Windows / macOS / Linux)

Once a version tag is pushed, the `Release Installers` workflow builds and publishes installers
for all three platforms to this repo's GitHub Releases page:

- **Windows:** `Nova Browser Setup <version>.exe` — an NSIS installer. Run it and follow the
  prompts; it lets you choose the install location.
- **macOS:** `Nova Browser-<version>.dmg` — open it and drag Nova Browser to Applications.
- **Linux:** `Nova Browser-<version>.AppImage` (run directly, no install needed), or the `.deb` /
  `.rpm` package for your distro.

**A heads-up before you install:** none of these builds are code-signed yet (no Windows EV
certificate or Apple Developer ID is configured — see `TODO.md`). That means:

- **Windows** will likely show a SmartScreen "Windows protected your PC" warning — click "More
  info" → "Run anyway."
- **macOS** will refuse to open it via double-click ("Nova Browser is damaged and can't be
  opened," or an "unidentified developer" block) — right-click the app → Open → Open, the first
  time only.

This is expected for an unsigned build, not a sign of a broken download.

### Building it yourself instead

```bash
npm ci
npm run build:win     # or build:mac / build:linux, matching your OS
```
Output lands in `release/`.

## Android

There's no signed release APK yet (see `doc/android-release-signing.md`) — today this means
building and sideloading a debug build:

```bash
npm run build:android
```

This builds the web bundle and assembles a debug APK via Gradle. Then either:

- **With a device connected over USB** (with USB debugging enabled in Developer Options):
  `npm run android:install` installs it directly.
- **Manually:** copy `android/app/build/outputs/apk/debug/app-debug.apk` to your phone and open
  it. You'll need to allow "install unknown apps" for whatever app you use to open the file
  (Files, a browser, etc.) — Android will prompt for this the first time.

## Troubleshooting

The desktop app writes a running health log to `nova-health.log` in the project root (or next
to the installed app) — worth checking first if something isn't behaving. It records renderer
crashes/reloads, blocked navigations, and (as of 2026-08-27) auto-update check results.
