# DSP Console Notes

## Target signal chain

```text
ADC (16 kHz, f32)
  → [1] DC Offset Removal
  → [2] AEC  ← playback reference (pre-DAC)
  → [3] De-Reverb (Envelope Masking)
  → [4] Noise Gate / VAD (target: Otsu + Envelope Follower)
  → [5] Loudness Normalisation (K-Weighting + Gain Computer)
  → [6] Tone / Warmth (target: symmetric waveshaper + shelf)
  → [7] Look-Ahead Limiter (5 ms)
  → Output → Opus Encoder → Network
```

## Independent Cmajor modules

The browser loads seven distinct Cmajor patches and connects them in series. These are actual patch/runtime modules, not merely labels inside a single composite patch:

| Stage | Cmajor patch | Inputs / outputs |
|---|---|---|
| 1 · DC Offset Removal | `SeaMicDCOffset` | Microphone and far-end reference in; both DC-filtered streams out. |
| 2 · AEC | `SeaMicAEC` | Microphone and far-end reference in; cleaned microphone out. |
| 3 · De-Reverb | `SeaMicDeReverb` | Mono audio in/out. |
| 4 · Noise Gate / VAD | `SeaMicNoiseGateVAD` | Mono audio in; gated audio and speech flag out. |
| 5 · Loudness Normalisation | `SeaMicLoudnessNormalization` | Audio and speech flag in; K-weighted AGC audio out. |
| 6 · Tone / Warmth | `SeaMicToneWarmth` | Mono audio in/out; includes the post-tone DC blocker. |
| 7 · Look-Ahead Limiter | `SeaMicLookAheadLimiter` | Mono audio in/out. |

Each module patch has its own generic Cmajor GUI, runtime bundle, and bypass endpoints. The composite `SeaMicDSPChain.cmajorpatch` remains available for direct CLI testing only; it is not loaded by the web console and is not a DSP module.

## Bypass states and module testing

- **BYPASSED** means input passes through unchanged. **ACTIVE** means the processor is applied. The button text states the action: **Activate** or **Bypass**.
- **BYPASSED · MASTER** means the host is monitoring the dry route; individual module states are retained for when the DSP route is re-enabled.
- All processors start bypassed. The host starts in reduced-level dry monitoring.
- Solo activates one stage and bypasses the others. Exiting Solo restores the previous chain and module states.
- VAD Solo runs the detector with transparent audio. Tone Solo also activates the post-tone DC blocker.
- AEC activation and Solo remain disabled until playback is connected to its reference input. The web console can route a selected test clip to speakers and the AEC reference; the host application connects its live playback node through `SeaMicAudio.connectPlaybackSource(node)`.

## Current implementations and limitations

| Module | Current implementation |
|---|---|
| ADC | Browser mono microphone capture; requests a 16 kHz AudioContext. |
| 1 · DC Offset Removal | First-order 20 Hz high-pass on microphone and reference; bypassed at startup. |
| 2 · AEC | Real-time NLMS canceller (32–1024 taps, 512 default). The pre-output playback bus supplies the reference; AEC remains bypassed until a source is connected. Filter time coverage is tap count divided by the running sample rate. |
| 3 · De-Reverb | Fast/slow envelope shaper, limited to attenuation from 0 to -6 dB, with 20 ms reduction and 120 ms recovery; bypassed at startup. This is not a full acoustic de-reverberator. |
| 4 · Noise Gate / VAD | Current VAD uses 32 ms RMS, a falling noise-floor tracker, 9/4 dB SNR hysteresis defaults, a 400 ms close hangover default, and an absolute very-quiet close guard. SoftGate adds a 150 ms hold default and fades to 30 dB attenuation (default) over 30 ms. Gate depth (0–60 dB), gate hold (0–1000 ms), VAD hangover (0–2000 ms), and both SNR thresholds (enter 1–20 dB, exit 0–15 dB) are exposed as real-time console controls. The RMS accumulator is floored at zero to prevent negative roundoff. Otsu is pending. |
| 5 · Loudness Normalisation | K-weighted sidechain and RMS AGC; bypassed. Full integrated EBU R128 measurement and gating are pending. |
| 6 · Tone / Warmth | Asymmetric rational waveshaper and post-tone DC blocker; bypassed. Symmetric waveshaper and shelf are pending. |
| 7 · Look-Ahead Limiter | Bypassed; 5 ms sample-peak look-ahead and -1 dBFS ceiling when active. No oversampled true-peak detection. |
| Output | Final limiter output to the browser audio device. |
| Opus → Network | Target transport stages; not part of the current patches. |

## Validation notes

- All seven patches are loaded and connected at startup; all bypass endpoints start ON (dry pass-through).
- The dry route monitors the microphone directly at reduced gain while the module chain continues to run bypassed.
- The Stop button releases the microphone and closes the AudioContext. Use headphones to avoid feedback.
- Regenerate WebAudio runtimes with the official Cmajor CLI into `web/generated/<patch-name>/`. Never edit generated bundles manually.
- The host requests 16 kHz and displays the effective AudioContext rate. WebAudio renders in 128-sample quanta.

The cleaned AEC implementation lives in `cmajor/modules/aec/`; the original legacy module remains untouched. In the web console, select **Speakers + AEC reference** as the test-audio route to play a loaded clip through the reference bus and physical speakers. During this test, AEC is activated and the live microphone remains the near-end signal; the acoustic echo must reach that microphone. For integrated live use, connect the application's playback node with `SeaMicAudio.connectPlaybackSource(node)`. The same-context node is routed to speakers and the AEC reference before the output. Use headphones while testing and measure convergence with the actual playback/acoustic path.

In an integrated app, call `SeaMicAudio.start(appAudioContext)` from a user gesture and create the playback graph in that same context. Stopping the DSP host disconnects the AEC reference but does not close the application's context or interrupt its speaker route.
