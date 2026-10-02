# SeaMic Web DSP Console

Internal console for monitoring the microphone dry and testing the Cmajor DSP chain. The target architecture is **ADC → DC Offset Removal → AEC → De-Reverb → Noise Gate / VAD → Loudness Normalisation → Tone / Warmth → Look-Ahead Limiter → Output → Opus → Network**.

See [the chronological engineering report](../docs/SeaMic_Project_Chronological_Report.pdf) for the project history, implementation decisions, debugging findings and validation record.

The browser now loads seven independent Cmajor module patches in series:

1. `SeaMicDCOffset`
2. `SeaMicAEC`
3. `SeaMicDeReverb`
4. `SeaMicNoiseGateVAD`
5. `SeaMicLoudnessNormalization`
6. `SeaMicToneWarmth`
7. `SeaMicLookAheadLimiter`

Each stage has its own generated WebAudio runtime, live parameter controls where the patch exposes them, a bypass switch, and a Solo control. The old `SeaMicDSPChain.cmajorpatch` remains a composite Cmajor graph for direct CLI testing; it is not a module and is not loaded by the browser.

## Record and play test audio

Before starting the engine, choose an input under **Choose microphone**. The engine will not start until an input is selected. **System default microphone** deliberately uses the OS/browser default; selecting a named device requests that exact device and does not silently fall back if it is unavailable. **Refresh devices** updates the list. Browsers may hide device names until permission is granted; **Allow access & show device names** requests microphone permission, briefly opens and releases an input stream, and then refreshes the names. The selected device is remembered in this browser. Stop the engine before changing inputs.

After starting the engine and granting microphone access, use **Record microphone** and **Finish recording** to capture up to five minutes of mono PCM audio. The console prepares a downloadable 16-bit PCM WAV at the active AudioContext sample rate. Load a separate `.wav`/`.wave` file as test audio. **Playback route → DSP microphone input** feeds the selected recording or WAV to the DSP chain while muting the live mic. **Playback route → Speakers + AEC reference** instead plays it through the speakers and the AEC reference bus, leaves the live microphone connected to capture the acoustic echo, and activates AEC for the duration of playback. Choose **Play once** or **Loop**; **Stop clip** ends playback and bypasses AEC again. For real echo cancellation, the playback must actually reach the microphone acoustically; directly feeding a matching file to both AEC inputs only tests exact digital cancellation, not a room or device path. Clip editing and trimming are not available.

AEC requires two correlated signals: the playback reference and its echo in the microphone input. Starting the engine alone cannot activate a useful canceller because no far-end playback exists yet; AEC is intentionally bypassed until a reference is available. The test-audio reference route provides playback inside this console. The host application can also connect its playback source with `SeaMicAudio.connectPlaybackSource(node)`; this routes playback to the AEC reference bus and makes the module available. Use a safe speaker level and avoid feedback.

WebAudio decodes and resamples WAV files to the active context rate; multichannel files are downmixed at the mono DSP mic input. Test audio can be played with the chain bypassed for a dry reference, with individual modules active, in Solo, or with the full chain enabled. The AEC diagnostic panel shows peak dBFS at mic input, far-end reference and AEC output plus their level difference. This is not a correlation-based ERLE metric: a reference level alone does not prove that the reference matches the echo.

The microphone recording path uses WebAudio `ScriptProcessorNode` capture for raw PCM access; no audio is uploaded or sent to a server. Stop the engine to release the microphone; a recording in progress is finalized before shutdown. The loaded WAV and completed recording remain available for replay after restarting the engine.

## Live DSP parameters

The per-module **Real-time parameters** panels send slider and toggle changes directly to the running Cmajor patch, including while that module is bypassed. Activate or Solo the module to hear its processing.

## DSP presets

Choose and apply **Laptop microphone**, **Headset / headphones**, or **Studio-quality microphone** to load a suggested set of values for the exposed AEC, De-Reverb, Loudness, and Tone controls. Presets change parameter values only; they do not enable modules. The profiles are starting points, not automatic device detection or calibrated settings.

Use **Save current settings as preset** to store the current parameter values under a custom name in this browser. Saved custom presets and the last applied profile persist in `localStorage` for the current site origin. Select a custom preset and choose **Delete saved preset** to remove it. DC Offset, Noise Gate / VAD, and Limiter do not expose live parameters, so presets cannot change their fixed processor settings. Applying a saved profile while the engine is stopped updates the controls and will use those values when the engine next starts.

| Module | Live parameters |
| --- | --- |
| DC Offset Removal | None currently exposed; the 20 Hz cutoff is fixed. |
| AEC | Filter length (32–1024 taps), adaptation step size (0.01–2), double-talk detector (on/off). AEC processing still requires a live playback reference. |
| De-Reverb | Amount (0–1); envelope timing and maximum attenuation are fixed. |
| Noise Gate / VAD | None currently exposed; RMS window, SNR thresholds, VAD hangover, gate hold, depth, and ramps are fixed. |
| Loudness Normalisation | Target level (−30 to −6 dBFS), maximum gain (0–40 dB), minimum gain (−24 to 0 dB). |
| Tone / Warmth | Drive (1–8), harmonic asymmetry (0–0.5), output gain (−12 to +6 dB). |
| Look-Ahead Limiter | None currently exposed; ceiling, look-ahead, and release are fixed. |

Parameters described as fixed are not presented as interactive controls because the current processors do not accept runtime updates for them. Presets use only the adjustable values shown above.

## Bypass and module controls

- **BYPASSED** means the module passes its input through unchanged.
- **ACTIVE** means the module is processing audio.
- The switch says what it will do: **Activate** enables processing; **Bypass** returns the module to dry pass-through.
- **BYPASSED · MASTER** means the host is monitoring the dry route. Re-enabling the chain restores the individual module states.
- All modules start bypassed. The microphone is initially monitored directly at reduced gain.
- AEC remains bypassed and cannot be activated or soloed until a playback source is connected to its reference bus. Use the test-audio playback route or connect the host application's source.
- **Solo** activates one stage and bypasses the rest. VAD Solo tests the detector with transparent audio; Tone Solo also enables its following DC blocker.
- Use headphones while monitoring. **Stop** releases the microphone and stops the DSP graph. It closes a console-owned context; when started with the app's shared context, playback keeps running and only the DSP/reference connections are removed.

## Generate the Cmajor WebAudio modules

Run these commands from the project root (`SeaMic/`) after changing a patch:

```powershell
$cmaj = "$env:LOCALAPPDATA\Programs\Cmajor\bin\cmaj.exe"
$patches = @(
  @{ Name = 'SeaMicDCOffset'; Path = 'cmajor/patches/SeaMicDCOffset/SeaMicDCOffset.cmajorpatch' },
  @{ Name = 'SeaMicAEC'; Path = 'cmajor/patches/SeaMicAEC/SeaMicAEC.cmajorpatch' },
  @{ Name = 'SeaMicDeReverb'; Path = 'cmajor/patches/SeaMicDeReverb/SeaMicDeReverb.cmajorpatch' },
  @{ Name = 'SeaMicNoiseGateVAD'; Path = 'cmajor/patches/SeaMicNoiseGateVAD/SeaMicNoiseGateVAD.cmajorpatch' },
  @{ Name = 'SeaMicLoudnessNormalization'; Path = 'cmajor/patches/SeaMicLoudnessNormalization/SeaMicLoudnessNormalization.cmajorpatch' },
  @{ Name = 'SeaMicToneWarmth'; Path = 'cmajor/patches/SeaMicToneWarmth/SeaMicToneWarmth.cmajorpatch' },
  @{ Name = 'SeaMicLookAheadLimiter'; Path = 'cmajor/patches/SeaMicLookAheadLimiter/SeaMicLookAheadLimiter.cmajorpatch' }
)
foreach ($patch in $patches) {
  & $cmaj generate --target=webaudio-html "--output=web/generated/$($patch.Name)" $patch.Path
  if ($LASTEXITCODE -ne 0) { throw "Failed to generate $($patch.Name)." }
}
```

Cmajor generates a JavaScript wrapper, its `cmaj_api/` helpers, and the patch WebAssembly. Do not edit generated files manually; regenerate them with the Cmajor CLI. See [cmajor-runtime/README.md](cmajor-runtime/README.md) for runtime notes.

## Serve and test

Generated JavaScript modules, AudioWorklet, and WebAssembly require a local HTTP origin; opening `index.html` directly as `file://` is not supported. See [../scripts/serve.md](../scripts/serve.md). In this Windows workspace, start the included static server from the project root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\serve.ps1
```

Open `http://127.0.0.1:8001/` in Firefox or another supported browser. Choose an input, then press **Start engine · dry monitor** and grant microphone access. All seven patches load and connect in order, with every processor bypassed and the microphone monitored directly at reduced gain. Use each module's GUI and **Activate / Bypass** switch to test it, or activate the whole chain. The switch text states the current state; its button states the action. AEC remains bypassed until playback is routed to its reference input; use the test-audio route or connect the application's playback node as described below.

The host requests a 16 kHz `AudioContext` and reports the negotiated rate. WebAudio uses a 128-sample render quantum; the page cannot choose its block size. Input and output meters display signal peaks in dBFS and scrolling peak-envelope waveforms over the latest five seconds (50 ms display buckets).

## Connect the live playback bus to AEC

AEC needs the same far-end audio that the application sends to the speakers, tapped before output. In the integrated app, start SeaMic with the application's existing `AudioContext` from a user gesture:

```js
await window.SeaMicAudio.start(seaTimeAudioContext);
const playbackNode = seaTimeAudioContext.createMediaElementSource(remoteAudioElement);
const disconnectPlayback = window.SeaMicAudio.connectPlaybackSource(playbackNode);
```

`playbackNode` must belong to the same `AudioContext` passed to `start()`. The bus routes its signal to both the speakers and the AEC reference input. Do not also connect that node directly to `seaTimeAudioContext.destination`, or playback will be heard twice. When the host reuses the application's context, **Stop** leaves that context and the playback-to-speaker route running; it only disconnects the reference from the stopped DSP graph. The returned function disconnects that source from the bus:

```js
disconnectPlayback();
```

Once connected, the AEC controls become available. Activate AEC individually or enable the whole chain; disconnecting the last playback source immediately bypasses AEC again. The test-audio **Speakers + AEC reference** route activates AEC during its playback. The bus is real-time and accepts the application's WebAudio node; the console does not capture system-wide audio. Reuse the application's `AudioContext` so playback and reference remain synchronous.

## DSP module source

Each browser module has a patch wrapper under `cmajor/patches/` and uses processors from `cmajor/modules/dsp/` or the existing `chain*.cmajor` sources. The composite `SeaMicDSPChain.cmajorpatch` is retained for CLI testing only. The original legacy AEC implementation remains unchanged.

Current DSP limitations are documented in the architecture diagram: De-Reverb is a conservative envelope shaper, not a full acoustic de-reverberator; VAD uses RMS/SNR hysteresis rather than Otsu; Tone uses an asymmetric rational waveshaper without a shelf; integrated EBU R128 gating and Opus/network transport are not implemented. Test AEC with the application's live playback bus and acoustic path; this console does not capture system-wide audio.
