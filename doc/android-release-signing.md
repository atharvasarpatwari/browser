# Android Release Signing

**Status:** Scaffolding added 2026-08-27 (`android/app/build.gradle`, `android/keystore.properties.example`) — no real keystore generated yet.

---

## What was added

`android/app/build.gradle` now reads an optional `android/keystore.properties` file (gitignored
— see `android/.gitignore`) and, when it's present, signs release builds with it. When it's
absent, release builds behave exactly as before: unsigned, same as every build to date. Nothing
breaks if you never touch this.

## Generating a real keystore

You only need to do this once — reuse the same keystore for every future release. **Losing it
means you can never publish an update to an app already installed from a previous release under
the same signature** (Play Store and most sideload-update flows both enforce this), so back the
`.jks` file up somewhere safe outside this repo.

```bash
keytool -genkeypair -v \
  -keystore nova-release.jks \
  -alias nova \
  -keyalg RSA -keysize 2048 -validity 10000
```

This prompts for a store password, a key password, and some identity fields (name/org/etc. —
these end up in the certificate, not anywhere user-visible). Keep the `.jks` file **outside**
the repo, or inside it only if you're certain `android/.gitignore` covers wherever you put it —
safest is one directory above `android/`, matching the example config below.

## Wiring it up

1. Copy `android/keystore.properties.example` to `android/keystore.properties`.
2. Fill in the real values:
   ```properties
   storeFile=../nova-release.jks
   storePassword=<the store password you set>
   keyAlias=nova
   keyPassword=<the key password you set>
   ```
3. Build a release APK/AAB as usual (`gradlew.bat assembleRelease` / `bundleRelease`) — it will
   now be signed automatically. No changes needed to any build command.

`android/keystore.properties` and `*.jks`/`*.keystore` anywhere under `android/` are gitignored
— verify with `git status` after this that nothing keystore-related shows up as untracked-and-
about-to-be-added before your first commit touching this area.

## Beyond this repo

A signed APK/AAB is necessary but not sufficient for Play Store distribution — you'd also need:

- A Google Play Console developer account (one-time signup + fee).
- Play App Signing enrollment (Google re-signs your upload with their own key; you upload with
  the key above, users receive Google's).
- A production `versionCode`/`versionName` bump strategy — `android/app/build.gradle` still has
  `versionCode 1` / `versionName "1.0"` as placeholders from initial setup.

None of that is set up yet; this doc only covers the local signing step.
