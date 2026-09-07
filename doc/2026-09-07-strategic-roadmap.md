# Nova Browser Strategic Roadmap — "Better" = More of a Real Browser You Can Ship

**Date:** 2026-09-07
**Session:** Approved directions — full strategic roadmap (Track C), web-platform completeness (Track A), ship-ready product (Track B)
**Status:** In Progress — Track A quick win (A2) + Track B hygiene (B1/B2/B7) + A3 implemented 2026-09-07 (see `doc/2026-09-07-roadmap-implementation.md`)

---

## North star
Current state (verified): 216 test files / ~9178 tests green (only 3 DNS network timeouts historically), tsc 0 errors, contextIsolation restored via socket-proxy, QUIC wire fixed, Android app built + smoke-tested 8/8 on-device, Windows desktop packaged + health-log verified. The browser is **architecturally complete but not web-standards-interoperable and not distribution-ready**. "Better" therefore means: behave like a real browser on the open web, and be something you can point other people at.

## Track A — Web-Platform Completeness

| # | Work | Effort | Status |
|---|------|--------|--------|
| A1 | **WebRTC Phase 2 — real DTLS 1.2 (RFC 6347) + SCTP (RFC 4960) + DCEP (RFC 8832)**. The flagship interop gap; today Nova peers talk only to each other (`m=NOVA/DATACHANNEL`, unencrypted). Needs its own design doc first. | Multi-week, highest risk | — |
| A2 | Delete dead `src/browser/media/webrtc.ts` simulation | Trivial | **Done 2026-09-07** (`74288db`) |
| A3 | **DevTools protocol exposure** (opt-in `NOVA_REMOTE_DEBUGGING_PORT` → `--remote-debugging-port`) | Small | **Done + verified 2026-09-07** |
| A4 | Service Workers + PWA baseline (install/activate/fetch, no background sync) | Medium-large, new design doc | — |
| A5 | WASM execution (MVP core, no threads/SIMD) | Large | — |
| A6 | WebRTC Phase 3 — TURN relay + trickle-ICE + RFC 8445 state machine | Large | — |
| A7 | CSS containment / subgrid / scroll-snap | Medium | — |
| A8 | JIT tiering (`jit-compilation-plan.md`) | Large | — |
| A9 | Audio/video (Phase 4) — **do not schedule yet**; feasibility assessment first (needs native camera/codec bindings) | Unknown, gated | — |

Ordering: A1→A2→A3 deliver the most "browser-like" behavior per unit effort; A4/A5/A6 next wave; A8/A9 gated on Track C decisions.

## Track B — Ship-Ready Product

| # | Work | Effort | Status |
|---|------|--------|--------|
| B1 | Commit accumulated working tree (already largely committed as `c28094f`; session changes committed separately) | Small | **Done 2026-09-07** |
| B2 | Align Node engines floor (added `>=20.19.0` — the real toolchain floor) | Trivial | **Done 2026-09-07** |
| B3 | Auto-update verified against a real tagged release (`git tag v0.0.0-test`) | Small | — |
| B4 | macOS/Linux release-CI legs tested via tag push | Small-medium | — |
| B5 | Code-signing: Windows EV cert priority; document "unknown publisher" fallback otherwise | Medium (cert gating) | — |
| B6 | Android release keystore + Play App Signing enrollment steps | Medium | — |
| B7 | Close `known-test-failures.md` loose ends (typecheck table; fib flake budget if it recurs) | Trivial | **Done 2026-09-07** (typecheck table) |

## Track C — Architecture Decisions (horizontal, unblocks A-track)

| Decision | Options | When |
|----------|---------|------|
| Native Rust networking (`nova-net`) | (1) Wire into `RawSocketHttpClient` with JS fallback, (2) declare experimental — "half-wired is worse than either committed state" | Before A5/A8 |
| Multi-process crash isolation | Activate dormant `child_process.fork()` transport + per-tab model, or keep single-process | After A3 (IPC exists) |
| WebGPU adoption | Decide software-vs-GPU parity investment | After A5 |
| A/V Phase 4 | Rust camera/codec bindings feasibility assessment | After Track A stabilizes |

## Execution model (per AGENTS.md)
1. One design doc per A-track item (`doc/`) before coding — the format proven by `quic-wire-correctness-plan.md`.
2. Gates per item: `npx tsc --noEmit` → targeted vitest slices → full `npm test` (~9185 baseline) → lint/e2e. Commit per phase.
3. Change log in `doc/` + `doc/README.md` row after each track. Re-run Android smoke test + fidelity audit after rendering/interop changes.
4. Quarter view: **Q1 = B1–B7 + A1–A3**, **Q2 = A4–A6 + Track C decisions**, **Q3 = A7–A9** (gated on C).