# ADR-0001: Client-side OMR detection with OpenCV.js (WASM), not server-side or third-party vision APIs

**Status:** Accepted

## Context

Sharlo needs to detect corner alignment markers, dewarp a photographed bubble sheet, and read bubble fill state, fast enough to feel instantaneous (~2 seconds, zero clicks) and cheaply enough to support a generous free tier (150 sheets/month) without the per-scan cost eating the business model.

## Decision

All image analysis (corner detection, perspective transform, bubble-grid sampling, confidence scoring) runs **entirely in the browser** using OpenCV.js compiled to WebAssembly. No sheet image, or any derivative of it, is ever sent to our backend or to a third-party OCR/vision API.

## Alternatives considered

- **Server-side processing (our own backend, e.g., Python + OpenCV/scikit-image).** Rejected: requires the raw sheet photo to leave the device, which directly conflicts with the "servers can never read student data" requirement at its source — encryption after the fact doesn't help if the plaintext image already transited a server for analysis. Also adds network latency to the 2-second capture budget and server compute cost that scales with scan volume.
- **Third-party vision/OCR API (e.g., a cloud document-AI service).** Rejected for the same data-exposure reason, plus a real per-scan API cost that breaks the free-tier economics, plus a new vendor dependency/outage risk sitting directly in the core product loop.
- **Native mobile app doing on-device (non-web) vision processing.** Out of scope — v1 is explicitly web/PWA only (kickoff prompt §8).

## Consequences

- The detection pipeline must be genuinely fast and correct in a browser/WASM environment, on real mid-range phones, not a server with GPUs — this is a real engineering constraint on the algorithm choices in M1, not just a deployment detail.
- Because there's no server round-trip per scan, scanning works offline by construction (see FR-SCAN-06 in `docs/SRS.md`) — a nice side effect of the privacy/cost decision, not a separate investment.
- We give up the option of iterating on detection accuracy via a server-side model update pushed independently of a client release; accuracy improvements ship as app updates. Acceptable tradeoff given the WASM bundle is already lazy-loaded and cacheable.
- Marketing gets a genuinely strong, true claim: "your students' photos never leave your device." (See the digital-marketing note in `docs/reports/SHARLO-M0-001.md`.)
