// Differential test: C++ DcBlocker vs the Python oracle vectors.
// Self-contained (assert only, no gtest): any C++17 compiler can build it:
//   cl /std:c++17 /I cpp cpp/seamic/dc_blocker.cc cpp/tests/test_dc_blocker.cc
// Vectors below were measured from python/seamic_ref/dc_offset.py (fs=16k, fc=20Hz).
#include "seamic/dc_blocker.h"

#include <cassert>
#include <cmath>
#include <cstdio>

namespace {

constexpr double kAlpha = 0.9921767803;  // exp(-2*pi*20/16000)
// Step response to x = ones(8): oracle output, rounded to 6 dp.
constexpr double kStep8[8] = {1.0, 0.992177, 0.984415, 0.976713,
                              0.969072, 0.961491, 0.953969, 0.946506};

bool near(double a, double b, double tol) { return std::fabs(a - b) <= tol; }

}  // namespace

int main() {
  seamic::DcBlocker blk;
  assert(blk.isBypassed());  // power-on default is dry (legacy parity)
  blk.prepare(16000.0, 20.0);
  assert(blk.isBypassed());  // prepare() returns to power-on state
  blk.setBypass(false);      // tests below probe the filter path

  // AC4b gate input: exact pole, not the Taylor approximation.
  assert(near(blk.alpha(), kAlpha, 1e-9));

  // AC3: first sample unity gain from zero state.
  assert(near(blk.processSample(0.7), 0.7, 1e-15));
  blk.reset();
  blk.setBypass(false);

  // AC1: step response matches the oracle.
  for (int i = 0; i < 8; ++i)
    assert(near(blk.processSample(1.0), kStep8[i], 1e-9));
  blk.reset();
  blk.setBypass(false);

  // AC2: DC converges to zero, monotone tail.
  double prev = 1e9;
  double last = 0.0;
  for (int i = 0; i < 8000; ++i) {
    last = blk.processSample(0.5);
    if (i >= 100) {
      assert(std::fabs(last) <= prev + 1e-15);
      prev = std::fabs(last);
    }
  }
  assert(std::fabs(last) < 1e-6);
  blk.reset();
  blk.setBypass(false);

  // AC5: no clamp — a +1 -> -1 step must reach ~-1.98, not stop at -1.
  for (int i = 0; i < 500; ++i) blk.processSample(1.0);
  double mn = 0.0;
  for (int i = 0; i < 5000; ++i) mn = std::fmin(mn, blk.processSample(-1.0));
  assert(mn < -1.9 && mn > -2.0);
  blk.reset();

  // Bypass: dry output, warm state (un-bypassing continues the true filter).
  seamic::DcBlocker ref;
  ref.prepare(16000.0, 20.0);
  ref.setBypass(false);
  for (int i = 0; i < 100; ++i) {
    const double x = (i < 50) ? 0.5 : -0.25;
    ref.processSample(x);
    blk.setBypass(true);
    assert(near(blk.processSample(x), x, 0.0));  // bit-exact dry
  }
  blk.setBypass(false);
  for (int i = 0; i < 100; ++i) {
    const double x = (i < 50) ? 0.5 : -0.25;
    assert(near(blk.processSample(x), ref.processSample(x), 1e-12));
  }

  // AC6 rule is structural (double state): verified by inspection of the header.
  static_assert(sizeof(seamic::DcBlocker) >= 3 * sizeof(double),
                "state must be float64");

  std::puts("ALL DIFFERENTIAL CHECKS PASSED (oracle vectors, fs=16k fc=20Hz)");
  return 0;
}
