// SeaMic product DSP — DC offset blocker implementation (Tier 3).
// See dc_blocker.h for the product rules. No heap, no exceptions here.
#include "seamic/dc_blocker.h"

#include <cmath>

namespace seamic {

namespace {
constexpr double kTwoPi = 6.283185307179586476925286766559;
}  // namespace

double DcBlocker::poleFor(double cutoff_hz, double sample_rate_hz) {
  // Clamp instead of throwing: the audio path must never see an exception,
  // and prepare() may be called from a realtime-safe context.
  if (sample_rate_hz <= 0.0) return 0.0;
  const double nyquist = 0.5 * sample_rate_hz;
  double fc = cutoff_hz;
  if (!(fc > 0.0)) fc = 1.0;
  if (!(fc < nyquist)) fc = nyquist * 0.999;
  // Exact pole. Do NOT use the Taylor 1 - 2*pi*fc/fs: it shifts the 20 Hz
  // gain by 0.03 dB, outside the +/-0.05 dB product gate (AC4b).
  return std::exp(-kTwoPi * fc / sample_rate_hz);
}

void DcBlocker::prepare(double sample_rate_hz, double cutoff_hz) {
  alpha_ = poleFor(cutoff_hz, sample_rate_hz);
  reset();
}

void DcBlocker::reset() {
  x_prev_ = 0.0;
  y_prev_ = 0.0;
  bypassed_ = true;  // power-on = dry (legacy CMajor parity)
}

double DcBlocker::processSample(double x) {
  const double y = x - x_prev_ + alpha_ * y_prev_;
  x_prev_ = x;
  y_prev_ = y;  // warm even when bypassed; output selects dry below
  return bypassed_ ? x : y;
}

void DcBlocker::processBlock(const float* in, float* out, int n) {
  for (int i = 0; i < n; ++i) {
    const double x = static_cast<double>(in[i]);
    const double y = x - x_prev_ + alpha_ * y_prev_;
    x_prev_ = x;
    y_prev_ = y;
    out[i] = static_cast<float>(bypassed_ ? x : y);
  }
}

}  // namespace seamic
