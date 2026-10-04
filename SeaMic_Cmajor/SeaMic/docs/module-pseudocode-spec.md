# SeaMic — Module Specification, Data Structures and C++ Equivalence

**Purpose:** base document for developing the per-module pseudocode (and a future rate-agnostic C++ port) of the SeaMic microphone DSP chain.

**Scope:** the 7 DSP modules loaded by the browser host.
**Source of truth:** the Cmajor sources listed in §0.2. Code listings are verbatim.
**Language note:** English, per `AGENTS.md` ("All user-facing web text and maintained project documentation must be in English").

**How to use this document:** every chapter is self-contained. Read §0 once for the shared conventions, then work one chapter at a time and write that module's pseudocode from its §x.8 scaffold.

**Non-goals:** this document does not propose new acoustic parameter values. Per `MEMORY.md`: "Do not change established VAD/AGC acoustic parameters without measurements and authorization."

---

## Part 0 — Shared foundations

### 0.1 Signal chain

Target (from `docs/pipeline-notes.md`):

```text
ADC (16 kHz, f32)
  → [1] DC Offset Removal
  → [2] AEC            ← playback reference (pre-DAC)
  → [3] De-Reverb (envelope masking)
  → [4] Noise Gate / VAD        (target: Otsu + envelope follower)
  → [5] Loudness Normalisation  (K-Weighting + gain computer)
  → [6] Tone / Warmth           (target: symmetric shaper + shelf)
  → [7] Look-Ahead Limiter (5 ms)
  → Output → Opus → Network
```

Current implementation = the target minus: Otsu classification in [4], fully integrated EBU R128 in [5], the shelf filter in [6], and Opus/Network.

### 0.2 Module → source map

| # | Host id | Patch | Processor source file(s) |
|---|---|---|---|
| 1 | `dc` | `SeaMicDCOffset` | `cmajor/modules/dsp/DCOffsetRemoval.cmajor` |
| 2 | `aec` | `SeaMicAEC` | `cmajor/modules/aec/SeaMicAEC.cmajor` + DCOffsetRemoval x2 |
| 3 | `dereverb` | `SeaMicDeReverb` | `cmajor/modules/dsp/DeReverb.cmajor` |
| 4 | `vad` | `SeaMicNoiseGateVAD` | `chain2_vad.cmajor` (VAD), `chain3_agc_gate_limit.cmajor` (SoftGate) |
| 5 | `loudness` | `SeaMicLoudnessNormalization` | `chain1_filters.cmajor` (KWeight), `chain3_agc_gate_limit.cmajor` (AGC) |
| 6 | `tone` | `SeaMicToneWarmth` | `cmajor/modules/dsp/Tone.cmajor` + DCOffsetRemoval |
| 7 | `limiter` | `SeaMicLookAheadLimiter` | `chain3_agc_gate_limit.cmajor` (Limiter) |

`SeaMicDSPChain.cmajor` is a composite CLI harness only — **not** a module.

### 0.3 Cmajor → C++ construct mapping (applies to every chapter)

| Cmajor | C++ equivalent | Notes |
|---|---|---|
| `processor X { ... }` | `class X` | |
| `input stream float` / `float32` | `float processOneSample(float in)` | block form: `void process(const float* in, float* out, int n)` |
| `output stream float` | return value, or `out` param | |
| `input event float32 p` | `void setP(float v)` | must clamp exactly like the Cmajor handler |
| `input value float p` | plain member + `void setP(float v)` | **no** clamp at the port; clamping happens at point of use |
| `processor.frequency` | `sampleRate_` set in `prepare(double sr)` | |
| `loop { ... advance(); }` | `for (;;) { ... }` inside the host's sample loop | `advance()` = write outputs, read inputs, move to next sample |
| `float32[N] a;` | `std::array<float, N> a{}` | |
| `a.wrap<N>(i)` | `i < 0 ? i + N : (i >= N ? i - N : i)` | **not** `i % N`: only a ±1 correction |
| `a.at(i)` | `a[i]` | indices are guaranteed in range by the local `if` clamps |
| `float32` arithmetic | `float` | |
| `float64` arithmetic | `double`, then narrow on store | AEC only |
| `twoPi` | `2.0 * M_PI` (`constexpr double`) | |
| `exp/log10/pow/abs/min/max` | `std::exp/log10/pow/fabs/fmin/fmax` | promote to `double` when the Cmajor operand is `float64` |
| `value > 0.5f` | `value > 0.5f` | bypass convention: `out <- isBypassed ? x : processed` |
| `int (x)` | `static_cast<int>(x)` | truncates toward zero |

### 0.4 Global invariants

1. **Every processor starts bypassed** and is bit-transparent: `out == in` exactly.
2. Bypass flag semantics: `bypass == 1` → dry; `bypass == 0` → processing. `bypass == true` when `value > 0.5f`.
3. Event handlers clamp **before** assigning the member; the member default equals the annotation `init`.
4. Two independent smoothing stages exist wherever there is an exponential smoother:
   `coeff = 1 - exp(-1/(tau*fs))`, applied as `state += (target - state) * coeff`.
   `tau` selection is asymmetric (attack vs release) in every module that has both.
5. Target rate is 16 kHz. The actual rate may differ (48 kHz typical). All `tau*fs` products are
   rate-independent **except** the AEC filter length, which is expressed in taps, and the AGC RMS
   window, which is a fixed sample count (see §5.13).
6. WebAudio renders in 128-sample quanta. `cmaj test` / `cmaj render` never deliver `input event`s,
   so headless renders stay at the default values listed in Appendix B.

### 0.5 Constant values at 16 kHz (reference table for the pseudocode)

| Module | Constant | Formula | 16 kHz value |
|---|---|---|---|
| DC | `coefficient` | `exp(-2pi*20/fs)` | 0.9921769 |
| AEC | `meterSmoothing` | `1/max(fs*0.1, 1)` | 6.250e-4 |
| AEC | `powerSmoothing` | `1/activeTaps` (512) | 1.9531e-3 |
| DeReverb | `fastAttack` | `1-exp(-1/(0.001*fs))` | 6.0587e-2 |
| DeReverb | `fastRelease` | `1-exp(-1/(0.030*fs))` | 2.0811e-3 |
| DeReverb | `slowAttack` | `1-exp(-1/(0.050*fs))` | 1.2492e-3 |
| DeReverb | `slowRelease` | `1-exp(-1/(0.500*fs))` | 1.2499e-4 |
| DeReverb | `gainAttack` | `1-exp(-1/(0.020*fs))` | 3.1201e-3 |
| DeReverb | `gainRelease` | `1-exp(-1/(0.120*fs))` | 5.2070e-4 |
| Tone | `mixSmoothing` | `1-exp(-1/(0.005*fs))` | 1.2422e-2 |
| VAD | `winLen` | `int(0.032*fs)` | 512 |
| VAD | `subLen` | `int(fs)` | 16000 |
| VAD | `initLen` | `int(0.25*fs)` | 4000 |
| AGC | `downCoeff` | `1-exp(-1/(0.08*fs))` | 7.8095e-4 |
| AGC | `upCoeff` | `1-exp(-1/(1.5*fs))` | 4.1666e-5 |
| AGC | `smoothDown` | `1-exp(-1/(0.010*fs))` | 6.2306e-3 |
| AGC | `smoothUp` | `1-exp(-1/(0.050*fs))` | 1.2492e-3 |
| SoftGate | `attCoeff` | `1-exp(-1/(0.030*fs))` | 2.0811e-3 |
| SoftGate | `relCoeff` | `1-exp(-1/(0.150*fs))` | 4.1658e-4 |
| Limiter | `ceilLin` | `10^(-1.05/20)` | 0.8861461 |
| Limiter | `delaySamples` | `int(0.005*fs)` | 80 |
| Limiter | `peakRelease` | `exp(-1/(0.050*fs))` | 0.9987508 |
| Limiter | `gainAttack` | `1-exp(-1/(0.0001*fs))` | 4.6474e-1 |
| Limiter | `gainRelease` | `1-exp(-1/(0.050*fs))` | 1.2492e-3 |

---

## Module 1 — DC Offset Removal

**Files:** `cmajor/modules/dsp/DCOffsetRemoval.cmajor` (processor), `cmajor/patches/SeaMicDCOffset/SeaMicDCOffset.cmajor` (graph).
**Instantiated twice** in the chain: stage 1 (mic + reference) and inside `SeaMicToneWarmth` (post-shaper). The AEC patch also owns two, held bypassed (`bypassDcFilters`, hidden) because stage 1 owns DC removal.

### 1.1 Objective

Remove any constant (DC) component and any very-low-frequency drift below ~20 Hz from both the microphone signal and the playback reference, without altering the audible band. Must be transparent when bypassed and free of clicks when toggled (it is not — see §1.9).

### 1.2 Interfaces

| Direction | Name | Type | Range | Init | Notes |
|---|---|---|---|---|---|
| in | `microphone` | stream float | — | — | graph level only |
| in | `farEndReference` | stream float | — | — | graph level only |
| out | `cleanedMicrophone` | stream float | — | — | |
| out | `cleanedReference` | stream float | — | — | |
| in | `bypassDc` | event float32 | boolean | `1` | `hidden` in the AEC patch |

Processor level: `in` → `out`, `bypassDc`.

### 1.3 Data structures

| Cmajor | Type | Init | Meaning | C++ |
|---|---|---|---|---|
| `previousInput` | `float` | `0.0f` | x[n-1] | `float prevInput_ = 0.f;` |
| `previousOutput` | `float` | `0.0f` | y[n-1] | `float prevOutput_ = 0.f;` |
| `isBypassed` | `bool` | `true` | dry/active | `bool bypassed_ = true;` |
| `coefficient` | `float` (local, computed once) | `exp(-2pi*20/fs)` | pole | `float coefficient_;` |

No arrays. Memory O(1). **3 persistent members.**

### 1.4 Start-up constants

```
coefficient = exp (-float(twoPi) * 20.0f / float(processor.frequency))
```

Computed once before the loop; `fs` is constant for the lifetime of the processor in both Cmajor and C++.

### 1.5 Per-sample algorithm

1. `sample = in`
2. `filtered = sample - previousInput + coefficient * previousOutput`
3. `previousInput = sample`; `previousOutput = filtered`
4. `out = isBypassed ? sample : filtered`

This is the standard one-zero/one-pole DC blocker: `y[n] = x[n] - x[n-1] + a*y[n-1]`, with `a` chosen so the high-pass corner is 20 Hz.

**Important:** steps 2-3 run *unconditionally*, even when bypassed. The state stays warm so un-bypassing does not produce a transient. The pseudocode must preserve this.

### 1.6 Current Cmajor code

```cmajor
processor DCOffsetRemoval
{
    input stream float in;
    output stream float out;
    input event float32 bypassDc [[ name: "Bypassed (ON = dry signal)", init: 1, boolean ]];

    float previousInput = 0.0f;
    float previousOutput = 0.0f;
    bool isBypassed = true;

    event bypassDc (float32 value)
    {
        isBypassed = value > 0.5f;
    }

    void main()
    {
        float coefficient = exp (-float (twoPi) * 20.0f / float (processor.frequency));

        loop
        {
            float sample = in;
            float filtered = sample - previousInput + coefficient * previousOutput;
            previousInput = sample;
            previousOutput = filtered;
            out <- isBypassed ? sample : filtered;
            advance();
        }
    }
}
```

Graph:

```cmajor
graph SeaMicDCOffset [[ main ]]
{
    input stream float microphone;
    input stream float farEndReference;
    output stream float cleanedMicrophone;
    output stream float cleanedReference;
    input event float32 bypassDc [[ name: "Bypassed (ON = dry signal)", init: 1, boolean ]];

    node microphoneDc = DCOffsetRemoval;
    node referenceDc = DCOffsetRemoval;

    connection
    {
        microphone -> microphoneDc.in;
        farEndReference -> referenceDc.in;
        bypassDc -> microphoneDc.bypassDc;
        bypassDc -> referenceDc.bypassDc;
        microphoneDc.out -> cleanedMicrophone;
        referenceDc.out -> cleanedReference;
    }
}
```

### 1.7 C++ equivalence

```cpp
struct DCOffsetRemoval
{
    float prevInput_  = 0.0f;
    float prevOutput_ = 0.0f;
    bool  bypassed_  = true;
    float coefficient_ = 0.0f;

    void prepare (double sampleRate)
    {
        coefficient_ = std::exp (-2.0 * M_PI * 20.0f / (float) sampleRate);
    }

    void setBypass (float v) { bypassed_ = v > 0.5f; }   // no clamp needed

    float processOneSample (float in)
    {
        const float filtered = in - prevInput_ + coefficient_ * prevOutput_;
        prevInput_  = in;
        prevOutput_ = filtered;
        return bypassed_ ? in : filtered;
    }
};
```

Mapping notes:

- `exp(...)` keeps a `float` argument and therefore returns `float`; this matches Cmajor's `float32` result. Promoting to `double` changes the last bits but is irrelevant for a 20 Hz pole.
- `twoPi` is a compile-time `float64` constant and `float(twoPi)` narrows it **before** the division. Reproduce that ordering for a bit-identical pole.
- The ternary returns the *unfiltered* `in` when bypassed, so no internal state leaks into the output path.

### 1.8 Pseudocode scaffold

```text
PROCEDURE DCOffsetRemoval
    INPUT sampleRate    OUTPUT processed stream

    STATE
        previousInput  : float = 0
        previousOutput : float = 0
        isBypassed     : bool  = TRUE
        coefficient    : float

    ON prepare(sampleRate):
        coefficient := exp(-2pi * 20 / sampleRate)

    ON event bypassDc(value):
        isBypassed := (value > 0.5)

    FOR EACH sample x:
        filtered := x - previousInput + coefficient * previousOutput
        previousInput  := x
        previousOutput := filtered
        IF isBypassed THEN out := x
        ELSE               out := filtered
```

### 1.9 Edge cases and gaps

- **Bypass click:** switching bypass mid-stream makes `out` jump between two different signals, producing a discontinuity. A `wetMix` ramp (as in `Tone`, §6.5) would fix it. Not implemented.
- The 20 Hz cutoff is fixed; there is no exposed parameter.
- Note the near-duplicate `DCBlock` processor in `chain1_filters.cmajor` uses `R = 1 - 2pi*20/fs` clamped to [0.9, 0.9995] instead of `exp(...)`. They are **not** equivalent. The `DCOffsetRemoval` version is the one in production. Do not unify without measurement.

---

## Module 2 — Acoustic Echo Cancellation (NLMS)

**Files:** `cmajor/modules/aec/SeaMicAEC.cmajor`, `cmajor/patches/SeaMicAEC/SeaMicAEC.cmajor`.

### 2.1 Objective

Estimate and subtract from the microphone signal the echo produced by the application's own playback, using the pre-DAC playback signal as the far-end reference. Adaptive FIR with normalised LMS and a double-talk freeze so that near-end speech is not corrupted. Must report ERLE and level telemetry, must remain safely bypassed when no reference exists, and must be a no-op (bit-transparent) when bypassed.

### 2.2 Interfaces

| Direction | Name | Type | Range | Init | Notes |
|---|---|---|---|---|---|
| in | `microphone` | stream float32 | — | — | near end d(n) |
| in | `farEndReference` | stream float32 | — | — | far end x(n) |
| out | `cleanedMicrophone` | stream float32 | — | — | |
| out | `erle` | value float32 | — | — | `10*log10(Pmic/Pres)` |
| out | `microphoneLevelDb` | value float32 | — | — | |
| out | `residualLevelDb` | value float32 | — | — | |
| out | `echoEstimateLevelDb` | value float32 | — | — | |
| in | `filterLength` | event float32 | 32..1024 | 512, step 32 | taps; clamped to >=16 internally |
| in | `stepSize` | event float32 | 0.01..2 | 0.5, step 0.01 | mu |
| in | `doubleTalkEnabled` | event float32 | boolean | 1 | |
| in | `bypassAec` | event float32 | boolean | 1 | hidden in the annotation |
| in | `bypassDcFilters` | event float32 | boolean | 1 | hidden; forced to 1 by the host |

### 2.3 Data structures

| Cmajor | Type | Init | Meaning | C++ |
|---|---|---|---|---|
| `maxTaps` | `int` (const) | `1024` | allocation size | `static constexpr int kMaxTaps = 1024;` |
| `weights` | `float32[1024]` | zeroed | adaptive FIR `h[0..activeTaps)` | `std::array<float,1024> weights_{};` |
| `referenceHistory` | `float32[2048]` | zeroed | doubled history window | `std::array<float,2048> history_{};` |
| `position` | `wrap<1024>` | `0` | write cursor | `int position_ = 0;` |
| `activeTaps` | `int` | `512` | current filter length | `int activeTaps_ = 512;` |
| `adaptationRate` | `float64` | `0.5` | mu | `double adaptationRate_ = 0.5;` |
| `powerSmoothing` | `float64` | `1/512` | alpha of reference power | `double powerSmoothing_ = 1.0/512.0;` |
| `referencePower` | `float64` | `0.0` | smoothed x^2 | `double referencePower_ = 0.0;` |
| `microphonePower` | `float64` | `0.0` | smoothed d^2 | `double microphonePower_ = 0.0;` |
| `residualPower` | `float64` | `0.0` | smoothed e^2 | `double residualPower_ = 0.0;` |
| `echoPower` | `float64` | `0.0` | smoothed yhat^2 | `double echoPower_ = 0.0;` |
| `doubleTalkDetection` | `bool` | `true` | DTD armed | `bool dtdEnabled_ = true;` |
| `bypass` | `bool` | `true` | dry | `bool bypassed_ = true;` |
| `adaptationFrozen` | `bool` | `false` | DTD result | `bool frozen_ = false;` |
| `converged` | `bool` | `false` | latch, once true stays true | `bool converged_ = false;` |

**Memory: 1024*4 + 2048*4 = 12288 bytes of array state.** Largest of all modules.

Note `position` is declared `wrap<1024>` but indexes a 2048-element array via `position + maxTaps`. This is intentional: the read offset `position + 1024` always lands in the upper (mirrored) half, so `referenceHistory[wrap<2048>(position + maxTaps - tap)]` yields the tap-delayed sample without ever reading a slot that has not been written.

### 2.4 Event handlers

```text
ON filterLength(value):
    taps := int(value)
    IF taps < 16 THEN taps := 16
    IF taps > 1024 THEN taps := 1024
    activeTaps     := taps
    powerSmoothing := 1.0 / float64(taps)

ON stepSize(value):          adaptationRate := float64(value)
ON doubleTalkEnabled(value): doubleTalkDetection := (value > 0.5)
ON bypassAec(value):         bypass := (value > 0.5)
```

Note: the declared GUI range is 32..1024 but the code floor is 16. `powerSmoothing` is recomputed on change but the already-smoothed `referencePower` is **not** reset, producing a discontinuity in the meters after a length change.

### 2.5 Start-up constants

```
meterSmoothing = 1.0 / max (processor.frequency * 0.1, 1.0)     // ~100 ms integration
```

Computed once before the loop. `powerSmoothing` is event-driven, not fixed.

### 2.6 Per-sample algorithm

1. `reference = farEndReference` (as `float64`), `mic = microphone` (as `float64`).
2. **Write** `referenceHistory[position] = reference`, and mirror to `referenceHistory[wrap<2048>(position + 1024)]`.
3. **Correlate:** `estimatedEcho = SUM over tap = 0..activeTaps-1 of w[tap] * history[wrap<2048>(position + 1024 - tap)]`.
4. `residual = mic - estimatedEcho`.
5. Update the four smoothed powers (`referencePower` with `powerSmoothing`; the other three with `meterSmoothing`).
6. **Convergence latch:** if `echoPower > 1e-7 AND echoPower > 0.5*microphonePower` then `converged = true` (never cleared).
7. **Double-talk:** `frozen = dtdEnabled AND converged AND echoPower > 1e-7 AND microphonePower > 4*echoPower`.
8. **Adapt** if `NOT bypass AND NOT frozen AND referencePower > 1e-8`:
   `step = residual * adaptationRate / (referencePower * activeTaps + 1e-6)`,
   then `w[tap] += step * history[wrap<2048>(position + 1024 - tap)]` for all taps.
9. `out = bypass ? mic : residual`.
10. Publish the four telemetry values.
11. `position = wrap<1024>(position + 1)`; `advance()`.

Step 8 is a per-sample LMS update (two loops of `activeTaps` each). This is the dominant cost: 2 * 512 multiply-adds per sample, about 16 M MAC/s at 16 kHz.

### 2.7 Current Cmajor code

```cmajor
processor SeaMicAECProcessor
{
    input stream float32 microphone;
    input stream float32 farEndReference;
    output stream float32 cleanedMicrophone;

    output value float32 erle;
    output value float32 microphoneLevelDb;
    output value float32 residualLevelDb;
    output value float32 echoEstimateLevelDb;

    input event float32 filterLength [[ name: "Filter Length (taps)", min: 32, max: 1024, init: 512, step: 32 ]];
    input event float32 stepSize [[ name: "Step Size", min: 0.01, max: 2, init: 0.5, step: 0.01 ]];
    input event float32 doubleTalkEnabled [[ name: "Double-Talk Detector", init: 1, boolean ]];
    input event float32 bypassAec [[ name: "Bypass AEC", init: 1, boolean, hidden: true ]];

    let maxTaps = 1024;

    float32[1024] weights;
    float32[2048] referenceHistory;
    wrap<1024> position = 0;
    int activeTaps = 512;

    float64 adaptationRate = 0.5;
    float64 powerSmoothing = 1.0 / 512.0;
    float64 referencePower = 0.0;
    float64 microphonePower = 0.0;
    float64 residualPower = 0.0;
    float64 echoPower = 0.0;

    bool doubleTalkDetection = true;
    bool bypass = true;
    bool adaptationFrozen = false;
    bool converged = false;

    event filterLength (float32 value)
    {
        int taps = int (value);
        if (taps < 16)
            taps = 16;
        if (taps > maxTaps)
            taps = maxTaps;

        activeTaps = taps;
        powerSmoothing = 1.0 / float64 (taps);
    }

    event stepSize (float32 value)
    {
        adaptationRate = float64 (value);
    }

    event doubleTalkEnabled (float32 value)
    {
        doubleTalkDetection = value > 0.5f;
    }

    event bypassAec (float32 value)
    {
        bypass = value > 0.5f;
    }

    void main()
    {
        float64 meterSmoothing = 1.0 / max (processor.frequency * 0.1, 1.0);

        loop
        {
            float64 reference = float64 (farEndReference);
            float64 mic = float64 (microphone);

            referenceHistory[position] = float32 (reference);
            referenceHistory[wrap<2048> (position + maxTaps)] = float32 (reference);

            float64 estimatedEcho = 0.0;
            for (int tap = 0; tap < activeTaps; ++tap)
                estimatedEcho = estimatedEcho
                    + float64 (weights[wrap<1024> (tap)])
                    * float64 (referenceHistory[wrap<2048> (position + maxTaps - tap)]);

            float64 residual = mic - estimatedEcho;

            referencePower = referencePower + (reference * reference - referencePower) * powerSmoothing;
            microphonePower = microphonePower + (mic * mic - microphonePower) * meterSmoothing;
            residualPower = residualPower + (residual * residual - residualPower) * meterSmoothing;
            echoPower = echoPower + (estimatedEcho * estimatedEcho - echoPower) * meterSmoothing;

            if (echoPower > 1.0e-7 && echoPower > 0.5 * microphonePower)
                converged = true;

            adaptationFrozen = doubleTalkDetection
                && converged
                && (echoPower > 1.0e-7)
                && (microphonePower > 4.0 * echoPower);

            if (! bypass && ! adaptationFrozen && referencePower > 1.0e-8)
            {
                float64 step = residual * adaptationRate
                    / (referencePower * float64 (activeTaps) + 1.0e-6);

                for (int tap = 0; tap < activeTaps; ++tap)
                {
                    wrap<1024> weightIndex = wrap<1024> (tap);
                    wrap<2048> historyIndex = wrap<2048> (position + maxTaps - tap);
                    weights[weightIndex] = float32 (
                        float64 (weights[weightIndex])
                        + step * float64 (referenceHistory[historyIndex]));
                }
            }

            float64 outputSample = bypass ? mic : residual;
            cleanedMicrophone <- float32 (outputSample);

            erle <- float32 (10.0 * log10 (
                (microphonePower + 1.0e-20) / (residualPower + 1.0e-20)));
            microphoneLevelDb <- float32 (10.0 * log10 (microphonePower + 1.0e-20));
            residualLevelDb <- float32 (10.0 * log10 (residualPower + 1.0e-20));
            echoEstimateLevelDb <- float32 (10.0 * log10 (echoPower + 1.0e-20));

            ++position;
            advance();
        }
    }
}
```

Graph (note the two hidden DC filters):

```cmajor
graph SeaMicAEC [[ main ]]
{
    input stream float32 microphone;
    input stream float32 farEndReference;
    output stream float32 cleanedMicrophone;

    input canceller.filterLength;
    input canceller.stepSize;
    input canceller.doubleTalkEnabled;
    input canceller.bypassAec;
    input event float32 bypassDcFilters [[ name: "Bypassed (ON = dry signal)", init: 1, boolean, hidden: true ]];

    output canceller.erle;
    output canceller.microphoneLevelDb;
    output canceller.residualLevelDb;
    output canceller.echoEstimateLevelDb;

    node dcMicrophone = DCOffsetRemoval;
    node dcReference = DCOffsetRemoval;
    node canceller = SeaMicAECProcessor;

    connection microphone -> dcMicrophone.in;
    connection dcMicrophone.out -> canceller.microphone;
    connection bypassDcFilters -> dcMicrophone.bypassDc;
    connection bypassDcFilters -> dcReference.bypassDc;
    connection farEndReference -> dcReference.in;
    connection dcReference.out -> canceller.farEndReference;
    connection canceller.cleanedMicrophone -> cleanedMicrophone;
}
```

### 2.8 C++ equivalence

```cpp
struct SeaMicAECProcessor
{
    static constexpr int kMaxTaps = 1024;
    static constexpr int kHistory = 2048;

    std::array<float, kMaxTaps> weights_{};
    std::array<float, kHistory> history_{};
    int    position_   = 0;      // wrap<1024>
    int    activeTaps_ = 512;

    double adaptationRate_ = 0.5;
    double powerSmoothing_ = 1.0 / 512.0;
    double referencePower_ = 0.0, microphonePower_ = 0.0;
    double residualPower_  = 0.0, echoPower_        = 0.0;

    bool dtdEnabled_ = true, bypassed_ = true;
    bool frozen_ = false, converged_ = false;

    double sampleRate_ = 16000.0, meterSmoothing_ = 6.25e-4;

    // wrap<N>: +/-1 correction, NOT a full modulo
    static int wrap (int i, int n) { return i < 0 ? i + n : (i >= n ? i - n : i); }

    void prepare (double sr)
    {
        sampleRate_ = sr;
        meterSmoothing_ = 1.0 / std::max (sr * 0.1, 1.0);
    }

    void setFilterLength (float v)
    {
        int taps = static_cast<int> (v);
        taps = std::min (std::max (taps, 16), kMaxTaps);
        activeTaps_     = taps;
        powerSmoothing_ = 1.0 / static_cast<double> (taps);
    }
    void setStepSize     (float v) { adaptationRate_ = v; }
    void setDoubleTalkOn (float v) { dtdEnabled_ = v > 0.5f; }
    void setBypass       (float v) { bypassed_ = v > 0.5f; }

    float erle_ = 0.f, micLevelDb_ = 0.f, residualLevelDb_ = 0.f, echoLevelDb_ = 0.f;

    float processOneSample (float microphone, float farEndReference)
    {
        const double reference = farEndReference;
        const double mic = microphone;

        history_[position_] = static_cast<float> (reference);
        history_[wrap (position_ + kMaxTaps, kHistory)] = static_cast<float> (reference);

        double estimatedEcho = 0.0;
        for (int tap = 0; tap < activeTaps_; ++tap)
            estimatedEcho += static_cast<double> (weights_[wrap (tap, kMaxTaps)])
                           * static_cast<double> (history_[wrap (position_ + kMaxTaps - tap, kHistory)]);

        const double residual = mic - estimatedEcho;

        referencePower_  += (reference * reference - referencePower_) * powerSmoothing_;
        microphonePower_ += (mic * mic - microphonePower_) * meterSmoothing_;
        residualPower_   += (residual * residual - residualPower_) * meterSmoothing_;
        echoPower_       += (estimatedEcho * estimatedEcho - echoPower_) * meterSmoothing_;

        if (echoPower_ > 1.0e-7 && echoPower_ > 0.5 * microphonePower_)
            converged_ = true;

        frozen_ = dtdEnabled_ && converged_
               && echoPower_ > 1.0e-7 && microphonePower_ > 4.0 * echoPower_;

        if (! bypassed_ && ! frozen_ && referencePower_ > 1.0e-8)
        {
            const double step = residual * adaptationRate_
                              / (referencePower_ * activeTaps_ + 1.0e-6);
            for (int tap = 0; tap < activeTaps_; ++tap)
            {
                const int wi = wrap (tap, kMaxTaps);
                const int hi = wrap (position_ + kMaxTaps - tap, kHistory);
                weights_[wi] = static_cast<float> (
                    static_cast<double> (weights_[wi]) + step * history_[hi]);
            }
        }

        erle_ = static_cast<float> (10.0 * std::log10 ((microphonePower_ + 1e-20) / (residualPower_ + 1e-20)));
        micLevelDb_      = static_cast<float> (10.0 * std::log10 (microphonePower_ + 1e-20));
        residualLevelDb_ = static_cast<float> (10.0 * std::log10 (residualPower_ + 1e-20));
        echoLevelDb_     = static_cast<float> (10.0 * std::log10 (echoPower_ + 1e-20));

        const float out = static_cast<float> (bypassed_ ? mic : residual);
        position_ = wrap (position_ + 1, kMaxTaps);
        return out;
    }
};
```

Mapping notes:

- `wrap<N>(i)` in Cmajor is defined for indices at most one period out of range, hence the ±1 correction helper. `i % n` would also be correct here but is slower and behaves differently for `i < -n` (which never occurs).
- The two `float64` → `float32` narrowing points (`referenceHistory` write, `weights` update) are where most of the precision is lost. Reproduce them exactly: the FIR taps live in `float`, everything else in `double`.
- `output value` endpoints are push telemetry; in C++ they are plain members read by the host between blocks.
- `hidden: true` on `bypassAec` and `bypassDcFilters` means the host drives them programmatically via `SeaMicAudio`, not from the GUI.

### 2.9 Pseudocode scaffold

```text
PROCEDURE SeaMicAECProcessor
    INPUT sampleRate
    OUTPUT cleanedMicrophone stream, erle, micLevelDb, residualLevelDb, echoLevelDb

    CONSTANT maxTaps = 1024

    STATE
        weights[0 .. maxTaps-1]          : array of float = 0     // adaptive FIR
        referenceHistory[0 .. 2*maxTaps-1] : array of float = 0    // mirrored window
        position          : int = 0                    // wraps at maxTaps
        activeTaps        : int = 512
        adaptationRate    : double = 0.5
        powerSmoothing    : double = 1/512
        referencePower, microphonePower, residualPower, echoPower : double = 0
        dtdEnabled : bool = TRUE
        bypassed   : bool = TRUE
        frozen     : bool = FALSE
        converged  : bool = FALSE

    ON prepare(sampleRate):
        meterSmoothing := 1 / max(sampleRate * 0.1, 1)

    ON event filterLength(value):
        taps := truncate(value); clamp taps to [16, maxTaps]
        activeTaps    := taps
        powerSmoothing := 1 / taps

    ON event stepSize(v):          adaptationRate := v
    ON event doubleTalkEnabled(v): dtdEnabled := (v > 0.5)
    ON event bypassAec(v):         bypassed := (v > 0.5)

    FOR EACH sample (d, x):                    // d = microphone, x = far end
        history[wrap(position)] := x
        history[wrap(position + maxTaps)] := x

        echoHat := 0
        FOR tap := 0 TO activeTaps - 1:
            echoHat := echoHat + weights[wrap(tap)]
                                * history[wrap(position + maxTaps - tap)]

        e := d - echoHat

        referencePower  := referencePower  + (x*x     - referencePower)  * powerSmoothing
        microphonePower := microphonePower + (d*d     - microphonePower) * meterSmoothing
        residualPower   := residualPower   + (e*e     - residualPower)   * meterSmoothing
        echoPower       := echoPower       + (echoHat*echoHat - echoPower) * meterSmoothing

        IF echoPower > 1e-7 AND echoPower > 0.5 * microphonePower:
            converged := TRUE                        // latch, never cleared

        frozen := dtdEnabled AND converged
                  AND echoPower > 1e-7
                  AND microphonePower > 4 * echoPower

        IF NOT bypassed AND NOT frozen AND referencePower > 1e-8:
            step := e * adaptationRate / (referencePower * activeTaps + 1e-6)
            FOR tap := 0 TO activeTaps - 1:
                weights[wrap(tap)] := weights[wrap(tap)]
                                    + step * history[wrap(position + maxTaps - tap)]

        IF bypassed THEN out := d ELSE out := e

        erle           := 10*log10((microphonePower + 1e-20) / (residualPower + 1e-20))
        micLevelDb     := 10*log10(micophonePower + 1e-20)
        residualLevelDb:= 10*log10(residualPower + 1e-20)
        echoLevelDb    := 10*log10(echoPower + 1e-20)

        position := wrap(position + 1)
```

### 2.10 Numerical guards

| Guard | Purpose |
|---|---|
| `powerSmoothing` recomputed on length change | keeps the reference-power integration window equal to the filter length |
| `referencePower * activeTaps + 1e-6` | avoids division by zero at silence |
| `+1e-20` in every log | avoids `log10(0)` = -inf |
| `echoPower > 1e-7` | ignores numerical noise when declaring convergence and DTD |
| `converged` never reset | the DTD is only trustworthy after the filter has locked |

### 2.11 Gaps vs objective — read before writing pseudocode

- **No resilience (RES) and no comfort noise.** A previous rewrite added RES, a delay estimator and block NLMS and **measured about 0 dB ERLE against a 25 dB target**, so it was reverted (`MEMORY.md`). Do not re-introduce it without fixing convergence first.
- **No fractional delay or echo-path delay estimation.** Alignment relies on the acoustic path being covered by `activeTaps / fs` (32 ms at 16 kHz, about 10.7 ms at 48 kHz). A longer path cannot be cancelled, and because the length is in taps, coverage *shrinks* as the rate rises.
- **No leak control and no filter re-initialisation.** Once `converged` latches, the DTD freezes adaptation permanently during double talk; a later path change is never tracked.
- Changing `filterLength` does not reset `referencePower`.
- `bypassAec` is `hidden` in the annotation but is in the host's `bypassEndpoints` list, so it is driven programmatically.
- **Host rule to reproduce outside Cmajor:** AEC stays bypassed and its Activate/Solo buttons stay locked until `SeaMicAudio.connectPlaybackSource(node)` has attached a live same-context playback node; losing the last source forces bypass.

---

## Module 3 — De-Reverb (envelope masking)

**Files:** `cmajor/modules/dsp/DeReverb.cmajor`, `cmajor/patches/SeaMicDeReverb/SeaMicDeReverb.cmajor`.

### 3.1 Objective

Reduce the perceptual effect of room reverberation on speech by attenuating signal components whose short-term level falls well below their longer-term level, i.e. the late and diffuse tail, without introducing audible gain modulation. **Attenuation only**, hard-capped at -6 dB, with slow gain smoothing. It is explicitly *not* a deconvolution or a full acoustic de-reverberator.

### 3.2 Interfaces

| Direction | Name | Type | Range | Init |
|---|---|---|---|---|
| in | `in` / `out` | stream float | — | — |
| in | `amount` | event float32 | 0..1 | 0.5, step 0.05 |
| in | `bypassDeReverb` | event float32 | boolean | 1 |

### 3.3 Data structures

| Cmajor | Type | Init | Meaning | C++ |
|---|---|---|---|---|
| `intensity` | `float` | `0.5f` | `amount`, clamped to [0,1] | `float intensity_ = 0.5f;` |
| `isBypassed` | `bool` | `true` | | `bool bypassed_ = true;` |
| `fastEnvelope` | `float` | `0.0f` | 1 ms attack / 30 ms release tracker of abs(x) | `float fastEnv_ = 0.f;` |
| `slowEnvelope` | `float` | `0.0f` | 50 ms / 500 ms tracker | `float slowEnv_ = 0.f;` |
| `gainEnvelope` | `float` | `1.0f` | smoothed gain | `float gainEnv_ = 1.f;` |

Three local `float`s: `fs`, `minimumGain = 0.50118723f` (which is exactly `10^(-6/20)`). **No arrays, 5 persistent members.**

### 3.4 Start-up constants

```
fastAttack   = 1 - exp(-1/(0.001*fs))     fastRelease  = 1 - exp(-1/(0.030*fs))
slowAttack   = 1 - exp(-1/(0.050*fs))     slowRelease  = 1 - exp(-1/(0.500*fs))
gainAttack   = 1 - exp(-1/(0.020*fs))     gainRelease  = 1 - exp(-1/(0.120*fs))
minimumGain  = 0.50118723f    // -6 dB
```

`gainAttack` is used when the target gain **decreases**, that is, when gain is being reduced. The naming is inverted relative to intuition and must be preserved.

### 3.5 Per-sample algorithm

1. `sample = in`; `level = abs(sample)`.
2. Coef selection: `fastCoefficient = (level > fastEnvelope) ? fastAttack : fastRelease`; same for slow with `slowAttack/slowRelease`.
3. `fastEnvelope += (level - fastEnvelope) * fastCoefficient`
   `slowEnvelope += (level - slowEnvelope) * slowCoefficient`
4. `targetGain = 1.0`; if not bypassed:
   - `ratio = fastEnvelope / (slowEnvelope + 1e-7)`
   - `targetGain = clamp(ratio, 1e-6, 1.0) ^ intensity`
   - `targetGain = max(targetGain, minimumGain)` which floors it at -6 dB
5. `gainCoefficient = (targetGain < gainEnvelope) ? gainAttack : gainRelease`
6. `gainEnvelope += (targetGain - gainEnvelope) * gainCoefficient`
7. `out = sample * gainEnvelope`

Step 4 is the whole algorithm: the **ratio** of fast to slow envelope is at most 1 by construction (fast is always below slow given the faster attack and slower release), raised to `intensity` and floored at -6 dB. `intensity = 0` disables it; `intensity = 1` applies the raw ratio.

### 3.6 Current Cmajor code

```cmajor
processor DeReverb
{
    input stream float in;
    output stream float out;

    input event float32 amount [[ name: "De-reverb amount", min: 0.0, max: 1.0, init: 0.5, step: 0.05 ]];
    input event float32 bypassDeReverb [[ name: "Bypassed (ON = dry signal)", init: 1, boolean ]];

    float intensity = 0.5f;
    bool isBypassed = true;
    float fastEnvelope = 0.0f;
    float slowEnvelope = 0.0f;
    float gainEnvelope = 1.0f;

    event amount (float32 value)
    {
        intensity = min (max (value, 0.0f), 1.0f);
    }

    event bypassDeReverb (float32 value)
    {
        isBypassed = value > 0.5f;
    }

    void main()
    {
        float fs = float (processor.frequency);
        float fastAttack = 1.0f - exp (-1.0f / (0.001f * fs));
        float fastRelease = 1.0f - exp (-1.0f / (0.030f * fs));
        float slowAttack = 1.0f - exp (-1.0f / (0.050f * fs));
        float slowRelease = 1.0f - exp (-1.0f / (0.500f * fs));
        float gainAttack = 1.0f - exp (-1.0f / (0.020f * fs));
        float gainRelease = 1.0f - exp (-1.0f / (0.120f * fs));
        float minimumGain = 0.50118723f;

        loop
        {
            float sample = in;
            float level = abs (sample);

            float fastCoefficient = level > fastEnvelope ? fastAttack : fastRelease;
            float slowCoefficient = level > slowEnvelope ? slowAttack : slowRelease;
            fastEnvelope = fastEnvelope + (level - fastEnvelope) * fastCoefficient;
            slowEnvelope = slowEnvelope + (level - slowEnvelope) * slowCoefficient;

            float targetGain = 1.0f;
            if (! isBypassed)
            {
                float ratio = fastEnvelope / (slowEnvelope + 0.0000001f);
                targetGain = pow (max (min (ratio, 1.0f), 0.000001f), intensity);
                targetGain = max (targetGain, minimumGain);
            }

            float gainCoefficient = targetGain < gainEnvelope ? gainAttack : gainRelease;
            gainEnvelope = gainEnvelope + (targetGain - gainEnvelope) * gainCoefficient;
            out <- sample * gainEnvelope;
            advance();
        }
    }
}
```

### 3.7 C++ equivalence

```cpp
struct DeReverb
{
    float intensity_ = 0.5f, fastEnv_ = 0.0f, slowEnv_ = 0.0f, gainEnv_ = 1.0f;
    bool  bypassed_  = true;
    float fs_ = 16000.f;
    float fastAttack_, fastRelease_, slowAttack_, slowRelease_, gainAttack_, gainRelease_;
    static constexpr float kMinGain = 0.50118723f;   // -6 dB

    void prepare (double sr)
    {
        fs_ = (float) sr;
        fastAttack_  = 1.f - std::exp (-1.f / (0.001f * fs_));
        fastRelease_ = 1.f - std::exp (-1.f / (0.030f * fs_));
        slowAttack_  = 1.f - std::exp (-1.f / (0.050f * fs_));
        slowRelease_ = 1.f - std::exp (-1.f / (0.500f * fs_));
        gainAttack_  = 1.f - std::exp (-1.f / (0.020f * fs_));
        gainRelease_ = 1.f - std::exp (-1.f / (0.120f * fs_));
    }

    void setAmount (float v) { intensity_ = std::fmin (std::fmax (v, 0.f), 1.f); }
    void setBypass (float v) { bypassed_ = v > 0.5f; }

    float processOneSample (float in)
    {
        const float sample = in;
        const float level = std::fabs (sample);

        fastEnv_ += (level - fastEnv_) * (level > fastEnv_ ? fastAttack_ : fastRelease_);
        slowEnv_ += (level - slowEnv_) * (level > slowEnv_ ? slowAttack_ : slowRelease_);

        float targetGain = 1.0f;
        if (! bypassed_)
        {
            const float ratio = fastEnv_ / (slowEnv_ + 0.0000001f);
            targetGain = std::pow (std::fmax (std::fmin (ratio, 1.f), 0.000001f), intensity_);
            targetGain = std::fmax (targetGain, kMinGain);
        }

        gainEnv_ += (targetGain - gainEnv_) * (targetGain < gainEnv_ ? gainAttack_ : gainRelease_);
        return sample * gainEnv_;
    }
};
```

Mapping notes:

- `out` is **not** a bypass ternary here. The gain envelope itself is forced to unity when bypassed and then smoothed, so un-bypassing takes about 20 ms to reach full effect and re-bypassing takes about 120 ms to return to dry. **This is deliberate**: it is what makes the module click-free. Do not "fix" it into a ternary.
- `pow(x, intensity)` with `intensity = 0` returns exactly 1.0, so `amount = 0` is a clean no-op.
- `std::pow(float, float)` resolves to the `float` overload, matching Cmajor's `float32` `pow`.

### 3.8 Pseudocode scaffold

```text
PROCEDURE DeReverb
    STATE intensity = 0.5, fastEnvelope = 0, slowEnvelope = 0, gainEnvelope = 1
          bypassed = TRUE

    ON prepare(fs):
        fastAttack   := 1 - exp(-1/(0.001*fs)); fastRelease := 1 - exp(-1/(0.030*fs))
        slowAttack   := 1 - exp(-1/(0.050*fs));  slowRelease := 1 - exp(-1/(0.500*fs))
        gainAttack   := 1 - exp(-1/(0.020*fs));  gainRelease := 1 - exp(-1/(0.120*fs))
        minimumGain  := 0.50118723

    ON event amount(v):      intensity := clamp(v, 0, 1)
    ON event bypassDeReverb(v): bypassed := (v > 0.5)

    FOR EACH sample x:
        level := abs(x)

        fastEnvelope := fastEnvelope + (level - fastEnvelope)
                                 * (level > fastEnvelope ? fastAttack : fastRelease)
        slowEnvelope := slowEnvelope + (level - slowEnvelope)
                                 * (level > slowEnvelope ? slowAttack : slowRelease)

        IF bypassed THEN targetGain := 1
        ELSE
            ratio      := fastEnvelope / (slowEnvelope + 1e-7)
            targetGain := clamp(ratio, 1e-6, 1) ^ intensity
            targetGain := max(targetGain, minimumGain)

        gainEnvelope := gainEnvelope + (targetGain - gainEnvelope)
                                 * (targetGain < gainEnvelope ? gainAttack : gainRelease)

        out := x * gainEnvelope
```

### 3.9 Gaps vs objective

- No true deconvolution; only envelope-ratio masking. State this in the pseudocode header so it is not mistaken for an incomplete implementation.
- The -6 dB floor is hard-coded and the 0 dB ceiling is enforced by `min(ratio, 1.0)`.
- The envelopes track `abs(x)` (a rectifier), not RMS or peak-hold; asymmetric rectification is intentional.
- No DC assumption is made: if a DC offset reaches this module the ratio collapses to about 1. Stage 1 handles that.
- Not yet validated on real microphone recordings (`cmajor/modules/dsp/README.md`, validation section).

---

## Module 4 — Noise Gate / VAD

**Files:** `chain2_vad.cmajor` (processor `VAD`), `chain3_agc_gate_limit.cmajor` (processor `SoftGate`), `cmajor/patches/SeaMicNoiseGateVAD/SeaMicNoiseGateVAD.cmajor` (graph).

### 4.1 Objective

Detect speech in a noisy microphone signal and apply a soft, click-free noise gate. Detection must use a rolling level estimate against an adaptive noise floor with SNR hysteresis, must survive word gaps via hangover, must never learn the floor from speech, and must expose all thresholds as real-time parameters. The gate must add a hold after speech ends and fade to a configurable depth. **Target (not implemented): Otsu bimodality classification.**

### 4.2 Interfaces

VAD:

| Direction | Name | Type | Range | Init |
|---|---|---|---|---|
| in | `in` | stream float | — | — |
| out | `speech` | stream float | 0..1 | — |
| out | `debugSnr`, `debugFloor`, `debugRms` | stream float | — | — |
| in | `bypassVad` | event float32 | boolean | 1 |
| in | `enterDb` | event float32 | 1..20 | 9.0, step 0.5 |
| in | `exitDb` | event float32 | 0..15 | 4.0, step 0.5 |
| in | `hangoverMs` | event float32 | 0..2000 | 400.0, step 50 |

SoftGate:

| Direction | Name | Type | Range | Init |
|---|---|---|---|---|
| in | `in`, `speech` | stream float | — | — |
| out | `out` | stream float | — | — |
| in | `bypassGate` | event float32 | boolean | 1 |
| in | `gateDepthDb` | event float32 | 0..60 | 30.0, step 1 |
| in | `gateHoldMs` | event float32 | 0..1000 | 150.0, step 25 |

The `debug*` outputs are scaled for display as `(20*log10(v) + 100) * 0.01`, i.e. 0.0 = -100 dB and 1.0 = 0 dBFS.

### 4.3 Data structures — VAD

| Cmajor | Type | Init | Meaning | C++ |
|---|---|---|---|---|
| `enterLevelDb` | `float` | `9.0f` | SNR enter threshold | `float enterDb_ = 9.f;` |
| `exitLevelDb` | `float` | `4.0f` | SNR exit threshold | `float exitDb_ = 4.f;` |
| `hangTimeMs` | `float` | `400.0f` | hangover | `float hangoverMs_ = 400.f;` |
| `absoluteExitLevel` | `float` | `0.001f` | -60 dBFS absolute close guard | `float absExit_ = 0.001f;` |
| `ring` | `float[2048]` | zeroed | RMS sliding window | `std::array<float,2048> ring_{};` |
| `winLen` | `int` | `512` | window length, set at `fsInit` | `int winLen_ = 512;` |
| `pos` | `int` | `0` | ring cursor | `int pos_ = 0;` |
| `filled` | `int` | `0` | warm-up sample counter | `int filled_ = 0;` |
| `sumSq` | `float` | `0.0f` | running sum of x^2 | `float sumSq_ = 0.f;` |
| `subMinA/B/C` | `float` x3 | `0.01f` | last three 1-second sub-block minima | `float subMinA_ = .01f, subMinB_, subMinC_;` |
| `curSubMin` | `float` | `1000.0f` | current sub-block running minimum | `float curSubMin_ = 1000.f;` |
| `subCount` | `int` | `0` | samples into the current sub-block | `int subCount_ = 0;` |
| `subLen` | `int` | `16000` | sub-block length = 1 s | `int subLen_ = 16000;` |
| `noiseFloor` | `float` | `0.01f` | adaptive floor | `float noiseFloor_ = 0.01f;` |
| `floorCap` | `float` | `0.01f` | -40 dBFS upper clamp | `float floorCap_ = 0.01f;` |
| `floorMin` | `float` | `1e-7f` | lower clamp | `float floorMin_ = 1e-7f;` |
| `hangCount` | `float` | `0.0f` | samples spent below the exit threshold | `float hangCount_ = 0.f;` |
| `isSpeech` | `float` | `0.0f` | 0/1 detector state | `float isSpeech_ = 0.f;` |
| `isBypassed` | `bool` | `true` | | `bool bypassed_ = true;` |
| `initSamp` / `initLen` | `int` | `0` / `4000` | 250 ms floor-seeding window | `int initSamp_ = 0, initLen_ = 4000;` |
| `fsInit` | `int` | `0` | one-shot init flag | `bool fsInit_ = false;` |

**19 state members plus a 2048-float array (8 KB).**

### 4.4 Data structures — SoftGate

| Cmajor | Type | Init | Meaning | C++ |
|---|---|---|---|---|
| `att` | `float` | `0.0f` | current attenuation in dB, 0 = open | `float att_ = 0.f;` |
| `holdExtra` | `float` | `0.0f` | samples held open after the VAD drops | `float holdExtra_ = 0.f;` |
| `closeAttDb` | `float` | `30.0f` | gate depth | `float closeAttDb_ = 30.f;` |
| `holdTimeMs` | `float` | `150.0f` | gate hold | `float holdTimeMs_ = 150.f;` |
| `isBypassed` | `bool` | `true` | | `bool bypassed_ = true;` |

**5 members, no arrays.** It starts *open* (`att = 0`), the opposite of the VAD.

### 4.5 Start-up constants

VAD, once, guarded by `fsInit`:

```
winLen  := int(0.032 * fs)   clamp to [64, 2048]      // 512 at 16 kHz
subLen  := int(fs)                                      // 16000
initLen := int(0.25 * fs)                               // 4000
```

SoftGate:

```
attCoeff := 1 - exp(-1/(0.030*fs))    // close ramp  (tau = 30 ms)
relCoeff := 1 - exp(-1/(0.150*fs))    // release ramp (tau = 150 ms)
```

Per sample: `holdLimit := holdTimeMs * 0.001 * fs`.

### 4.6 Per-sample algorithm — VAD

1. `x = in`; `oldest = ring[pos]`
2. `sumSq = max(0, sumSq - oldest^2 + x^2)` — the `max(0, ...)` is the documented roundoff guard; without it, a slightly negative `sumSq` produces NaN downstream and silences the whole chain.
3. `ring[pos] = x`; `pos = (pos + 1) mod winLen`; `filled = min(filled + 1, winLen)`
4. `rms = sqrt(sumSq / filled)`; `if rms < floorMin: rms = floorMin`
5. **Sub-block minimum tracking, only while not in speech:** `if isSpeech < 0.5 and rms < curSubMin: curSubMin = rms`
6. `subCount += 1`; when `subCount >= subLen` (the 1 s boundary):
   - if not speech: shift `C <- B`, `B <- A`, `A := (curSubMin > 100 ? noiseFloor : curSubMin)`
   - if speech: shift `C <- B`, `B <- A`, `A := noiseFloor` — the floor is frozen during speech
   - `curSubMin = 1000`
   - `noiseFloor = min(noiseFloor, A, B, C)` — the floor can only **fall**
7. **Initial seeding** while `initSamp < initLen`: `noiseFloor = min(noiseFloor, rms)`, and all three sub-mins are reset to `noiseFloor`.
8. `noiseFloor = clamp(noiseFloor, floorMin, floorCap)` (at most -40 dBFS)
9. `snrDb = 20*log10(rms / noiseFloor)`; publish `debugSnr/debugFloor/debugRms`
10. `enterT = enterLevelDb`; `exitT = min(exitLevelDb, enterT)` — hysteresis is enforced structurally
11. `hangLimit = hangTimeMs * 0.001 * fs`
12. If `isSpeech > 0.5`:
    - if `snrDb < exitT` **or** `rms < absoluteExitLevel`: `hangCount += 1`; if `hangCount >= hangLimit` then `isSpeech = 0; hangCount = 0`
    - else `hangCount = 0`
    else (not speech):
    - if `snrDb > enterT` then `isSpeech = 1; hangCount = 0`
13. `speech = isBypassed ? 1.0 : isSpeech`

### 4.7 Per-sample algorithm — SoftGate

1. `holdLimit = holdTimeMs * 0.001 * fs`; `want = 0.0`
2. If `speech < 0.5`:
   - `if holdExtra < holdLimit: holdExtra += 1` else `want = closeAttDb`
3. Else `holdExtra = 0`
4. `att = att + (want - att) * (want > att ? attCoeff : relCoeff)`
5. `g = 10^(-att/20)`; `out = isBypassed ? x : x * g`

Note the ramp selection: `want > att` (closing, since `want` is an attenuation) uses `attCoeff`; opening uses `relCoeff`.

### 4.8 Current Cmajor code

```cmajor
processor VAD
{
    input  stream float in;
    output stream float speech;
    output stream float debugSnr;
    output stream float debugFloor;
    output stream float debugRms;
    input event float32 bypassVad [[ name: "Bypassed (ON = detector passes speech)", init: 1, boolean ]];
    input event float32 enterDb [[ name: "SNR enter threshold", min: 1.0, max: 20.0, init: 9.0, step: 0.5 ]];
    input event float32 exitDb [[ name: "SNR exit threshold", min: 0.0, max: 15.0, init: 4.0, step: 0.5 ]];
    input event float32 hangoverMs [[ name: "VAD hangover", min: 0.0, max: 2000.0, init: 400.0, step: 50.0 ]];
    float enterLevelDb = 9.0f;
    float exitLevelDb = 4.0f;
    float hangTimeMs = 400.0f;
    float absoluteExitLevel = 0.001f;
    float[2048] ring;
    int   winLen = 512;
    int   pos = 0;
    int   filled = 0;
    float sumSq = 0.0f;
    float subMinA = 0.01f;
    float subMinB = 0.01f;
    float subMinC = 0.01f;
    float curSubMin = 1000.0f;
    int   subCount = 0;
    int   subLen = 16000;
    float noiseFloor = 0.01f;
    float floorCap = 0.01f;
    float floorMin = 0.0000001f;
    float hangCount = 0.0f;
    float isSpeech = 0.0f;
    bool isBypassed = true;
    int   initSamp = 0;
    int   initLen = 4000;
    int   fsInit = 0;

    event bypassVad (float32 value)
    {
        isBypassed = value > 0.5f;
    }

    event enterDb (float32 value)
    {
        float v = value;
        if (v < 1.0f) v = 1.0f;
        if (v > 20.0f) v = 20.0f;
        enterLevelDb = v;
    }

    event exitDb (float32 value)
    {
        float v = value;
        if (v < 0.0f) v = 0.0f;
        if (v > 15.0f) v = 15.0f;
        exitLevelDb = v;
    }

    event hangoverMs (float32 value)
    {
        float v = value;
        if (v < 0.0f) v = 0.0f;
        if (v > 2000.0f) v = 2000.0f;
        hangTimeMs = v;
    }

    void main()
    {
        float fs = float (processor.frequency);
        if (fsInit == 0)
        {
            winLen = int (0.032f * fs);
            if (winLen > 2048) winLen = 2048;
            if (winLen < 64) winLen = 64;
            subLen = int (fs);
            initLen = int (0.25f * fs);
            fsInit = 1;
        }
        loop
        {
            float x = in;
            float oldest = ring.at(pos);
            sumSq = max (0.0f, sumSq - oldest * oldest + x * x);
            ring.at(pos) = x;
            pos = pos + 1;
            if (pos >= winLen) pos = 0;
            if (filled < winLen) filled = filled + 1;
            float rms = sqrt (sumSq / float (filled));
            if (rms < floorMin) rms = floorMin;
            if (isSpeech < 0.5f)
            {
                if (rms < curSubMin) curSubMin = rms;
            }
            subCount = subCount + 1;
            if (subCount >= subLen)
            {
                subCount = 0;
                if (isSpeech < 0.5f)
                {
                    subMinC = subMinB;
                    subMinB = subMinA;
                    if (curSubMin > 100.0f) subMinA = noiseFloor;
                    else subMinA = curSubMin;
                }
                else
                {
                    subMinC = subMinB;
                    subMinB = subMinA;
                    subMinA = noiseFloor;
                }
                curSubMin = 1000.0f;
                if (subMinA < noiseFloor) noiseFloor = subMinA;
                if (subMinB < noiseFloor) noiseFloor = subMinB;
                if (subMinC < noiseFloor) noiseFloor = subMinC;
            }
            if (initSamp < initLen)
            {
                if (rms < noiseFloor) noiseFloor = rms;
                subMinA = noiseFloor;
                subMinB = noiseFloor;
                subMinC = noiseFloor;
                curSubMin = 1000.0f;
                initSamp = initSamp + 1;
            }
            if (noiseFloor > floorCap) noiseFloor = floorCap;
            if (noiseFloor < floorMin) noiseFloor = floorMin;
            float snrDb = 20.0f * log10 (rms / noiseFloor);
            debugSnr <- snrDb;
            debugFloor <- (20.0f * log10 (noiseFloor) + 100.0f) * 0.01f;
            debugRms <- (20.0f * log10 (rms) + 100.0f) * 0.01f;
            float enterT = enterLevelDb;
            float exitT = exitLevelDb;
            if (exitT > enterT) exitT = enterT;
            float hangLimit = hangTimeMs * 0.001f * fs;
            if (isSpeech > 0.5f)
            {
                if (snrDb < exitT || rms < absoluteExitLevel)
                {
                    hangCount = hangCount + 1.0f;
                    if (hangCount >= hangLimit)
                    {
                        isSpeech = 0.0f;
                        hangCount = 0.0f;
                    }
                }
                else
                {
                    hangCount = 0.0f;
                }
            }
            else
            {
                if (snrDb > enterT)
                {
                    isSpeech = 1.0f;
                    hangCount = 0.0f;
                }
            }
            speech <- isBypassed ? 1.0f : isSpeech;
            advance();
        }
    }
}
```

```cmajor
processor SoftGate
{
    input  stream float in;
    input  stream float speech;
    output stream float out;
    input event float32 bypassGate [[ name: "Bypassed (ON = dry signal)", init: 1, boolean ]];
    input event float32 gateDepthDb [[ name: "Gate depth", min: 0.0, max: 60.0, init: 30.0, step: 1.0 ]];
    input event float32 gateHoldMs [[ name: "Gate hold after speech", min: 0.0, max: 1000.0, init: 150.0, step: 25.0 ]];
    float att = 0.0f;
    float holdExtra = 0.0f; // extra gate hold after VAD exit (longer hold)
    float closeAttDb = 30.0f;
    float holdTimeMs = 150.0f;
    bool isBypassed = true;

    event bypassGate (float32 value)
    {
        isBypassed = value > 0.5f;
    }

    event gateDepthDb (float32 value)
    {
        float v = value;
        if (v < 0.0f) v = 0.0f;
        if (v > 60.0f) v = 60.0f;
        closeAttDb = v;
    }

    event gateHoldMs (float32 value)
    {
        float v = value;
        if (v < 0.0f) v = 0.0f;
        if (v > 1000.0f) v = 1000.0f;
        holdTimeMs = v;
    }

    void main()
    {
        float fs = float (processor.frequency);
        float attCoeff = 1.0f - exp (-1.0f / (0.030f * fs));
        float relCoeff = 1.0f - exp (-1.0f / (0.150f * fs));
        loop
        {
            float x = in;
            float sp = speech;
            float holdLimit = holdTimeMs * 0.001f * fs;
            float want = 0.0f;
            if (sp < 0.5f)
            {
                // hold the gate open for gateHoldMs after VAD drops
                if (holdExtra < holdLimit)
                    holdExtra = holdExtra + 1.0f;
                else
                    want = closeAttDb;
            }
            else
            {
                holdExtra = 0.0f;
            }
            if (want > att)
                att = att + (want - att) * attCoeff;
            else
                att = att + (want - att) * relCoeff;
            float g = pow (10.0f, -att / 20.0f);
            out <- isBypassed ? x : x * g;
            advance();
        }
    }
}
```

Graph:

```cmajor
graph SeaMicNoiseGateVAD [[ main ]]
{
    input  stream float in;
    output stream float out;
    output stream float speech;
    input vad.bypassVad;
    input vad.enterDb;
    input vad.exitDb;
    input vad.hangoverMs;
    input gate.bypassGate;
    input gate.gateDepthDb;
    input gate.gateHoldMs;

    node vad  = VAD;
    node gate = SoftGate;

    connection
    {
        in -> vad.in;
        in -> gate.in;
        vad.speech -> gate.speech;
        vad.speech -> speech;
        gate.out -> out;
    }
}
```

### 4.9 C++ equivalence — VAD

```cpp
struct VAD
{
    std::array<float, 2048> ring_{};
    int   winLen_ = 512, subLen_ = 16000, initLen_ = 4000;
    int   pos_ = 0, filled_ = 0, subCount_ = 0, initSamp_ = 0;
    bool  fsInit_ = false;

    float sumSq_ = 0.f;
    float subMinA_ = .01f, subMinB_ = .01f, subMinC_ = .01f, curSubMin_ = 1000.f;
    float noiseFloor_ = 0.01f, floorCap_ = 0.01f, floorMin_ = 1e-7f;
    float hangCount_ = 0.f, isSpeech_ = 0.f;
    float enterDb_ = 9.f, exitDb_ = 4.f, hangoverMs_ = 400.f;
    static constexpr float kAbsExitLevel = 0.001f;   // -60 dBFS
    bool  bypassed_ = true;
    float fs_ = 16000.f;

    void prepare (double sr)
    {
        if (fsInit_) return;
        fs_ = (float) sr;
        winLen_  = std::min (std::max ((int)(0.032f * fs_), 64), 2048);
        subLen_  = (int) fs_;
        initLen_ = (int)(0.25f * fs_);
        fsInit_  = true;
    }
    void setBypass     (float v) { bypassed_ = v > 0.5f; }
    void setEnterDb    (float v) { enterDb_ = std::fmin (std::fmax (v, 1.f), 20.f); }
    void setExitDb     (float v) { exitDb_ = std::fmin (std::fmax (v, 0.f), 15.f); }
    void setHangoverMs (float v) { hangoverMs_ = std::fmin (std::fmax (v, 0.f), 2000.f); }

    float processOneSample (float in, float& dbgSnr, float& dbgFloor, float& dbgRms)
    {
        const float x = in;
        const float oldest = ring_[pos_];
        sumSq_ = std::fmax (0.f, sumSq_ - oldest * oldest + x * x);   // NaN guard
        ring_[pos_] = x;
        if (++pos_ >= winLen_) pos_ = 0;
        if (filled_ < winLen_) ++filled_;

        float rms = std::sqrt (sumSq_ / (float) filled_);
        if (rms < floorMin_) rms = floorMin_;

        if (isSpeech_ < 0.5f && rms < curSubMin_) curSubMin_ = rms;

        if (++subCount_ >= subLen_)
        {
            subCount_ = 0;
            subMinC_ = subMinB_; subMinB_ = subMinA_;
            subMinA_ = (isSpeech_ < 0.5f)
                     ? ((curSubMin_ > 100.f) ? noiseFloor_ : curSubMin_)
                     : noiseFloor_;                      // floor frozen during speech
            curSubMin_ = 1000.f;
            noiseFloor_ = std::fmin (noiseFloor_,
                                     std::fmin (subMinA_, std::fmin (subMinB_, subMinC_)));
        }

        if (initSamp_ < initLen_)
        {
            if (rms < noiseFloor_) noiseFloor_ = rms;
            subMinA_ = subMinB_ = subMinC_ = noiseFloor_;
            curSubMin_ = 1000.f;
            ++initSamp_;
        }

        noiseFloor_ = std::fmin (floorCap_, std::fmax (floorMin_, noiseFloor_));

        const float snrDb = 20.f * std::log10 (rms / noiseFloor_);
        dbgSnr   = snrDb;
        dbgFloor = (20.f * std::log10 (noiseFloor_) + 100.f) * 0.01f;
        dbgRms   = (20.f * std::log10 (rms) + 100.f) * 0.01f;

        const float enterT = enterDb_;
        const float exitT  = std::fmin (exitDb_, enterT);
        const float hangLimit = hangoverMs_ * 0.001f * fs_;

        if (isSpeech_ > 0.5f)
        {
            if (snrDb < exitT || rms < kAbsExitLevel)
            {
                if (++hangCount_ >= hangLimit) { isSpeech_ = 0.f; hangCount_ = 0.f; }
            }
            else hangCount_ = 0.f;
        }
        else if (snrDb > enterT) { isSpeech_ = 1.f; hangCount_ = 0.f; }

        return bypassed_ ? 1.f : isSpeech_;
    }
};
```

### 4.10 C++ equivalence — SoftGate

```cpp
struct SoftGate
{
    float att_ = 0.f, holdExtra_ = 0.f, closeAttDb_ = 30.f, holdTimeMs_ = 150.f;
    bool  bypassed_ = true;
    float fs_ = 16000.f, attCoeff_ = 2.0811e-3f, relCoeff_ = 4.1658e-4f;

    void prepare (double sr)
    {
        fs_ = (float) sr;
        attCoeff_ = 1.f - std::exp (-1.f / (0.030f * fs_));
        relCoeff_ = 1.f - std::exp (-1.f / (0.150f * fs_));
    }
    void setBypass      (float v) { bypassed_ = v > 0.5f; }
    void setGateDepthDb (float v) { closeAttDb_ = std::fmin (std::fmax (v, 0.f), 60.f); }
    void setGateHoldMs  (float v) { holdTimeMs_ = std::fmin (std::fmax (v, 0.f), 1000.f); }

    float processOneSample (float in, float speech)
    {
        const float holdLimit = holdTimeMs_ * 0.001f * fs_;
        float want = 0.f;
        if (speech < 0.5f)
        {
            if (holdExtra_ < holdLimit) holdExtra_ += 1.f;
            else                       want = closeAttDb_;
        }
        else holdExtra_ = 0.f;

        att_ += (want - att_) * (want > att_ ? attCoeff_ : relCoeff_);
        const float g = std::pow (10.f, -att_ / 20.f);
        return bypassed_ ? in : in * g;
    }
};
```

Mapping notes:

- `ring.at(pos)` maps to `ring_[pos_]`; `pos_` is already kept in `[0, winLen)`.
- `sumSq = max(0, ...)` is mandatory. Without it, accumulated roundoff can make `sumSq` slightly negative, `sqrt` of a negative yields NaN, the `speech` flag becomes NaN, SoftGate's `speech < 0.5` comparison fails, `want` stays 0, and the output is **silenced**. That is exactly the bug recorded in `MEMORY.md`. The same guard exists in the AGC (§5.13).
- `hangCount` and `holdExtra` are `float` in Cmajor and are compared against integer-valued limits. Keep them `float` for bit parity; they increment by exactly 1.0.
- A bypassed VAD outputs `1.0` (permanently "speech") precisely so that a bypassed detector can never indirectly close the gate. This is a deliberate coupling rule, not a convenience.

### 4.11 Pseudocode scaffold — VAD

```text
PROCEDURE VAD
    STATE
        ring[0..2047] : array of float = 0
        winLen = 512 ; subLen = 16000 ; initLen = 4000     // derived once from fs
        pos = 0 ; filled = 0 ; subCount = 0 ; initSamp = 0
        sumSq = 0
        subMinA = subMinB = subMinC = 0.01 ; curSubMin = 1000
        noiseFloor = 0.01 ; floorCap = 0.01 ; floorMin = 1e-7
        hangCount = 0 ; isSpeech = 0
        enterLevelDb = 9 ; exitLevelDb = 4 ; hangTimeMs = 400
        absoluteExitLevel = 0.001
        bypassed = TRUE

    ON prepare(fs):
        winLen  := clamp(truncate(0.032*fs), 64, 2048)
        subLen  := truncate(fs)
        initLen := truncate(0.25*fs)

    ON event bypassVad(v):  bypassed := (v > 0.5)
    ON event enterDb(v):    enterLevelDb := clamp(v, 1, 20)
    ON event exitDb(v):     exitLevelDb  := clamp(v, 0, 15)
    ON event hangoverMs(v): hangTimeMs   := clamp(v, 0, 2000)

    FOR EACH sample x:
        sumSq := max(0, sumSq - ring[pos]*ring[pos] + x*x)      // NEVER drop the max
        ring[pos] := x
        pos := (pos + 1) mod winLen
        filled := min(filled + 1, winLen)

        rms := sqrt(sumSq / filled)
        IF rms < floorMin THEN rms := floorMin

        IF isSpeech < 0.5 AND rms < curSubMin THEN curSubMin := rms

        subCount := subCount + 1
        IF subCount >= subLen:                                  // 1-second boundary
            subCount := 0
            subMinC := subMinB ; subMinB := subMinA
            IF isSpeech < 0.5:
                subMinA := (curSubMin > 100 ? noiseFloor : curSubMin)
            ELSE:
                subMinA := noiseFloor                          // never learn from speech
            curSubMin := 1000
            noiseFloor := min(noiseFloor, subMinA, subMinB, subMinC)   // floor only falls

        IF initSamp < initLen:                                  // 250 ms seeding
            noiseFloor := min(noiseFloor, rms)
            subMinA := subMinB := subMinC := noiseFloor
            curSubMin := 1000
            initSamp := initSamp + 1

        noiseFloor := clamp(noiseFloor, floorMin, floorCap)

        snrDb := 20*log10(rms / noiseFloor)
        debugSnr   := snrDb
        debugFloor := (20*log10(noiseFloor) + 100)*0.01
        debugRms   := (20*log10(rms) + 100)*0.01

        enterT := enterLevelDb
        exitT  := min(exitLevelDb, enterT)
        hangLimit := hangTimeMs * 0.001 * fs

        IF isSpeech > 0.5:
            IF snrDb < exitT OR rms < absoluteExitLevel:
                hangCount := hangCount + 1
                IF hangCount >= hangLimit: isSpeech := 0 ; hangCount := 0
            ELSE:
                hangCount := 0
        ELSE:
            IF snrDb > enterT: isSpeech := 1 ; hangCount := 0

        speech := (bypassed ? 1.0 : isSpeech)
```

### 4.12 Pseudocode scaffold — SoftGate

```text
PROCEDURE SoftGate
    STATE att = 0 ; holdExtra = 0 ; closeAttDb = 30 ; holdTimeMs = 150 ; bypassed = TRUE

    ON prepare(fs):
        attCoeff := 1 - exp(-1/(0.030*fs))
        relCoeff := 1 - exp(-1/(0.150*fs))

    ON event bypassGate(v):  bypassed := (v > 0.5)
    ON event gateDepthDb(v): closeAttDb := clamp(v, 0, 60)
    ON event gateHoldMs(v):  holdTimeMs := clamp(v, 0, 1000)

    FOR EACH sample (x, sp):
        holdLimit := holdTimeMs * 0.001 * fs
        want := 0
        IF sp < 0.5:
            IF holdExtra < holdLimit THEN holdExtra := holdExtra + 1
            ELSE                          want := closeAttDb
        ELSE:
            holdExtra := 0

        att := att + (want - att) * (want > att ? attCoeff : relCoeff)
        out := bypassed ? x : x * 10^(-att/20)
```

### 4.13 Timing summary

| Mechanism | Default | Purpose |
|---|---|---|
| RMS window | 32 ms | level estimate |
| Floor sub-block | 1 s | noise-floor candidate update |
| Floor seeding | 250 ms | initial floor from the first 250 ms |
| Floor cap | -40 dBFS | ceiling on how quiet the floor may become |
| SNR enter / exit | 9 / 4 dB | hysteresis, with `exit` forced `<= enter` |
| VAD hangover | 400 ms | survives short intra-word gaps |
| Absolute close | -60 dBFS RMS | closes on true digital silence |
| Gate hold | 150 ms | additional hold after the VAD drops |
| Gate close ramp | 30 ms | click-free close |
| Gate release | 150 ms | click-free open |

### 4.14 Gaps vs objective

- **No Otsu.** The detector is RMS plus an adaptive floor plus SNR hysteresis. Do not describe the current code as Otsu.
- **The floor only descends.** If the noise floor rises (a new noise condition) the floor never follows. This is by design, to stop a quiet-speech onset from dragging the floor up, but the consequence is that in a genuinely noisier room the SNR estimate is optimistic and the gate will not close as readily.
- `floorCap = 0.01` (-40 dBFS) is effectively a tuning knob even though it is not exposed as an `input event`; `MIC_TEST.md` calls it out. **Acoustic parameter: do not change without measurement and authorization.**
- The `subLen`/min-of-3 structure means the floor needs roughly 3 s of sub-blocks to react fully.
- The host's solo configuration for this module is `{ bypassVad: 0, bypassGate: 1 }`: Solo tests the detector with transparent audio.

---

## Module 5 — Loudness Normalisation (K-Weighting + AGC)

**Files:** `chain1_filters.cmajor` (processor `KWeight`), `chain3_agc_gate_limit.cmajor` (processor `AGC`), `cmajor/patches/SeaMicLoudnessNormalization/SeaMicLoudnessNormalization.cmajor` (graph).

### 5.1 Objective

Produce a speech signal at a consistent, controlled level. A K-weighting filter (ITU-R BS.1770 pre-filter: high shelf plus high-pass) provides a psychoacoustic sidechain; a gain computer measures short-term RMS on that sidechain and drives a smoothed gain toward a target dBFS, with asymmetric attack and release and hard min/max gain clamps. The gain must be frozen while no speech is present, and the module must be a no-op when bypassed. **Target (not implemented): fully integrated EBU R128 loudness with gating blocks.**

### 5.2 Interfaces

KWeight:

| Direction | Name | Type | Range | Init |
|---|---|---|---|---|
| in | `in` | stream float | — | — |
| out | `out` | stream float | — | — |
| in | `bypassKWeight` | event float32 | boolean | 1 |

AGC:

| Direction | Name | Type | Range | Init |
|---|---|---|---|---|
| in | `in` | stream float | — | — |
| in | `side` | stream float | — | — | K-weighted signal |
| in | `speech` | stream float | — | — | from the VAD |
| out | `out` | stream float | — | — | |
| out | `gainDbOut` | stream float | — | — | telemetry |
| in | `targetDb` | **value** float | -30..-6 | -19.0, step 0.5 |
| in | `maxGainDb` | **value** float | 0..40 | 30.0, step 1 |
| in | `minGainDb` | **value** float | -24..0 | -12.0, step 1 |
| in | `bypassAGC` | event float32 | boolean | 1 |

Important: these three are `input value`, **not** `input event`. The Cmajor code never copies them into a member; it references `targetDb`, `maxGainDb` and `minGainDb` directly at the point of use, and there is **no clamping code at all**. In C++ you must decide where the clamp lives; the annotation range is enforced only by the host GUI (see the `parameters` min/max in `web/app.js`). Record that decision explicitly in the pseudocode.

### 5.3 Data structures — KWeight

| Cmajor | Type | Init | Meaning | C++ |
|---|---|---|---|---|
| `sh_x1, sh_x2, sh_y1, sh_y2` | `float` x4 | `0.0f` | shelf biquad delay line | `float shX1_, shX2_, shY1_, shY2_;` |
| `hp_x1, hp_x2, hp_y1, hp_y2` | `float` x4 | `0.0f` | high-pass biquad delay line | `float hpX1_, hpX2_, hpY1_, hpY2_;` |
| `sh_b0/b1/b2/a1/a2` | `float` x5 | `1,0,0,0,0` | shelf coefficients | `float shB0_ = 1.f, shB1_, shB2_, shA1_, shA2_;` |
| `hp_b0/b1/b2/a1/a2` | `float` x5 | `1,0,0,0,0` | high-pass coefficients | `float hpB0_ = 1.f, hpB1_, hpB2_, hpA1_, hpA2_;` |
| `coeffsDone` | `int` | `0` | one-shot coefficient flag | `bool coeffsDone_ = false;` |
| `isBypassed` | `bool` | `true` | | `bool bypassed_ = true;` |

**18 members, no arrays.** The delay lines are **not** reset on a bypass change, so the filter state stays warm and un-bypassing is click-free.

### 5.4 Data structures — AGC

| Cmajor | Type | Init | Meaning | C++ |
|---|---|---|---|---|
| `ring` | `float[512]` | zeroed | RMS sliding window on the sidechain | `std::array<float,512> ring_{};` |
| `pos` | `int` | `0` | ring cursor | `int pos_ = 0;` |
| `filled` | `int` | `0` | warm-up counter | `int filled_ = 0;` |
| `sumSq` | `float` | `0.0f` | running sum of s^2 | `float sumSq_ = 0.f;` |
| `gainDb` | `float` | `0.0f` | **servo target** gain in dB | `float gainDb_ = 0.f;` |
| `appliedGain` | `float` | `1.0f` | smoothed linear gain | `float appliedGain_ = 1.f;` |
| `speechSeen` | `float` | `0.0f` | latch: speech has occurred at least once | `bool speechSeen_ = false;` |
| `isBypassed` | `bool` | `true` | | `bool bypassed_ = true;` |

**7 members plus a 512-float array (2 KB).** `speechSeen` is written but never read in the current code; it is dead state left over from a removed pre-roll-pump fix. Flag it in the pseudocode and decide explicitly whether to keep, remove or repurpose it.

### 5.5 Start-up constants

KWeight, once, inside `computeCoeffs`:

```
fs   = processor.frequency
A    = 10^(3.985419/40)                       // ~1.25870
w0   = 2pi * 1681.974 / fs                     // shelf centre
alphaShelf = sin(w0)/2 * sqrt((A + 1/A)(1/0.7071 - 1) + 2)   // Q = 0.7071
cosw = cos(w0) ; sqA = sqrt(A)
b0s = A((A+1) + (A-1)cosw + 2*sqA*alphaShelf)
b1s = -2A((A-1) + (A+1)cosw)
b2s = A((A+1) + (A-1)cosw - 2*sqA*alphaShelf)
a0s = (A+1) - (A-1)cosw + 2*sqA*alphaShelf
a1s = 2((A-1) - (A+1)cosw)
a2s = (A+1) - (A-1)cosw - 2*sqA*alphaShelf
sh_b* = b*s/a0s ; sh_a1 = a1s/a0s ; sh_a2 = a2s/a0s

wh   = 2pi * 60 / fs
alh  = sin(wh) ; coh = cos(wh)
b0h = (1+coh)/2 ; b1h = -(1+coh) ; b2h = (1+coh)/2
a0h = 1+alh ; a1h = -2coh ; a2h = 1-alh
hp_b* = b*h/a0h ; hp_a1 = a1h/a0h ; hp_a2 = a2h/a0h
```

These are the standard BS.1770 K-weighting coefficients, computed at run time so they are rate-independent. `0.7071` is a hard-coded approximation of `1/sqrt(2)`.

AGC:

```
downCoeff  = 1 - exp(-1/(0.08*fs))     // servo pulls the target DOWN fast (tau = 80 ms)
upCoeff    = 1 - exp(-1/(1.5*fs))      // servo pushes the target UP slowly (tau = 1.5 s)
smoothDown = 1 - exp(-1/(0.010*fs))    // applied gain decreasing (tau = 10 ms)
smoothUp   = 1 - exp(-1/(0.050*fs))    // applied gain increasing (tau = 50 ms)
```

### 5.6 Per-sample algorithm — KWeight

```
ys = sh_b0*x + sh_b1*sh_x1 + sh_b2*sh_x2 - sh_a1*sh_y1 - sh_a2*sh_y2
sh_x2 <- sh_x1 ; sh_x1 <- x ; sh_y2 <- sh_y1 ; sh_y1 <- ys
yh = hp_b0*ys + hp_b1*hp_x1 + hp_b2*hp_x2 - hp_a1*hp_y1 - hp_a2*hp_y2
hp_x2 <- hp_x1 ; hp_x1 <- ys ; hp_y2 <- hp_y1 ; hp_y1 <- yh
out = isBypassed ? x : yh
```

Direct Form I, a shelf cascaded into a high-pass.

### 5.7 Per-sample algorithm — AGC

1. `x = in`, `s = side`, `sp = speech`
2. `sumSq = max(0, sumSq - ring[pos]^2 + s^2)` — the same NaN guard as the VAD
3. `ring[pos] = s`; `pos = (pos + 1) mod 512`; `filled = min(filled + 1, 512)`
4. `rms = sqrt(sumSq / filled)`; `if rms < 1e-7: rms = 1e-7`
5. **If not bypassed and `sp > 0.5`:**
   - `speechSeen = 1`
   - `errDb = targetDb - 20*log10(rms * appliedGain)`
   - `gainDb += (errDb - gainDb) * (errDb < gainDb ? downCoeff : upCoeff)`
   - `gainDb = clamp(gainDb, minGainDb, maxGainDb)`
6. `target = 10^(gainDb/20)`
7. **If not bypassed:** `appliedGain += (target - appliedGain) * (target < appliedGain ? smoothDown : smoothUp)`
8. `out = isBypassed ? x : x * appliedGain`
9. `gainDbOut = isBypassed ? 0 : gainDb`

Step 5's `rms * appliedGain` forms a **closed loop**: the error is measured against the already-amplified level, so the servo settles where `20*log10(rms*gain) == targetDb`, i.e. the *output* reaches the target rather than the input. This is the single most important detail of the AGC and must not be lost in the pseudocode.

Also note that when `sp <= 0.5`, `gainDb` freezes at its last value and `appliedGain` keeps converging toward it. With a typical `targetDb` of -19 dBFS, the output RMS converges to -19 dBFS during speech.

### 5.8 Current Cmajor code

```cmajor
processor KWeight
{
    input  stream float in;
    output stream float out;
    input event float32 bypassKWeight [[ name: "Bypassed (ON = dry signal)", init: 1, boolean ]];
    float sh_x1 = 0.0f;
    float sh_x2 = 0.0f;
    float sh_y1 = 0.0f;
    float sh_y2 = 0.0f;
    float hp_x1 = 0.0f;
    float hp_x2 = 0.0f;
    float hp_y1 = 0.0f;
    float hp_y2 = 0.0f;
    float sh_b0 = 1.0f;
    float sh_b1 = 0.0f;
    float sh_b2 = 0.0f;
    float sh_a1 = 0.0f;
    float sh_a2 = 0.0f;
    float hp_b0 = 1.0f;
    float hp_b1 = 0.0f;
    float hp_b2 = 0.0f;
    float hp_a1 = 0.0f;
    float hp_a2 = 0.0f;
    int coeffsDone = 0;
    bool isBypassed = true;

    event bypassKWeight (float32 value)
    {
        isBypassed = value > 0.5f;
    }

    void computeCoeffs()
    {
        float fs = float (processor.frequency);
        float A = pow (10.0f, 3.985419f / 40.0f);
        float w0 = float (float (twoPi) * 1681.974f / fs);
        float alphaShelf = float (sin (w0) * 0.5f * sqrt ((A + 1.0f / A) * (1.0f / 0.7071f - 1.0f) + 2.0f));
        float cosw = cos (w0);
        float sqA = sqrt (A);
        float b0s = A * ((A + 1.0f) + (A - 1.0f) * cosw + 2.0f * sqA * alphaShelf);
        float b1s = -2.0f * A * ((A - 1.0f) + (A + 1.0f) * cosw);
        float b2s = A * ((A + 1.0f) + (A - 1.0f) * cosw - 2.0f * sqA * alphaShelf);
        float a0s = (A + 1.0f) - (A - 1.0f) * cosw + 2.0f * sqA * alphaShelf;
        float a1s = 2.0f * ((A - 1.0f) - (A + 1.0f) * cosw);
        float a2s = (A + 1.0f) - (A - 1.0f) * cosw - 2.0f * sqA * alphaShelf;
        sh_b0 = b0s / a0s;
        sh_b1 = b1s / a0s;
        sh_b2 = b2s / a0s;
        sh_a1 = a1s / a0s;
        sh_a2 = a2s / a0s;
        float wh = float (float (twoPi) * 60.0f / fs);
        float alh = sin (wh);
        float coh = cos (wh);
        float b0h = (1.0f + coh) * 0.5f;
        float b1h = -(1.0f + coh);
        float b2h = (1.0f + coh) * 0.5f;
        float a0h = 1.0f + alh;
        float a1h = -2.0f * coh;
        float a2h = 1.0f - alh;
        hp_b0 = b0h / a0h;
        hp_b1 = b1h / a0h;
        hp_b2 = b2h / a0h;
        hp_a1 = a1h / a0h;
        hp_a2 = a2h / a0h;
        coeffsDone = 1;
    }
    void main()
    {
        if (coeffsDone == 0)
            computeCoeffs();
        loop
        {
            float x = in;
            float ys = sh_b0 * x + sh_b1 * sh_x1 + sh_b2 * sh_x2 - sh_a1 * sh_y1 - sh_a2 * sh_y2;
            sh_x2 = sh_x1;
            sh_x1 = x;
            sh_y2 = sh_y1;
            sh_y1 = ys;
            float yh = hp_b0 * ys + hp_b1 * hp_x1 + hp_b2 * hp_x2 - hp_a1 * hp_y1 - hp_a2 * hp_y2;
            hp_x2 = hp_x1;
            hp_x1 = ys;
            hp_y2 = hp_y1;
            hp_y1 = yh;
            out <- isBypassed ? x : yh;
            advance();
        }
    }
}
```

```cmajor
processor AGC
{
    input  stream float in;
    input  stream float side;
    input  stream float speech;
    output stream float out;
    output stream float gainDbOut;
    input value float targetDb [[ name: "Target dBFS", min: -30.0, max: -6.0, init: -19.0, step: 0.5 ]];
    input value float maxGainDb [[ name: "Max gain dB", min: 0.0, max: 40.0, init: 30.0, step: 1.0 ]];
    input value float minGainDb [[ name: "Min gain dB", min: -24.0, max: 0.0, init: -12.0, step: 1.0 ]];
    input event float32 bypassAGC [[ name: "Bypassed (ON = dry signal)", init: 1, boolean ]];
    float[512] ring;
    int   pos = 0;
    int   filled = 0;
    float sumSq = 0.0f;
    float gainDb = 0.0f;
    float appliedGain = 1.0f;
    float speechSeen = 0.0f; // latch: have we ever seen speech? avoids pre-roll pump
    bool isBypassed = true;

    event bypassAGC (float32 value)
    {
        isBypassed = value > 0.5f;
    }

    void main()
    {
        float fs = float (processor.frequency);
        float downCoeff = 1.0f - exp (-1.0f / (0.08f * fs));
        float upCoeff = 1.0f - exp (-1.0f / (1.5f * fs));
        float smoothDown = 1.0f - exp (-1.0f / (0.010f * fs));
        float smoothUp = 1.0f - exp (-1.0f / (0.050f * fs));
        loop
        {
            float x = in;
            float s = side;
            float sp = speech;
            float oldest = ring.at(pos);
            sumSq = max (0.0f, sumSq - oldest * oldest + s * s);
            ring.at(pos) = s;
            pos = pos + 1;
            if (pos >= 512) pos = 0;
            if (filled < 512) filled = filled + 1;
            float rms = sqrt (sumSq / float (filled));
            if (rms < 0.0000001f) rms = 0.0000001f;
            if (! isBypassed && sp > 0.5f)
            {
                speechSeen = 1.0f;
                float errDb = targetDb - 20.0f * log10 (rms * appliedGain);
                if (errDb < gainDb) gainDb = gainDb + (errDb - gainDb) * downCoeff;
                else               gainDb = gainDb + (errDb - gainDb) * upCoeff;
                if (gainDb > maxGainDb) gainDb = maxGainDb;
                if (gainDb < minGainDb) gainDb = minGainDb;
            }
            float target = pow (10.0f, gainDb / 20.0f);
            if (! isBypassed && target < appliedGain) appliedGain = appliedGain + (target - appliedGain) * smoothDown;
            else if (! isBypassed)               appliedGain = appliedGain + (target - appliedGain) * smoothUp;
            out <- isBypassed ? x : x * appliedGain;
            gainDbOut <- isBypassed ? 0.0f : gainDb;
            advance();
        }
    }
}
```

Graph:

```cmajor
graph SeaMicLoudnessNormalization [[ main ]]
{
    input  stream float in;
    input  stream float speech;
    output stream float out;

    input agc.targetDb;
    input agc.maxGainDb;
    input agc.minGainDb;
    input kw.bypassKWeight;
    input agc.bypassAGC;

    node kw  = KWeight;
    node agc = AGC;

    connection
    {
        in -> kw.in;
        in -> agc.in;
        speech -> agc.speech;
        kw.out -> agc.side;
        agc.out -> out;
    }
}
```

Note the **fan-out**: `in` feeds both the KWeight sidechain and the AGC audio path; only the sidechain is weighted.

### 5.9 C++ equivalence — KWeight

```cpp
struct KWeight
{
    float shX1_ = 0.f, shX2_ = 0.f, shY1_ = 0.f, shY2_ = 0.f;
    float hpX1_ = 0.f, hpX2_ = 0.f, hpY1_ = 0.f, hpY2_ = 0.f;
    float shB0_ = 1.f, shB1_ = 0.f, shB2_ = 0.f, shA1_ = 0.f, shA2_ = 0.f;
    float hpB0_ = 1.f, hpB1_ = 0.f, hpB2_ = 0.f, hpA1_ = 0.f, hpA2_ = 0.f;
    bool  coeffsDone_ = false, bypassed_ = true;

    void computeCoeffs (float fs)
    {
        const float A = std::pow (10.f, 3.985419f / 40.f);
        const float w0 = (float)(2.0 * M_PI) * 1681.974f / fs;
        const float alphaShelf = std::sin (w0) * 0.5f
                               * std::sqrt ((A + 1.f / A) * (1.f / 0.7071f - 1.f) + 2.f);
        const float cosw = std::cos (w0), sqA = std::sqrt (A);
        const float b0s = A * ((A + 1.f) + (A - 1.f) * cosw + 2.f * sqA * alphaShelf);
        const float b1s = -2.f * A * ((A - 1.f) + (A + 1.f) * cosw);
        const float b2s = A * ((A + 1.f) + (A - 1.f) * cosw - 2.f * sqA * alphaShelf);
        const float a0s = (A + 1.f) - (A - 1.f) * cosw + 2.f * sqA * alphaShelf;
        const float a1s = 2.f * ((A - 1.f) - (A + 1.f) * cosw);
        const float a2s = (A + 1.f) - (A - 1.f) * cosw - 2.f * sqA * alphaShelf;
        shB0_ = b0s / a0s; shB1_ = b1s / a0s; shB2_ = b2s / a0s;
        shA1_ = a1s / a0s; shA2_ = a2s / a0s;

        const float wh = (float)(2.0 * M_PI) * 60.f / fs;
        const float alh = std::sin (wh), coh = std::cos (wh);
        const float b0h = (1.f + coh) * 0.5f, b1h = -(1.f + coh), b2h = (1.f + coh) * 0.5f;
        const float a0h = 1.f + alh, a1h = -2.f * coh, a2h = 1.f - alh;
        hpB0_ = b0h / a0h; hpB1_ = b1h / a0h; hpB2_ = b2h / a0h;
        hpA1_ = a1h / a0h; hpA2_ = a2h / a0h;
        coeffsDone_ = true;
    }
    void prepare (double sr) { if (! coeffsDone_) computeCoeffs ((float) sr); }
    void setBypass (float v) { bypassed_ = v > 0.5f; }

    float processOneSample (float in)
    {
        const float x = in;
        const float ys = shB0_*x + shB1_*shX1_ + shB2_*shX2_ - shA1_*shY1_ - shA2_*shY2_;
        shX2_ = shX1_; shX1_ = x; shY2_ = shY1_; shY1_ = ys;
        const float yh = hpB0_*ys + hpB1_*hpX1_ + hpB2_*hpX2_ - hpA1_*hpY1_ - hpA2_*hpY2_;
        hpX2_ = hpX1_; hpX1_ = ys; hpY2_ = hpY1_; hpY1_ = yh;
        return bypassed_ ? x : yh;
    }
};
```

### 5.10 C++ equivalence — AGC

```cpp
struct AGC
{
    std::array<float, 512> ring_{};
    int   pos_ = 0, filled_ = 0;
    float sumSq_ = 0.f, gainDb_ = 0.f, appliedGain_ = 1.f;
    bool  speechSeen_ = false, bypassed_ = true;
    float targetDb_ = -19.f, maxGainDb_ = 30.f, minGainDb_ = -12.f;
    float fs_ = 16000.f;
    float downCoeff_ = 7.8095e-4f, upCoeff_ = 4.1666e-5f;
    float smoothDown_ = 6.2306e-3f, smoothUp_ = 1.2492e-3f;
    float gainDbOut_ = 0.f;

    void prepare (double sr)
    {
        fs_ = (float) sr;
        downCoeff_  = 1.f - std::exp (-1.f / (0.08f  * fs_));
        upCoeff_    = 1.f - std::exp (-1.f / (1.5f   * fs_));
        smoothDown_ = 1.f - std::exp (-1.f / (0.010f * fs_));
        smoothUp_   = 1.f - std::exp (-1.f / (0.050f * fs_));
    }
    // input value ports: clamp here OR at the point of use -- decide and document
    void setTargetDb (float v) { targetDb_ = v; }   // Cmajor does NOT clamp
    void setMaxGainDb(float v) { maxGainDb_ = v; }
    void setMinGainDb(float v) { minGainDb_ = v; }
    void setBypass (float v) { bypassed_ = v > 0.5f; }

    float processOneSample (float in, float side, float speech)
    {
        const float oldest = ring_[pos_];
        sumSq_ = std::fmax (0.f, sumSq_ - oldest * oldest + side * side);
        ring_[pos_] = side;
        if (++pos_ >= 512) pos_ = 0;
        if (filled_ < 512) ++filled_;

        float rms = std::sqrt (sumSq_ / (float) filled_);
        if (rms < 1e-7f) rms = 1e-7f;

        if (! bypassed_ && speech > 0.5f)
        {
            speechSeen_ = true;
            const float errDb = targetDb_ - 20.f * std::log10 (rms * appliedGain_);
            gainDb_ += (errDb - gainDb_) * (errDb < gainDb_ ? downCoeff_ : upCoeff_);
            gainDb_ = std::fmin (maxGainDb_, std::fmax (minGainDb_, gainDb_));
        }

        const float target = std::pow (10.f, gainDb_ / 20.f);
        if (! bypassed_)
            appliedGain_ += (target - appliedGain_) * (target < appliedGain_ ? smoothDown_ : smoothUp_);

        gainDbOut_ = bypassed_ ? 0.f : gainDb_;
        return bypassed_ ? in : in * appliedGain_;
    }
};
```

### 5.11 Pseudocode scaffold — KWeight

```text
PROCEDURE KWeight
    STATE sh_x1, sh_x2, sh_y1, sh_y2 = 0
          hp_x1, hp_x2, hp_y1, hp_y2 = 0
          sh_b0=1, sh_b1=0, sh_b2=0, sh_a1=0, sh_a2=0
          hp_b0=1, hp_b1=0, hp_b2=0, hp_a1=0, hp_a2=0
          coeffsDone = FALSE ; bypassed = TRUE

    ON prepare(fs):
        IF NOT coeffsDone:
            A := 10^(3.985419/40)
            w0 := 2pi*1681.974/fs
            alphaShelf := sin(w0)*0.5*sqrt((A + 1/A)(1/0.7071 - 1) + 2)
            (sh_b0, sh_b1, sh_b2, sh_a1, sh_a2) := normalise_shelf(A, w0, alphaShelf)
            wh := 2pi*60/fs ; alh := sin(wh) ; ch := cos(wh)
            (hp_b0, hp_b1, hp_b2, hp_a1, hp_a2) := normalise_highpass(alh, ch)
            coeffsDone := TRUE

    ON event bypassKWeight(v): bypassed := (v > 0.5)

    FOR EACH sample x:
        ys := sh_b0*x + sh_b1*sh_x1 + sh_b2*sh_x2 - sh_a1*sh_y1 - sh_a2*sh_y2
        sh_x2 := sh_x1 ; sh_x1 := x ; sh_y2 := sh_y1 ; sh_y1 := ys
        yh := hp_b0*ys + hp_b1*hp_x1 + hp_b2*hp_x2 - hp_a1*hp_y1 - hp_a2*hp_y2
        hp_x2 := hp_x1 ; hp_x1 := ys ; hp_y2 := hp_y1 ; hp_y1 := yh
        out := bypassed ? x : yh
```

### 5.12 Pseudocode scaffold — AGC

```text
PROCEDURE AGC
    INPUT  targetDb, maxGainDb, minGainDb        // value ports, no Cmajor clamp
    STATE ring[0..511] = 0 ; pos = 0 ; filled = 0 ; sumSq = 0
          gainDb = 0 ; appliedGain = 1 ; bypassed = TRUE

    ON prepare(fs):
        downCoeff  := 1 - exp(-1/(0.08*fs))
        upCoeff    := 1 - exp(-1/(1.5*fs))
        smoothDown := 1 - exp(-1/(0.010*fs))
        smoothUp   := 1 - exp(-1/(0.050*fs))

    ON event bypassAGC(v): bypassed := (v > 0.5)

    FOR EACH sample (x, s, sp):
        sumSq := max(0, sumSq - ring[pos]*ring[pos] + s*s)      // NEVER drop the max
        ring[pos] := s
        pos := (pos + 1) mod 512
        filled := min(filled + 1, 512)

        rms := sqrt(sumSq / filled)
        IF rms < 1e-7 THEN rms := 1e-7

        IF NOT bypassed AND sp > 0.5:
            errDb := targetDb - 20*log10(rms * appliedGain)    // closed loop on OUTPUT level
            gainDb := gainDb + (errDb - gainDb) * (errDb < gainDb ? downCoeff : upCoeff)
            gainDb := clamp(gainDb, minGainDb, maxGainDb)

        target := 10^(gainDb/20)
        IF NOT bypassed:
            appliedGain := appliedGain + (target - appliedGain)
                                     * (target < appliedGain ? smoothDown : smoothUp)

        out       := bypassed ? x : x * appliedGain
        gainDbOut := bypassed ? 0  : gainDb
```

### 5.13 Gaps vs objective

- **Not EBU R128.** There is no 400 ms momentary or 3 s short-term integration, no absolute (-70 LUFS) or relative (-43 LUFS) gating block, and no gated integrated loudness. This is a 32 ms-window RMS AGC with a closed-loop servo.
- The `input value` ports are unclamped in DSP; only the host GUI clamps. Decide the C++ policy explicitly.
- `speechSeen` is dead state.
- **The 32 ms RMS window is hard-coded as 512 samples**, so at 48 kHz it becomes 10.7 ms. Unlike the VAD, whose `winLen` is derived from `fs`, the AGC window is a fixed sample count and is therefore **not** rate-independent. This is a latent defect if the rate ever changes; flag it for the pseudocode and treat any change as an acoustic decision requiring measurement.
- The two smoothing stages (80 ms / 1.5 s servo, then 10 ms / 50 ms application) mean a step change in `targetDb` takes roughly 2 s to become audible. Intentional.
- `MIC_TEST.md` notes the AGC measures 512-sample RMS on the K-weighted sidechain and updates while speech is active.

---

## Module 6 — Tone / Warmth

**Files:** `cmajor/modules/dsp/Tone.cmajor`, `cmajor/patches/SeaMicToneWarmth/SeaMicToneWarmth.cmajor`.

### 6.1 Objective

Add warmth and perceived body to the voice with a bounded, continuous, asymmetric waveshaping transfer curve. Drive controls how hard the signal enters the curve, asymmetry adds an even-order (2nd harmonic) component, and a makeup gain compensates the level loss. The output must never exceed +/-1 before the makeup gain, must cross-fade smoothly when bypassed, and must be followed by a DC blocker because asymmetric shaping generates an offset. **Target (not implemented): symmetric waveshaper plus tone shelf.**

### 6.2 Interfaces

| Direction | Name | Type | Range | Init |
|---|---|---|---|---|
| in | `in` / `out` | stream float | — | — |
| in | `drive` | event float32 | 1..8 | 1.5, step 0.1 |
| in | `asymmetry` | event float32 | 0..0.5 | 0.2, step 0.01 |
| in | `makeupDb` | event float32 | -12..6 | -3.0, step 0.5 |
| in | `bypassTone` | event float32 | boolean | 1 |
| in | `bypassDc` | event float32 | boolean | 1 | (post-tone DC blocker) |

### 6.3 Data structures

| Cmajor | Type | Init | Meaning | C++ |
|---|---|---|---|---|
| `driveAmount` | `float` | `1.5f` | clamped drive | `float drive_ = 1.5f;` |
| `asymmetryAmount` | `float` | `0.2f` | clamped asymmetry | `float asym_ = 0.2f;` |
| `makeupGain` | `float` | `0.70794578f` | `10^(-3/20)` | `float makeup_ = 0.70794578f;` |
| `isBypassed` | `bool` | `true` | | `bool bypassed_ = true;` |
| `wetMix` | `float` | `0.0f` | smoothed wet/dry crossfade | `float wetMix_ = 0.f;` |

**5 members, no arrays.** Note `makeupGain`'s initialiser `0.70794578f` is exactly `10^(-3/20)`, matching `makeupDb`'s `init: -3.0`: the member default is kept consistent with the annotation by design.

### 6.4 Start-up constants

```
mixSmoothing = 1 - exp(-1/(0.005*fs))       // 5 ms crossfade, ~1.2422e-2 at 16 kHz
```

### 6.5 Per-sample algorithm

1. `sample = in`
2. `driven = sample * driveAmount`
3. `magnitude = abs(driven)`
4. `compressed = driven / (1 + magnitude)` — an odd-symmetric saturator with output in (-1, 1)
5. `shaped = (compressed + asymmetryAmount * compressed^2) / (1 + asymmetryAmount)`
6. `targetMix = isBypassed ? 0 : 1`
7. `wetMix += (targetMix - wetMix) * mixSmoothing`
8. `outputSample = sample + (shaped * makeupGain - sample) * wetMix`
9. `out = outputSample`

The curve is `u = drive*x/(1 + |drive*x|)` then `y = (u + a*u^2)/(1 + a)`. The `u^2` term is the even-order part, and dividing by `(1 + a)` keeps `abs(y) <= 1` for `0 <= a <= 0.5`. Step 8 is a linear crossfade rather than a bypass ternary, and that is what makes the module click-free.

### 6.6 Current Cmajor code

```cmajor
processor Tone
{
    input stream float in;
    output stream float out;

    input event float32 drive [[ name: "Drive", min: 1.0, max: 8.0, init: 1.5, step: 0.1 ]];
    input event float32 asymmetry [[ name: "Harmonic asymmetry", min: 0.0, max: 0.5, init: 0.2, step: 0.01 ]];
    input event float32 makeupDb [[ name: "Output gain (dB)", min: -12.0, max: 6.0, init: -3.0, step: 0.5 ]];
    input event float32 bypassTone [[ name: "Bypassed (ON = dry signal)", init: 1, boolean ]];

    float driveAmount = 1.5f;
    float asymmetryAmount = 0.2f;
    float makeupGain = 0.70794578f;
    bool isBypassed = true;
    float wetMix = 0.0f;

    event drive (float32 value)
    {
        driveAmount = min (max (value, 1.0f), 8.0f);
    }

    event asymmetry (float32 value)
    {
        asymmetryAmount = min (max (value, 0.0f), 0.5f);
    }

    event makeupDb (float32 value)
    {
        makeupGain = pow (10.0f, min (max (value, -12.0f), 6.0f) / 20.0f);
    }

    event bypassTone (float32 value)
    {
        isBypassed = value > 0.5f;
    }

    void main()
    {
        float mixSmoothing = 1.0f - exp (-1.0f / (0.005f * float (processor.frequency)));

        loop
        {
            float sample = in;
            float driven = sample * driveAmount;
            float magnitude = abs (driven);
            float compressed = driven / (1.0f + magnitude);
            float shaped = (compressed + asymmetryAmount * compressed * compressed)
                / (1.0f + asymmetryAmount);
            float targetMix = isBypassed ? 0.0f : 1.0f;
            wetMix = wetMix + (targetMix - wetMix) * mixSmoothing;
            float outputSample = sample + (shaped * makeupGain - sample) * wetMix;
            out <- outputSample;
            advance();
        }
    }
}
```

Graph (includes the post-tone DC blocker):

```cmajor
graph SeaMicToneWarmth [[ main ]]
{
    input  stream float in;
    output stream float out;
    input tone.drive;
    input tone.asymmetry;
    input tone.makeupDb;
    input tone.bypassTone;
    input toneDc.bypassDc;

    node tone   = Tone;
    node toneDc = DCOffsetRemoval;

    connection
    {
        in -> tone.in;
        tone.out -> toneDc.in;
        toneDc.out -> out;
    }
}
```

### 6.7 C++ equivalence

```cpp
struct Tone
{
    float drive_ = 1.5f, asym_ = 0.2f, makeup_ = 0.70794578f, wetMix_ = 0.f;
    bool  bypassed_ = true;
    float mixSmoothing_ = 1.2422e-2f;

    void prepare (double sr)
    {
        mixSmoothing_ = 1.f - std::exp (-1.f / (0.005f * (float) sr));
    }
    void setDrive     (float v) { drive_  = std::fmin (std::fmax (v, 1.f), 8.f); }
    void setAsymmetry (float v) { asym_   = std::fmin (std::fmax (v, 0.f), 0.5f); }
    void setMakeupDb  (float v) { makeup_ = std::pow (10.f, std::fmin (std::fmax (v, -12.f), 6.f) / 20.f); }
    void setBypass    (float v) { bypassed_ = v > 0.5f; }

    float processOneSample (float in)
    {
        const float sample = in;
        const float driven = sample * drive_;
        const float magnitude = std::fabs (driven);
        const float compressed = driven / (1.f + magnitude);
        const float shaped = (compressed + asym_ * compressed * compressed) / (1.f + asym_);

        const float targetMix = bypassed_ ? 0.f : 1.f;
        wetMix_ += (targetMix - wetMix_) * mixSmoothing_;
        return sample + (shaped * makeup_ - sample) * wetMix_;
    }
};
```

For the post-tone DC blocker, reuse the `DCOffsetRemoval` class from Module 1 unchanged.

Mapping notes:

- The `makeupDb` event **recomputes** `makeupGain` from the clamped dB value; it does not store the dB. In C++, store the linear gain exactly as here, or store dB and derive it later, but be aware that the latter changes float rounding.
- `out` is never a ternary: `wetMix_` starts at 0, so a freshly constructed processor is bit-transparent even before any event arrives.
- The graph's `toneDc` node is bypassed by default; `MEMORY.md` records that Tone Solo also activates the post-tone DC blocker.

### 6.8 Pseudocode scaffold

```text
PROCEDURE Tone
    STATE drive = 1.5 ; asymmetry = 0.2 ; makeupGain = 0.70794578
          bypassed = TRUE ; wetMix = 0

    ON prepare(fs): mixSmoothing := 1 - exp(-1/(0.005*fs))

    ON event drive(v):        drive      := clamp(v, 1, 8)
    ON event asymmetry(v):    asymmetry  := clamp(v, 0, 0.5)
    ON event makeupDb(v):     makeupGain := 10^(clamp(v, -12, 6)/20)
    ON event bypassTone(v):   bypassed   := (v > 0.5)

    FOR EACH sample x:
        driven     := x * drive
        magnitude  := abs(driven)
        compressed := driven / (1 + magnitude)
        shaped     := (compressed + asymmetry * compressed^2) / (1 + asymmetry)

        targetMix  := (bypassed ? 0 : 1)
        wetMix     := wetMix + (targetMix - wetMix) * mixSmoothing

        out := x + (shaped * makeupGain - x) * wetMix
```

Graph, in this order:

```text
PROCEDURE SeaMicToneWarmth
    out := DCOffsetRemoval( Tone( in ) )
```

### 6.9 Properties and gaps

- `shaped` lies in (-1, 1) for `0 <= a <= 0.5`: at `u = 1`, `y = (1 + a)/(1 + a) = 1`. Bounded, continuous and monotone.
- `a = 0` gives pure odd-symmetric saturation (3rd harmonic); `a = 0.5` gives the maximum 2nd harmonic. It is never negative, so the curve is asymmetric but never folded.
- **No shelf filter.** The warmth is entirely harmonic generation; there is no spectral tilt. This is the documented gap versus the target.
- **No oversampling.** The rational curve has `C0` continuity but a slope discontinuity at the origin, so aliasing above roughly 8 kHz is possible at a 16 kHz sample rate. Not addressed.
- `dry + (wet - dry)*mix` can exceed +/-1 when `makeupDb > 0`. There is no output ceiling in this module; the limiter downstream is relied upon.

---

## Module 7 — Look-Ahead Limiter

**Files:** `chain3_agc_gate_limit.cmajor` (processor `Limiter`), `cmajor/patches/SeaMicLookAheadLimiter/SeaMicLookAheadLimiter.cmajor` (graph).

### 7.1 Objective

Guarantee the output never exceeds a fixed ceiling by looking ahead in time, so the gain can be reduced *before* a transient arrives and the distortion a hard clipper would cause is avoided. Sample-peak detection with a smoothed attack, a peak hold equal to the look-ahead window, and a 50 ms release. Transparent when bypassed. **Target gap: no oversampled true-peak detection.**

### 7.2 Interfaces

| Direction | Name | Type | Range | Init |
|---|---|---|---|---|
| in | `in` / `out` | stream float | — | — |
| in | `bypassLimiter` | event float32 | boolean | 1 |

There are no exposed parameters. The ceiling (-1.05 dBFS), the look-ahead (5 ms) and the release (50 ms) are all fixed in code.

### 7.3 Data structures

| Cmajor | Type | Init | Meaning | C++ |
|---|---|---|---|---|
| `audioDelayLine` | `float[2048]` | zeroed | delay buffer | `std::array<float,2048> delay_{};` |
| `writePosition` | `int` | `0` | write cursor | `int writePos_ = 0;` |
| `delaySamples` | `int` | `80` | derived from `fs` | `int delaySamples_ = 80;` |
| `peakHoldSamples` | `int` | `0` | countdown before the peak may release | `int peakHold_ = 0;` |
| `peak` | `float` | `0.0f` | held or decaying peak | `float peak_ = 0.f;` |
| `gainEnvelope` | `float` | `1.0f` | smoothed gain | `float gainEnv_ = 1.f;` |
| `isBypassed` | `bool` | `true` | | `bool bypassed_ = true;` |

**6 members plus a 2048-float array (8 KB).**

### 7.4 Start-up constants

```
ceilLin      = 10^(-1.05/20)           // ~0.8861461, i.e. 0.05 dB below the -1 dBFS target
peakRelease  = exp(-1/(0.050*fs))      // multiplicative decay of the detector
gainAttack   = 1 - exp(-1/(0.0001*fs)) // 0.1 ms
gainRelease  = 1 - exp(-1/(0.050*fs))  // smoothing coefficient
delaySamples = int(0.005*fs) clamped to [1, 2047]     // 80 at 16 kHz
```

Note that `peakRelease` is a **multiplier** (`exp(-...)` used directly) while `gainRelease` is a **smoothing coefficient** (`1 - exp(-...)`). Different roles, same time constant. This is easy to conflate, so flag it in the pseudocode.

### 7.5 Per-sample algorithm

1. `x = in`; `absoluteSample = abs(x)`
2. **Detector:**
   - if `absoluteSample >= peak AND absoluteSample > 0` then `peak = absoluteSample`; `peakHoldSamples = delaySamples`
   - else if `peakHoldSamples > 0` then `peakHoldSamples -= 1`
   - else `peak *= peakRelease`
   - if `peak < 1e-7` then `peak = 1e-7`
3. `targetGain = (peak > ceilLin) ? ceilLin / peak : 1.0`
4. `gainEnvelope += (targetGain - gainEnvelope) * (targetGain < gainEnvelope ? gainAttack : gainRelease)`
5. `audioDelayLine[writePosition] = x`; `readPosition = writePosition - delaySamples`; `if readPosition < 0: readPosition += 2048`
6. `out = isBypassed ? x : audioDelayLine[readPosition] * gainEnvelope`
7. `writePosition = (writePosition + 1) mod 2048`; `advance()`

The critical architectural point, already commented in the source: **the undelayed detector controls the audio that will exit after the look-ahead delay.** Because `delaySamples` equals the peak-hold length, by the time a transient reaches the output the gain has already been reduced. Do not "simplify" by delaying the detector.

### 7.6 Current Cmajor code

```cmajor
processor Limiter
{
    input  stream float in;
    output stream float out;
    input event float32 bypassLimiter [[ name: "Bypassed (ON = dry signal)", init: 1, boolean ]];
    float[2048] audioDelayLine;
    int   writePosition = 0;
    int   delaySamples = 80;
    int   peakHoldSamples = 0;
    float peak = 0.0f;
    float gainEnvelope = 1.0f;
    bool isBypassed = true;

    event bypassLimiter (float32 value)
    {
        isBypassed = value > 0.5f;
    }

    void main()
    {
        float fs = float (processor.frequency);
        float ceilLin = pow (10.0f, -1.05f / 20.0f);
        float peakRelease = exp (-1.0f / (0.050f * fs));
        float gainAttack = 1.0f - exp (-1.0f / (0.0001f * fs));
        float gainRelease = 1.0f - exp (-1.0f / (0.050f * fs));
        delaySamples = int (0.005f * fs);
        if (delaySamples < 1) delaySamples = 1;
        if (delaySamples > 2047) delaySamples = 2047;

        loop
        {
            float x = in;
            float absoluteSample = abs (x);
            if (absoluteSample >= peak && absoluteSample > 0.0f)
            {
                peak = absoluteSample;
                peakHoldSamples = delaySamples;
            }
            else if (peakHoldSamples > 0)
            {
                peakHoldSamples = peakHoldSamples - 1;
            }
            else
                peak = peak * peakRelease;
            if (peak < 0.0000001f) peak = 0.0000001f;

            float targetGain = 1.0f;
            if (peak > ceilLin) targetGain = ceilLin / peak;

            float gainCoefficient = targetGain < gainEnvelope ? gainAttack : gainRelease;
            gainEnvelope = gainEnvelope + (targetGain - gainEnvelope) * gainCoefficient;

            audioDelayLine.at(writePosition) = x;
            int readPosition = writePosition - delaySamples;
            if (readPosition < 0) readPosition = readPosition + 2048;

            // The undelayed detector controls audio that will exit after the look-ahead delay.
            out <- isBypassed ? x : audioDelayLine.at(readPosition) * gainEnvelope;

            writePosition = writePosition + 1;
            if (writePosition >= 2048) writePosition = 0;
            advance();
        }
    }
}
```

Graph:

```cmajor
graph SeaMicLookAheadLimiter [[ main ]]
{
    input  stream float in;
    output stream float out;
    input limiter.bypassLimiter;
    node limiter = Limiter;
    connection { in -> limiter.in; limiter.out -> out; }
}
```

### 7.7 C++ equivalence

```cpp
struct Limiter
{
    static constexpr int kLine = 2048;
    std::array<float, kLine> delay_{};
    int   writePos_ = 0, delaySamples_ = 80, peakHold_ = 0;
    float peak_ = 0.f, gainEnv_ = 1.f;
    bool  bypassed_ = true;
    float fs_ = 16000.f;
    float ceilLin_ = 0.8861461f, peakRelease_ = 0.9987508f;
    float gainAttack_ = 4.6474e-1f, gainRelease_ = 1.2492e-3f;

    void prepare (double sr)
    {
        fs_ = (float) sr;
        ceilLin_     = std::pow (10.f, -1.05f / 20.f);
        peakRelease_ = std::exp (-1.f / (0.050f * fs_));
        gainAttack_  = 1.f - std::exp (-1.f / (0.0001f * fs_));
        gainRelease_ = 1.f - std::exp (-1.f / (0.050f * fs_));
        delaySamples_ = std::min (std::max ((int)(0.005f * fs_), 1), kLine - 1);
    }
    void setBypass (float v) { bypassed_ = v > 0.5f; }

    float processOneSample (float in)
    {
        const float x = in;
        const float a = std::fabs (x);
        if (a >= peak_ && a > 0.f) { peak_ = a; peakHold_ = delaySamples_; }
        else if (peakHold_ > 0)     --peakHold_;
        else                        peak_ *= peakRelease_;
        if (peak_ < 1e-7f) peak_ = 1e-7f;

        float targetGain = (peak_ > ceilLin_) ? ceilLin_ / peak_ : 1.f;
        gainEnv_ += (targetGain - gainEnv_) * (targetGain < gainEnv_ ? gainAttack_ : gainRelease_);

        delay_[writePos_] = x;
        int readPos = writePos_ - delaySamples_;
        if (readPos < 0) readPos += kLine;

        const float out = bypassed_ ? x : delay_[readPos] * gainEnv_;
        if (++writePos_ >= kLine) writePos_ = 0;
        return out;
    }
};
```

Mapping notes:

- The read index uses a **single** `+= 2048` correction, which is valid because `writePosition` is in `[0,2048)` and `delaySamples` is in `[1,2047]`, so `readPosition` is in `(-2047, 2048)`.
- `out` is a true ternary: when bypassed, **no delay is applied**. `pipeline-notes.md` states explicitly that the initial host monitor is dry and does not include the limiter delay, so when the limiter is active the output is 80 samples (5 ms) later.
- `peakRelease_` is a multiplier and `gainRelease_` is a coefficient; see §7.4.

### 7.8 Pseudocode scaffold

```text
PROCEDURE Limiter
    CONSTANT lineLength = 2048
    STATE delayLine[0..2047] = 0
          writePosition = 0 ; delaySamples = 80 ; peakHoldSamples = 0
          peak = 0 ; gainEnvelope = 1 ; bypassed = TRUE

    ON prepare(fs):
        ceilLin     := 10^(-1.05/20)
        peakRelease := exp(-1/(0.050*fs))
        gainAttack  := 1 - exp(-1/(0.0001*fs))
        gainRelease := 1 - exp(-1/(0.050*fs))
        delaySamples := clamp(truncate(0.005*fs), 1, 2047)

    ON event bypassLimiter(v): bypassed := (v > 0.5)

    FOR EACH sample x:
        a := abs(x)
        IF a >= peak AND a > 0:
            peak := a ; peakHoldSamples := delaySamples
        ELSE IF peakHoldSamples > 0:
            peakHoldSamples := peakHoldSamples - 1
        ELSE:
            peak := peak * peakRelease
        IF peak < 1e-7 THEN peak := 1e-7

        IF peak > ceilLin THEN targetGain := ceilLin / peak
        ELSE                  targetGain := 1

        gainEnvelope := gainEnvelope + (targetGain - gainEnvelope)
                                    * (targetGain < gainEnvelope ? gainAttack : gainRelease)

        delayLine[writePosition] := x
        readPosition := writePosition - delaySamples
        IF readPosition < 0 THEN readPosition := readPosition + 2048

        out := bypassed ? x : delayLine[readPosition] * gainEnvelope

        writePosition := writePosition + 1
        IF writePosition >= 2048 THEN writePosition := 0
```

### 7.9 Gaps vs objective

- **No oversampling, so inter-sample true peak is not guaranteed.** Two adjacent samples below `ceilLin` can reconstruct above -1 dBFS after DAC reconstruction. This is the main documented limitation.
- The ceiling is -1.05 dBFS, deliberately 0.05 dB below the -1 dBFS target.
- There is no output telemetry (no gain-reduction meter output); the host shows input and output peak only.
- The fixed 2048-sample line limits the maximum look-ahead to 2047 samples, about 128 ms at 16 kHz and about 43 ms at 48 kHz.
- `peak` decays multiplicatively and is re-armed only by an absolute sample greater than or equal to the current `peak`, so a slowly rising waveform is tracked as a sequence of new peaks. That is correct for a sample-peak limiter.

---

## Appendix A — Endpoint cross-reference (Cmajor to host control)

| Module | Endpoint | Kind | GUI control in `web/app.js` | Fixed / adjustable |
|---|---|---|---|---|
| dc | `bypassDc` | event | toggle | — |
| aec | `bypassAec`, `bypassDcFilters` | event | toggle (`bypassDcFilters` forced to 1) | — |
| aec | `filterLength` | event | slider 32..1024, default 512 | adjustable |
| aec | `stepSize` | event | slider 0.01..2, default 0.5 | adjustable |
| aec | `doubleTalkEnabled` | event | toggle, default on | adjustable |
| dereverb | `amount` | event | slider 0..1, default 0.5 | adjustable |
| dereverb | `bypassDeReverb` | event | toggle | — |
| vad | `bypassVad`, `bypassGate` | event | toggles; solo = `{0, 1}` | — |
| vad | `enterDb`, `exitDb`, `hangoverMs` | event | sliders | adjustable |
| vad | `gateDepthDb`, `gateHoldMs` | event | sliders | adjustable |
| loudness | `bypassKWeight`, `bypassAGC` | event | toggles | — |
| loudness | `targetDb`, `maxGainDb`, `minGainDb` | **value** | sliders | adjustable, **unclamped in DSP** |
| tone | `bypassTone`, `bypassDc` | event | toggles | — |
| tone | `drive`, `asymmetry`, `makeupDb` | event | sliders | adjustable |
| limiter | `bypassLimiter` | event | toggle | — |
| limiter | *(ceiling, look-ahead, release)* | — | **none** | fixed in code |

## Appendix B — Default-value reconciliation

| Module | Parameter | Annotation `init` | Member default | Match |
|---|---|---|---|---|
| dc | `bypassDc` | 1 | `isBypassed = true` | yes |
| aec | `filterLength` | 512 | `activeTaps = 512`, `powerSmoothing = 1/512` | yes |
| aec | `stepSize` | 0.5 | `adaptationRate = 0.5` | yes |
| aec | `doubleTalkEnabled` | 1 | `doubleTalkDetection = true` | yes |
| aec | `bypassAec` | 1 | `bypass = true` | yes |
| dereverb | `amount` | 0.5 | `intensity = 0.5f` | yes |
| dereverb | `bypassDeReverb` | 1 | `isBypassed = true` | yes |
| vad | `bypassVad` | 1 | `isBypassed = true` | yes |
| vad | `enterDb` | 9.0 | `enterLevelDb = 9.0f` | yes |
| vad | `exitDb` | 4.0 | `exitLevelDb = 4.0f` | yes |
| vad | `hangoverMs` | 400.0 | `hangTimeMs = 400.0f` | yes |
| vad | `bypassGate` | 1 | `isBypassed = true` | yes |
| vad | `gateDepthDb` | 30.0 | `closeAttDb = 30.0f` | yes |
| vad | `gateHoldMs` | 150.0 | `holdTimeMs = 150.0f` | yes |
| loudness | `bypassKWeight` | 1 | `isBypassed = true` | yes |
| loudness | `bypassAGC` | 1 | `isBypassed = true` | yes |
| loudness | `targetDb` | -19.0 | *(read directly from the port)* | n/a, no member |
| loudness | `maxGainDb` | 30.0 | *(read directly from the port)* | n/a, no member |
| loudness | `minGainDb` | -12.0 | *(read directly from the port)* | n/a, no member |
| tone | `drive` | 1.5 | `driveAmount = 1.5f` | yes |
| tone | `asymmetry` | 0.2 | `asymmetryAmount = 0.2f` | yes |
| tone | `makeupDb` | -3.0 | `makeupGain = 0.70794578f` = `10^(-3/20)` | yes (derived) |
| tone | `bypassTone` | 1 | `isBypassed = true` | yes |
| limiter | `bypassLimiter` | 1 | `isBypassed = true` | yes |

All annotations and member defaults agree. The design goal recorded in `MEMORY.md` is that headless renders with no events delivered behave identically to the GUI defaults, and this table is the audit that proves it.

## Appendix C — Recommended pseudocode order and open questions

**Suggested order.** Each module's pseudocode is independent once the shared conventions in Part 0 are fixed:

1. **DC Offset Removal** — smallest; establishes the smoothing and bypass conventions.
2. **Look-Ahead Limiter** — establishes the ring-buffer and detector conventions.
3. **Tone / Warmth** — establishes the crossfade (non-ternary bypass) convention.
4. **De-Reverb** — establishes the dual-envelope ratio convention.
5. **K-Weighting** — establishes the biquad and coefficient-derivation convention.
6. **VAD** — establishes the adaptive-floor and hysteresis convention (most state).
7. **SoftGate** — depends on the VAD's `speech` contract.
8. **AGC** — depends on the VAD's `speech` and on KWeight's `side`.
9. **AEC** — largest, most numerically delicate, and the one with a known regression.

**Open questions requiring a decision before the pseudocode is finalised:**

- AGC: where do `targetDb`, `maxGainDb` and `minGainDb` get clamped in C++? Currently nowhere in DSP.
- AGC: keep, remove or repurpose `speechSeen`?
- AGC: keep the RMS window at a fixed 512 samples (rate-dependent) or derive it from `fs` like the VAD's `winLen`? This changes behaviour at 48 kHz and is an acoustic decision.
- AEC: does `referencePower` need to be reset when `filterLength` changes?
- AEC: is a delay estimator required before RES can be re-attempted? Requires acoustic measurement.
- DC blocker: `exp(-2pi*20/fs)` or the `R = 1 - 2pi*20/fs` variant in `chain1_filters.cmajor`? Which is canonical?
- DC, Tone and DeReverb: should bypass transitions be crossfaded everywhere, given that only Tone and DeReverb currently ramp?
- Limiter: add oversampled true-peak detection, or accept the documented limitation?

**Constraints from `AGENTS.md` and `MEMORY.md` that apply to all of the above:**

> Do not change established VAD/AGC acoustic parameters without measurements and authorization.
> Do not re-apply the AEC DSP rewrite without fixing convergence first.
> Ask before adding external dependencies, changing acoustic DSP parameters, or generating C++.

---

## Appendix D — Verification notes when implementing the pseudocode

- `cmaj test` and `cmaj render` **never deliver `input event`s**, so any module that starts bypassed stays bypassed in a headless render. To exercise a module offline, add a small processor that emits the required `output event` endpoints and connect them, repeating the event every sample rather than firing it once, because a one-shot event on frame 1 is not reliably delivered before processing.
- The Cmajor test harness judges the **last value written** to the output stream. Any future `.cmajtest` must emit its verdict last and hold it; an evaluator that writes a verdict and then a different value will always appear to pass.
- Never hand-edit `web/generated/`. Regenerate affected patches with the official Cmajor CLI after any patch change.
- Do not open a real microphone without explicit permission; use reproducible test signals and real microphone recordings for DeReverb, VAD and Tone before production use.
