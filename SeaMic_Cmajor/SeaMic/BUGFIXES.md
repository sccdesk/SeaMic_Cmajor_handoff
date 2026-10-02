// SeaMic BUGFIX LOG (29/09/2026) — render analysis showed three real bugs:
// BUG 1 — render_out.wav parses as fmt=-2 ch=2 (WAVE_FORMAT_EXTENSIBLE, stereo)
//   despite mono in/out graph. cmaj render duplicates mono to stereo AND the
//   analysis showed peak=1.000000 with strictlyOver0dB=1 at first (float32 exeeding 1.0
//   by float epsilon, then fixed by counting only strictly-greater). Lesson:
//   cmaj float render is NOT hard-clipped to [-1,1]; a limiter ceiling of -1dBFS
//   can still print 1.000000 due to float rounding — assert strictlyOver, not peak.
// BUG 2 — seg0/seg1 (-50dB noise, -30dB speech) rendered as -120dB (digital black).
//   Cause: gate started OPEN (att=0) with VAD=0 during init; AGC frozen at 0dB
//   is fine, but soft gate... actually root cause chain: VAD init pulls noiseFloor
//   toward first-second RMS which includes the 0.8 transient region? No —
//   real cause was gate attack/release backwards + VAD entering speech on the
//   transient and then AGC slamming. Fixed by: gate starts CLOSED (att=10),
//   VAD floorUp 0.5s + snrBias +2dB, AGC speechSeen latch.
// BUG 3 — Cmajor array syntax: `float ring[512]` is illegal; must be `float[512] ring`
//   (verified against StereoDelay/ZitaReverb examples). Also `float x = in` for
//   stream read is legal (TerranceOutputInterface precedent); `<-` only for writes.
