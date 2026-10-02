---
mode: 'edit'
description: 'Plan a SeaMic feature before changing code.'
---

# /feature — SeaMic DSP Workspace

I want to add this feature: $INPUT

Before writing or changing any code, prepare a plan in this exact order.

## Step 1 — Read required context

Read these files, in order, before proposing anything:
1. `AGENTS.md` (rules, stack, and boundaries).
2. `MEMORY.md` (current state, decisions, and recorded exceptions).

If either file is missing, say so clearly and propose creating it as a prerequisite.

## Step 2 — Analyze the feature

Briefly explain:
- What problem it solves in SeaMic.
- Which stack areas it affects: Web, Cmajor, C++, Java/OOP, Python, Bash, or documentation.
- Which OOP or DSP-domain concepts are involved.

## Step 3 — Verify the stack

Check whether the feature fits the stack allowed by `AGENTS.md`.

If it requires anything outside the permitted stack:
- Identify it explicitly as a **technical exception**.
- Explain why the current stack cannot solve it.
- Propose recording the reason in `MEMORY.md` before proceeding.
- **Do not implement it until I approve the exception.**

## Step 4 — Implementation plan

Use this exact structure:

### 4.1 Files to create or modify

List every file with its full path, one-line responsibility, and whether it is new or modified.

### 4.2 Proposed changes

For each file, describe the planned changes in pseudocode or bullet points. Do not write implementation code yet.

### 4.3 Impact on protected files

Say whether the plan touches any of these files or directories, which require explicit permission:
- `cmajor/legacy/*`
- `web/cmajor-runtime/*`
- `web/generated/*`
- `SeaMicDSPChain.cmajorpatch`

### 4.4 Edge cases and open questions

List checkboxes for:
- [ ] Edge cases I need to decide.
- [ ] Ambiguous decisions requiring my approval.
- [ ] Conflicts with `AGENTS.md` or `MEMORY.md`.

### 4.5 Documentation updates

Describe any updates needed for:
- `MEMORY.md` (status, decisions, exceptions).
- `AGENTS.md` (if a new permanent rule is introduced).
- `docs/` (if applicable).

## Step 5 — Stop and request approval

**Do not change any files yet.**

End the response with this exact sentence:
> "Waiting for plan approval. Reply 'OK' to execute it, or request changes before continuing."

## Additional rules

- If the feature is large (more than three files or an estimated hour of work), propose splitting it into smaller features.
- If it conflicts with the reference DSP chain (ADC → DC Offset → AEC → De-Reverb → VAD/Soft Gate → AGC/K-Weighting → Tone → DC Block → Look-Ahead Limiter), call out the conflict clearly.
- If the feature affects acoustic DSP parameters, follow the measurement and handoff requirements in `AGENTS.md`.
- Use English throughout.
- When implementation is approved, keep the code simple and clear.
