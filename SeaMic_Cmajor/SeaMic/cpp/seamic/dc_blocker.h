// SeaMic product DSP — DC offset blocker (Tier 3).
// First-order high-pass: y[n] = x[n] - x[n-1] + alpha * y[n-1].
// Differentially tested against python/seamic_ref/dc_offset.py (cpp/tests/test_dc_blocker.cc).
// STATUS: source written, NOT YET COMPILED (no C++ toolchain on this machine).
//
// Product rules (from AC5/AC6 guards):
//  - One instance per channel. Never share state across channels.
//  - Audio word is float; state is double (float32 state widens the fade tail).
//  - Zero heap allocation in the audio path. No exceptions in the audio path.
//  - Bypass keeps the state warm (matches CMajor DCOffsetRemoval steps 2-3
//    running unconditionally) and outputs the dry sample.
//  - NEVER clamp the output/state to [-1, 1]: a full-scale downward step
//    drives the true output to ~-1.98; clamping corrupts the state.
#pragma once

#include <cstddef>

namespace seamic {

class DcBlocker {
 public:
  DcBlocker() = default;
  DcBlocker(const DcBlocker&) = delete;
  DcBlocker& operator=(const DcBlocker&) = delete;

  // Control thread: set rates. Cutoff is clamped to (0, fs/2); resets state.
  void prepare(double sample_rate_hz, double cutoff_hz = 20.0);

  // Any thread when the audio thread is idle: power-on state
  // (x_prev = y_prev = 0, bypassed/dry — legacy CMajor parity).
  void reset();

  // Control thread: bypass outputs dry x but the filter state keeps updating.
  void setBypass(bool bypassed) { bypassed_ = bypassed; }

  // Audio thread.
  double processSample(double x);
  void processBlock(const float* in, float* out, int n);

  double alpha() const { return alpha_; }
  bool isBypassed() const { return bypassed_; }

 private:
  static double poleFor(double cutoff_hz, double sample_rate_hz);

  double x_prev_ = 0.0;    // x[n-1]
  double y_prev_ = 0.0;    // y[n-1]
  double alpha_ = 0.0;     // pole, set by prepare()
  bool bypassed_ = true;  // power-on = dry (legacy CMajor parity)
};

}  // namespace seamic
