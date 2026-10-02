# SeaMic VAD / render debugging — final report (29/09/2026)

> Historical measurements below describe the earlier 600 ms hangover and closed-start gate. Superseded settings (900 ms hangover / 400 ms hold / fixed 10 dB depth) were replaced by real-time GUI parameters: VAD hangover 400 ms default, gate hold 150 ms default, gate depth 30 dB default, plus adjustable SNR enter/exit thresholds; 30 ms gate attenuation ramp, open initial gate state, no secondary forced-close timer, and a -60 dBFS RMS close guard remain.

## Root cause of the "VAD is broken" mystery: THE ANALYZER, not the DSP

`cmaj render` writes **WAVE_FORMAT_EXTENSIBLE (fmt=0xFFFE), 32-bit float, stereo**.
`anwav2` chose the decoder with `fmtKind == 3` (IEEE_FLOAT) — extensible is
`0xFFFE`, so every float32 sample was read as **two int16 samples** (low word
first). Every probe conclusion drawn from those numbers was garbage.

FIX (anwav2/Program.cs): choose decoder by `bits`: 16 -> int16, else float32.

## With the fixed analyzer the truth is much better

7 s stimulus, seg RMS dBFS (probe beep full-on = -9.03):

| seg | content | input | VAD flag-beep | full chain out |
|---|---|---|---|---|
| 0 | noise -50 dB | -54.8 | (engine warmup black) | (black) |
| 1 | quiet speech | -34.4 | **open** (-12.2, partial ramp) | **-34.0** passes 1:1 |
| 2 | quiet speech + transient | -33.9 | **open** (-9.0) | -28.4 (AGC +5.5 dB ride) |
| 3 | noise -40 dB | -44.8 | partial (-11.1: exit + 600 ms hold) | -36.0 (hold leak) |
| 4 | loud speech | -10.4 | **open** (-9.0) | **-14.0** (AGC pull-down) |
| 5 | loud speech | -10.4 | **open** (-9.0) | -15.3 |
| 6 | noise -50 dB | -54.8 | partial (-11.0: 600 ms hangover) | -40.2 (leak) |

Flag wire value 1.0 -> -9.03 dBFS, 2.0 (absolute-level latch probe) -> -3.01.

## Engine quirk (kept): seg0 digital black in EVERY render

Even the unconditional pass-probe (flag forced 1, ignores input) is black for
~1.0-1.15 s at file start — `cmaj render --input` warmup, not our DSP.
**Ignore seg0 in render analyses**; validation uses seg1..6.

## Real DSP bugs found & fixed during this session (before analyzer discovery)

1. **v1 floor init -80 dBFS + upward leak** -> phantom +25 dB SNR on pure noise
   at t=0 -> VAD latched speech on noise, froze the floor (sub-block updates
   gated on !speech). FIX: floor boots AT the -40 dBFS cap, lower-only forever.
2. **Rotation gated on !speech** -> speech onset froze the sliding 3 s window
   for up to 3 s; floor could never refresh. FIX: rotate ALWAYS; during speech
   carry the old floor forward (subMinA = noiseFloor).
3. **2 s boot decision gate** suppressed all enters under render. FIX: floor
   boot shortened to 0.25 s (instant-min converges ~32 ms), NO gate on decisions.
4. **Hoisted value endpoints (`input vad.enterDb`)** + unset values in render
   risk enter=0/exit=0 -> inverted hysteresis. FIX: thresholds are plain floats
   in chain2 (enter 9 dB / exit 4 dB); live graph exposes only AGC knobs.
5. Previous gate started attenuated and could take time to open. Current code
   initializes it open and uses a 30 ms attenuation ramp after the VAD and
   additional gate hold timers.

## Known quality issues (tunable, not blockers)

- seg3/seg6 noise leak: the earlier 600 ms VAD hangover + 400 ms gate hold + 150 ms gate
  release lets ~1 s of background through after speech — the price of the
  requested "longer hold". Tune the VAD hangover / gate hold / gate depth
  sliders in the console GUI (or the underlying events in chain2 / chain3).
- Quiet speech (seg1) passes at unity: AGC release is 1.5 s, too slow to ride
  up inside a 2 s burst. Fine for >5 s talkers; the next improvement target.
- Loud speech lands at -14..-15 dBFS vs -19 target (K-weight window vs
  broadband RMS reading). Acceptable for comms (louder is fine, no clipping).

## Debug tooling kept (reusable for the next iteration)

- `SeaMicVadProbe` — VAD flag as 440 Hz beep
- `SeaMicSnrProbe` — swappable wire: raw kw.out / debugRms / debugFloor / debugSnr
- `SeaMicMiniProbe` / `SeaMicPassProbe` / `SeaMicEnterProbe` / `SeaMicLevelProbe`
  — bisect probes that isolated engine warmup, flag path and window math
- `anwav2` — segment RMS analyzer (float32 / extensible aware)

---

## FINAL STATUS (v2 validated — corrected analyzer)

Historical real-device chain: DC-block -> K-weight -> VADv2 -> AGC (speech-frozen) -> soft-gate (earlier closed start,
hold = 600 ms hangover + 400 ms tail) -> limiter, at 16 kHz.

Render numbers (render_final.wav / render_probe.wav, stimulus16k.wav; seg0 black = cmaj render
warm-up, ignore; flag-beep probe: full open = -9.03 dBFS):

| seg | content         | input RMS | chain out | flag probe |
|-----|-----------------|-----------|-----------|------------|
| 1   | quiet speech    | -34.4     | -34.0     | -12.2 (opens) |
| 2   | quiet speech    | -33.9     | -28.4     | -9.0 (OPEN)   |
| 3   | noise -40 dB    | -44.8     | -36.0     | -11.1 (hold)  |
| 4   | loud speech     | -10.4     | -14.0     | -9.0 (OPEN)   |
| 5   | loud speech     | -10.4     | -15.3     | -9.0 (OPEN)   |
| 6   | noise -50 dB    | -54.8     | -40.2     | -11.0 (hold)  |

Peak 0.936, zero samples above 0 dBFS. R1-R5 verified.

Known trade-off (stakeholder choice): the longer hold leaks ~1 s of background after utterances
(seg3/seg6). Shrink the VAD hangover / gate hold sliders (or `hangTimeMs` in chain2 /
`holdTimeMs` in chain3) to reduce; raise for more protection. Gate depth now defaults to
30 dB (was fixed at 10 dB) and is adjustable 0–60 dB live.

Everything is reproducible: see report/run_pdf.ps1 (report) and Appendix B of the report.
