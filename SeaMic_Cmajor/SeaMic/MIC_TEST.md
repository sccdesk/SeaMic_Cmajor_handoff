# SeaMic live microphone test protocol (5 min, headphones ON)

1. `cd C:\Users\engcouce\Documents\Cmajor`
2. `powershell -ExecutionPolicy Bypass -File .\SeaMic\run_live.ps1`
   (fallback: `.\SeaMic\run_live.ps1 -NoRate` — chain adapts to device rate)
   Verified on this machine: WASAPI, ZOOM F Series mic + headphones, 16 kHz,
   block 256, mono in/out, `Loaded: SeaMicDSPChain`, runs until stopped.
3. GUI window exposes AGC sliders (Target / MaxGain / MinGain).
   The web console's Noise Gate / VAD module exposes real-time sliders:
   Gate depth (0-60 dB, 30 default), Gate hold (0-1000 ms, 150 default),
   VAD hangover (0-2000 ms, 400 default), SNR enter (1-20 dB, 9 default),
   SNR exit (0-15 dB, 4 default).
4. Tests + expected behaviour:
   - Silence 5 s -> output attenuated by the gate (30 dB default; not digital silence).
   - Quiet speech -> gate opens within ~50 ms; level rides UP slowly (~1.5 s)
     toward -19 dBFS. First syllable NOT chopped (400 ms + 150 ms hold).
   - Pause mid-sentence < 400 ms -> stays open, no chopping.
   - Loud clap -> gain rides DOWN fast (~80 ms), no clipping (limiter -1 dBFS).
   - Continuous fan/hum below the close threshold -> gate starts closing after
     ~400 ms, then fades to the gate depth over 30 ms.
   - Long monologue > 10 s -> stays open (floor window frozen during speech).
5. Knobs if behaviour drifts on real hardware (all five live in the module GUI now):
   - quiet speech never opens -> lower the SNR enter slider (9 -> 7)
   - background noise pumps -> lower `floorCap` (0.01 = -40 dBFS) in chain2 or raise
     the SNR exit slider; only adjust hold times after listening tests
   - tail chopping -> lengthen the VAD hangover / gate hold sliders
   - pauses still noisy -> raise Gate depth (30 -> 40-60 dB) and/or lower the holds
