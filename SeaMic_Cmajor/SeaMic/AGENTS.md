# Agent Guide

SeaMic DSP study and prototype workspace. The web console is an internal tool for reviewing and testing the microphone signal chain.

## Stack and layout

- **Web:** plain HTML, CSS, and JavaScript. No frameworks, npm, bundlers, or TypeScript.
- **DSP:** Cmajor processors, graphs, and JIT; official generated WebAudio/WASM runtime.
- **Future port:** rate-agnostic C++ with coefficients derived during initialization.
- **Workspace:** `web/`, `web/cmajor-runtime/`, `web/generated/`, `cmajor/legacy/`, `cmajor/modules/`, `cmajor/patches/`, `cmajor/tests/`, `cpp/`, `docs/`, `scripts/`, `AGENTS.md`, and `MEMORY.md`.

## Conventions

- All user-facing web text and maintained project documentation must be in English.
- Keep code simple, clear, and descriptive.
- Make focused changes; do not rewrite working code without a reason.
- Preserve keyboard accessibility, semantic controls, and responsive layout.
- Keep comments concise and in English.

## DSP and runtime constraints

- The Cmajor web console requires a local HTTP origin for generated ES modules, AudioWorklet, and WebAssembly. Do not claim that the Cmajor integration works from `file://`.
- `web/cmajor-runtime/` contains third-party runtime documentation and files. Do not modify it or fabricate runtime binaries.
- `web/generated/` contains official Cmajor-generated patch bundles. Do not hand-edit generated JavaScript or helpers; regenerate them with the Cmajor CLI after patch changes.
- The browser host loads seven independent Cmajor module patches in signal-chain order. `SeaMicDSPChain.cmajorpatch` is retained only as a composite CLI harness and is not a DSP module or part of the browser runtime.
- At startup, the host monitors the microphone dry at reduced gain and all DSP processors start bypassed. Keep AEC bypassed and locked until an application playback node is connected through `SeaMicAudio.connectPlaybackSource(node)`; that bus feeds the same pre-output signal to speakers and the AEC reference.
- A bypassed processor must pass its input through unchanged. User-facing controls must state both the current state and the action clearly.
- Target architecture: ADC → DC Offset Removal → AEC (pre-DAC playback reference) → De-Reverb → Noise Gate/VAD (target: Otsu + envelope follower) → Loudness Normalisation (K-Weighting + gain computer) → Tone/Warmth (target: symmetric waveshaper + shelf) → Look-Ahead Limiter → Opus → Network.
- Distinguish target features from current implementation: VAD uses RMS/SNR hysteresis; Tone is currently an asymmetric rational shaper without a shelf; the AEC reference is supplied by the application playback-bus hook; Opus and Network are not integrated.
- Do not modify `cmajor/legacy/` without explicit authorization.

## Project memory

- Read `MEMORY.md` before starting work and update it briefly at the end of a task.
- Record technical exceptions and their rationale in `MEMORY.md`.

## Boundaries

- Always use a local HTTP server for the Cmajor web console.
- Ask before adding external dependencies, changing acoustic DSP parameters, or generating C++.
- Never add frameworks or build tooling, edit third-party runtime files, hand-edit generated runtime bundles, run a live Cmajor microphone session without permission, or modify legacy modules without authorization.

## Verification

- Serve the web console and inspect the browser console after UI/runtime changes.
- Check `#cmajor-status` and `#debug-panel` when testing Cmajor integration.
- Compile Cmajor patches and run relevant Cmajor tests after DSP changes.
- State any limitations in the final summary.
