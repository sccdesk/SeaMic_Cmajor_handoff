Follow the workspace rules in `../AGENTS.md`.

Use plain HTML, CSS, and JavaScript with the official generated Cmajor runtime. Do not add frameworks, npm, bundlers, or TypeScript. Serve the web console over local HTTP. Never edit `web/cmajor-runtime/` or hand-edit files in `web/generated/`; regenerate official patch bundles with the Cmajor CLI instead.

Keep all user-facing text and maintained project documentation in English. Start microphone monitoring on the reduced-level DRY route with every DSP processor bypassed. Keep AEC unavailable until a real far-end playback reference is connected. Make bypass state explicit: ON means bypassed and dry pass-through; OFF means active processing.

The browser must use seven independent Cmajor module patches in the target signal chain. `SeaMicDSPChain.cmajorpatch` is only a composite CLI harness and is not loaded by the web app. Accurately distinguish current implementations from pending features.
