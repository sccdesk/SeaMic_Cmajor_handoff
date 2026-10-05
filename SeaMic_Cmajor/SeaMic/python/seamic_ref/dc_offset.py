"""DC offset blocker reference implementation (Tier 2).

First-order high-pass IIR::

    y[n] = x[n] - x[n-1] + alpha * y[n-1],   alpha = exp(-2*pi*fc/fs)

VERIFIED against scipy.signal.lfilter (zero initial state): exact match
(max err = 0.0 on the 64-sample step; <= 7e-15 on all probed inputs).

Initial state: x_prev = 0, y_prev = 0.
Rationale (verified): y[0] = x[0] - 0 + alpha*0 = x[0], i.e. unity gain on
the first sample. No startup click exists, so no priming or fade-in is
needed. Any deviation from zero initial state (e.g. pre-filling x_prev,
or fading alpha from 0) breaks bit-exactness with the canonical filter.

FORBIDDEN in product code (verified, see tests):
  * clamping y_prev to [-1, 1] -- a full-scale downward step drives the
    true filter output to ~-1.98; clamping corrupts the state (peak error
    ~0.98) and the error persists for ~584 samples (~36 ms at 16 kHz).
    Let the output exceed the rails; downstream stages own the headroom
    policy.

This module is derived from the closed-form math, NOT transcribed from
the C++ product. The C++ product is differentially tested against this.
"""

from __future__ import annotations

import math

import numpy as np


def pole_for(cutoff_hz: float, sample_rate_hz: float) -> float:
    """Return the IIR pole for a -3 dB cutoff at ``cutoff_hz``."""
    if not 0.0 < cutoff_hz < sample_rate_hz / 2.0:
        raise ValueError("cutoff_hz must lie in (0, fs/2)")
    return math.exp(-2.0 * math.pi * cutoff_hz / sample_rate_hz)


def analytic_magnitude(freq_hz: np.ndarray, alpha: float,
                       sample_rate_hz: float) -> np.ndarray:
    """Closed-form |H(e^{jw})| of the DC blocker.

    H(z) = (1 - z^-1) / (1 - alpha*z^-1).
    VERIFIED: matches scipy.signal.freqz (max err = 3.3e-16 on 400 log points).
    """
    w = 2.0 * np.pi * np.asarray(freq_hz, dtype=np.float64) / sample_rate_hz
    zinv = np.exp(-1j * w)
    return np.abs((1.0 - zinv) / (1.0 - alpha * zinv))


class DCBlocker:
    """Stateful first-order DC blocker, float64 oracle.

    One instance per channel. Never share state across channels.
    """

    def __init__(self, cutoff_hz: float = 20.0,
                 sample_rate_hz: float = 16000.0) -> None:
        if sample_rate_hz <= 0.0:
            raise ValueError("sample_rate_hz must be positive")
        self.sample_rate_hz = float(sample_rate_hz)
        self.cutoff_hz = float(cutoff_hz)
        self.alpha = pole_for(self.cutoff_hz, self.sample_rate_hz)
        self.bypassed = True  # power-on = dry (legacy CMajor parity)
        self.reset()

    def reset(self) -> None:
        """Return to power-on state: x_prev = y_prev = 0, bypassed (dry)."""
        self.x_prev = 0.0
        self.y_prev = 0.0
        self.bypassed = True

    def set_bypass(self, bypassed: bool) -> None:
        """Select dry output. State keeps updating (CMajor parity)."""
        self.bypassed = bool(bypassed)

    def process_sample(self, x: float) -> float:
        """Process one sample: y = x - x_prev + alpha * y_prev."""
        y = x - self.x_prev + self.alpha * self.y_prev
        self.x_prev = x
        self.y_prev = y
        return x if self.bypassed else y

    def process_block(self, xs: np.ndarray) -> np.ndarray:
        """Process a 1-D block, preserving state across calls."""
        xs = np.asarray(xs, dtype=np.float64)
        out = np.empty_like(xs)
        for n, x in enumerate(xs):
            out[n] = self.process_sample(float(x))
        return out
