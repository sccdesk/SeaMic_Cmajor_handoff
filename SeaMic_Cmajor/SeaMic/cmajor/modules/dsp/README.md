# SeaMic DSP Processors

## Signal-chain order

```text
ADC 16 kHz
  → DCOffsetRemoval (microphone and reference)
  → SeaMicAEC
  → DeReverb
  → K-Weighting analysis → VAD / SoftGate
  → AGC / loudness normalisation
  → Tone
  → DCOffsetRemoval
  → Look-ahead Limiter
  → audio output
```

The Opus encoder is not implemented in the current patches; the output is intended for a future host integration. The browser host loads a standalone patch for each DSP stage in the order listed above. `SeaMicDSPChain.cmajorpatch` remains as a composite CLI harness and is not loaded by the browser.

## Processors

- Every DSP processor starts bypassed and passes audio through unchanged. The initial host monitor is dry and does not include the limiter delay.
- **DCOffsetRemoval:** first-order high-pass filter with a nominal 20 Hz cutoff. Used before AEC and after Tone to remove DC offset introduced by asymmetric shaping. Each instance starts with the `Bypassed (ON = dry signal)` control enabled.
- **DeReverb:** envelope shaping, not deconvolution or full acoustic de-reverberation. Tracks fast envelopes (1/30 ms attack/release) and slow envelopes (50/500 ms). Processing is attenuation-only, limited to 0 to -6 dB; gain reduction follows over 20 ms and recovers over 120 ms to reduce gain-modulation artifacts.
- **Tone:** continuous asymmetric rational waveshaper:
  `u = drive*x / (1 + abs(drive*x))`,
  `y = (u + a*u*u) / (1 + a)`.
  For `0 <= a <= 0.5`, the curve is continuous, bounded to [-1, 1] before makeup gain, and includes an even-order term. Drive, asymmetry, and makeup gain are adjustable. Tone starts bypassed and is followed by another bypassed DCOffsetRemoval instance.
- **Limiter:** sample-peak detector with 0.1 ms smoothed attack, peak hold over the 5 ms look-ahead, and 50 ms release. The internal ceiling is -1.05 dBFS, leaving 0.05 dB of margin below the -1 dBFS target. At 16 kHz, the delay is 80 samples. No oversampling is used, so inter-sample true peak is not guaranteed.
- **KWeight, VAD, AGC, and SoftGate:** all start bypassed. Bypassed VAD reports `speech = 1` so it cannot indirectly close the gate; bypassed AGC and gate pass audio unchanged. KWeight passes unfiltered audio to its detector when bypassed.

The current VAD uses 32 ms rolling RMS, a falling noise-floor tracker, and 9/4 dB SNR hysteresis defaults with a 400 ms close hangover default; it also closes after sustained input below -60 dBFS RMS. It is not an Otsu bimodality classifier. SoftGate adds a 150 ms hold default, then fades to a configurable gate depth (30 dB default) over 30 ms. Its initial attenuation state is open. The SNR enter/exit thresholds, hangover, gate hold, and gate depth are exposed as `input event float32` endpoints so the web console can tune them in real time; each event clamps its value to the declared annotation range and the member state carries the same default as the `init` annotation, so headless renders without a controller behave identically. The VAD and AGC rolling RMS accumulators are floored at zero to prevent floating-point subtraction from producing a negative value. AGC measures 512-sample RMS on the K-weighted sidechain and updates while speech is active; it is not a full integrated EBU R128 meter with gating windows.

## Validation

All seven standalone module patches compile with the official Cmajor CLI and start in bypass. Existing AEC tests check the patch and canceller convergence. Evaluate DeReverb, VAD, and Tone using reproducible test signals and real microphone recordings before production use.
