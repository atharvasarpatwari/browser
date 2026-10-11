#!/usr/bin/env bash
# Probes sccache's GHA cache backend with a real wrapped command before a
# build/test step relies on RUSTC_WRAPPER=sccache being set.
#
# `sccache --show-stats` only reads the daemon's local counters -- it never
# round-trips to the GHA cache backend, so it reports healthy even during a
# backend outage. Wrapping a real `rustc -vV` call is what actually
# exercises the connection (the same thing that fails if the backend is
# unreachable), so this probes with that instead. Bounded by `timeout`,
# since a degraded backend can hang rather than error, and an unbounded
# probe would just trade a fast failure for a slow one.
#
# Falls back to unsetting RUSTC_WRAPPER (plain, uncached compilation)
# instead of letting an external cache-service outage hard-fail the whole
# job before any real compilation starts.
#
# Usage: source this file, then run cargo as usual.
#   env:
#     SCCACHE_GHA_ENABLED: "true"
#     RUSTC_WRAPPER: "sccache"
#   run: |
#     source .github/scripts/sccache-guard.sh
#     cargo build ...

if ! timeout 20 sccache rustc -vV >/dev/null 2>&1; then
  echo "::warning::sccache cache backend unreachable -- building without it (slower, but not blocked)"
  unset RUSTC_WRAPPER
fi
