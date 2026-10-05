"""SeaMic reference implementations.

Tier 2 of the three-tier architecture: a numerically precise, independently
written reference that defines the *correct* result for each DSP module. The
C++ product implementation is differentially tested against this.

These modules must be derived from the closed-form math, NOT transcribed from
the C++ code. A transcription of the product would agree with the product even
when both are wrong.
"""

from __future__ import annotations

from .dc_offset import DCBlocker, analytic_magnitude, pole_for

__all__ = ["DCBlocker", "analytic_magnitude", "pole_for"]
