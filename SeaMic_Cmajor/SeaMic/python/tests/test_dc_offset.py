"""Phase 1 acceptance tests: DC offset blocker oracle.

Each test pins a numbered acceptance criterion. The C++ product must pass
the same criteria differentially against this oracle.
"""

import numpy as np
import pytest
from scipy.signal import freqz, lfilter

from seamic_ref import DCBlocker, analytic_magnitude, pole_for

FS = 16000.0
ALPHA = pole_for(20.0, FS)


def lfilter_ref(xs, alpha=ALPHA):
    return lfilter([1.0, -1.0], [1.0, -alpha], np.asarray(xs, dtype=float))


def oracle_out(xs, alpha=ALPHA):
    blk = DCBlocker(sample_rate_hz=FS)
    blk.alpha = alpha  # pin exact pole under test
    blk.set_bypass(False)  # power-on default is dry; tests probe the filter
    return blk.process_block(np.asarray(xs, dtype=float))


# --- AC1: zero initial state == canonical filter ---------------------------
def test_step_response_matches_scipy():
    xs = np.ones(64)
    np.testing.assert_allclose(oracle_out(xs), lfilter_ref(xs),
                               rtol=0, atol=1e-12)


def test_white_noise_matches_scipy():
    rng = np.random.RandomState(0)
    xs = rng.uniform(-1.0, 1.0, 48000)
    np.testing.assert_allclose(oracle_out(xs), lfilter_ref(xs),
                               rtol=0, atol=1e-12)


def test_speech_like_sweep_matches_scipy():
    n = np.arange(48000)
    xs = 0.3 * np.sin(2 * np.pi * (50 + 19950 * n / 48000) * n / FS)
    np.testing.assert_allclose(oracle_out(xs), lfilter_ref(xs),
                               rtol=0, atol=1e-12)


# --- AC2: DC converges to zero, no divergence ------------------------------
def test_dc_converges_to_zero():
    out = oracle_out(np.full(8000, 0.5))
    assert out[-1] == pytest.approx(0.0, abs=1e-6)
    # monotone tail: |y| never grows after the peak
    tail = np.abs(out[100:])
    assert np.all(np.diff(tail) <= 1e-15)


def test_dc_matches_scipy_bit_exact():
    out = oracle_out(np.full(4000, 0.5))
    np.testing.assert_allclose(out, lfilter_ref(np.full(4000, 0.5)),
                               rtol=0, atol=1e-6)


# --- AC3: first sample unity gain, no priming ------------------------------
def test_first_sample_unity_gain():
    blk = DCBlocker(sample_rate_hz=FS)
    blk.set_bypass(False)
    assert blk.process_sample(0.7) == pytest.approx(0.7, rel=1e-15)


def test_power_on_default_is_bypassed():
    """Power-on/reset default is dry (legacy CMajor parity)."""
    blk = DCBlocker(sample_rate_hz=FS)
    assert blk.bypassed is True
    assert blk.process_sample(0.7) == 0.7  # dry, bit-exact
    assert blk.process_block(np.ones(8)).tolist() == [1.0] * 8
    blk.set_bypass(False)
    blk.reset()
    assert blk.bypassed is True


# --- AC3b: bypass is dry but keeps the state warm -----------------------
def test_bypass_dry_warm_state():
    """Bypass outputs x bit-exactly, yet un-bypassing resumes the true filter.

    Mirrors CMajor DCOffsetRemoval (filter steps run unconditionally).
    """
    xs = np.concatenate([np.full(50, 0.5), np.full(50, -0.25)])
    ref = oracle_out(np.tile(xs, 2))
    blk = DCBlocker(sample_rate_hz=FS)
    for x in xs:
        blk.set_bypass(True)
        assert blk.process_sample(float(x)) == x  # bit-exact dry
    blk.set_bypass(False)
    for i, x in enumerate(xs):
        assert blk.process_sample(float(x)) == pytest.approx(
            ref[len(xs) + i], rel=1e-12)


# --- AC4: analytic magnitude == freqz --------------------------------------
def test_analytic_magnitude_matches_freqz():
    f = np.array([0., 1., 5., 10., 20., 40., 100., 500.,
                  1000., 4000., 8000.])
    _, h = freqz([1, -1], [1, -ALPHA], worN=2 * np.pi * f / FS)
    np.testing.assert_allclose(analytic_magnitude(f, ALPHA, FS),
                               np.abs(h), rtol=0, atol=0)


def test_cutoff_region_at_20hz():
    # pole_for() places the pole at exp(-2*pi*fc/fs), which lands at
    # -2.976 dB @ 20 Hz (measured), NOT exactly -3.010 dB. The gate pins the
    # real value: -3.0 dB +/- 0.05 dB. A product computing alpha any other
    # way (e.g. 1 - 2*pi*fc/fs) lands outside this band.
    mag = analytic_magnitude(np.array([20.0]), ALPHA, FS)[0]
    assert 20 * np.log10(mag) == pytest.approx(-2.976, abs=0.05)


# --- AC5: clip prohibition --------------------------------------------------
def test_clamping_corrupts_state():
    """AC5 guard: clamping y to [-1,1] diverges from the canonical filter.

    Any product implementation that clamps the state must FAIL this test.
    """
    xs = np.concatenate([np.ones(500), -np.ones(5000)])
    good = oracle_out(xs)
    xp = yp = 0.0
    bad = np.empty_like(xs)
    for n, x in enumerate(xs):
        y = x - xp + ALPHA * yp
        if y < -1.0:  # the forbidden clamp
            y = -1.0
        xp, yp = x, y
        bad[n] = y
    assert np.max(np.abs(good - bad)) > 0.5  # ~0.98 measured


# --- AC6: float32 state widens the fade -------------------------------
def test_float32_kills_fade_tail():
    """AC6 guard: float32 state rounds a -60 dBFS tail to zero.

    Scenario: a 0.5 DC pulse of 100 samples, then digital silence, emulated
    in float32 from sample 0 (as a real product would run). The decaying
    pole residue (a^n * C) falls below the float32 LSB grid (~1e-7 relative)
    long before float64 stops resolving it, so float32 self-noise dominates
    the late tail while float64 is still decaying cleanly.
    Measured: rms32 ~= 8.8e-44, rms64 ~= 2.0e-138 (ratio ~= 2.1e+189).

    Documents why the product state must be float64 (or wider than the
    audio word). Measured under pytest; informational, not a product gate.
    """
    f32 = np.float32
    a32 = f32(ALPHA)
    xs = np.zeros(48000)
    xs[:100] = 0.5  # DC pulse, then digital silence
    # float64 oracle tail energy after the transient has died
    e64 = np.mean(oracle_out(xs)[40000:] ** 2)
    # float32 emulation of the same recurrence, state carried from sample 0
    xp = yp = f32(0.0)
    y32 = np.empty_like(xs)
    for k, x in enumerate(xs):
        y = f32(f32(x) - xp + a32 * yp)
        xp, yp = f32(x), y
        y32[k] = float(y)
    e32 = np.mean(y32[40000:] ** 2)
    assert e32 > 10 * e64  # float32 tail is at least 10 dB HOTTER
