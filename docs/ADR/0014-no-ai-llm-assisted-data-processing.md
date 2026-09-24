# ADR-0014: No AI/LLM-assisted data processing anywhere in the product

**Status:** Accepted — founder directive (Addendum 2, `docs/reports/SHARLO-M0-009.md`), stated here as a general product boundary rather than a note scoped to one feature, since a future feature request could otherwise reasonably assume an AI-assisted approach fits a product built by an AI coding agent.

## Context

An AI/LLM-assisted approach was considered for one specific problem: when a teacher imports their own already-prepared result file (`FR-IMPORT-*`), names or fields in that file might not cleanly match the app's roster (typos, reordered columns, "Roll No" vs. "Roll Number"). An LLM — self-hosted or via a "bring your own API key" integration — could plausibly resolve these mismatches more flexibly than fixed logic. The founder rejected this approach entirely, for reasons that generalize beyond just the import feature.

## Decision

**No AI/LLM-assisted matching, resolution, or interpretation of student data or exam content, anywhere in the product.** No "connect your AI provider" feature, no self-hosted model, no LLM call in any data-processing path. The import-matching problem is solved instead with:

- A one-time, teacher-facing **column-mapping screen** (`FR-IMPORT-02`) — the teacher explicitly maps their file's columns to the app's fields.
- A **deterministic string-similarity heuristic** (fixed algorithm, not a model call) to pre-fill sensible guesses (e.g., "Roll No" → Roll Number) as a convenience — always shown to and confirmed by the teacher before anything is saved, never auto-applied silently.
- An explicit **pre-save validation suite** (`FR-IMPORT-03`) that surfaces data-quality problems (missing/duplicate roll numbers, row-count mismatches against the existing roster, non-numeric marks) for the teacher to see and resolve, rather than having anything — human heuristic or model — guess its way past them.

## Alternatives considered

- **LLM-assisted fuzzy matching** (the original idea this ADR cancels). Rejected for two compounding reasons, in the founder's own framing: cost/complexity (a per-import model call, infrastructure, and either a hosted API bill or the complexity of "bring your own key" support), and — the more important one — **an unacceptable risk of silently wrong data**. A mismatch that gets confidently but incorrectly resolved by a model produces a student with the wrong marks, with no obvious sign anything went wrong. This is the exact same failure mode `NFR-ACC-03` was written to prevent in the scanning engine (never auto-guess an ambiguous mark — flag it instead), and this ADR extends that same principle to a completely different feature area: **deterministic-and-flagged beats probabilistic-and-silent**, everywhere in this product, not just in bubble-sheet detection.
- **A narrower, "just for import" version of this rule.** Considered and rejected as too narrow — the reasoning above (cost, and more importantly the silent-wrong-data risk) doesn't stop applying just because the specific feature changes. Stating it as a general boundary means a future feature proposal that reaches for "we could use an LLM to help with X" has to clear this ADR explicitly, rather than the import-specific version of the rule being read as implicitly not applying elsewhere.

## Consequences

- The column-mapping and validation UI (`FR-IMPORT-02/03`) has to be good enough to carry the whole burden of handling messy real-world import files, since there's no probabilistic fallback to lean on if the deterministic heuristic guesses wrong — this is a real UX design responsibility, not a lesser feature for skipping the "smarter" approach.
- No dependency on any AI/LLM provider's API, pricing, or availability for any core product flow — consistent with, and for the same reasons as, `ADR-0001`'s rejection of third-party vision APIs for scanning (cost predictability, no new vendor outage risk sitting in a core workflow).
- If a future, genuinely different use case seems to want AI/LLM assistance (this ADR doesn't attempt to anticipate what that might be), that's explicitly a **new decision requiring the same level of founder sign-off this one got** — not something this ADR's existence should be read as having pre-approved by omission, and not something to build quietly on the assumption that "the founder just didn't think of this specific case."
