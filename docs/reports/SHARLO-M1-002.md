# Report: SHARLO-M1-002 — Camera capture pipeline

**Status: implementation complete, locally verified (including in a real browser), pending this session's CI-verify-then-merge.**

---

## 🚩 Flags — read this section first

Nothing blocked or ambiguous in scope. One thing worth flagging even though it's resolved: **real hardware verification (iOS Safari, Android Chrome) could not be performed** — this sandbox has no camera hardware and no access to either browser on a physical device. This is the same category of limitation already established and accepted for other tasks in this project (M0-005's VPS provisioning, M0-006's local Postgres testing) — handled the same way: build correctly against well-documented platform behavior, verify everything that _can_ be verified without physical hardware as rigorously as possible, and say plainly what's left unverified rather than imply it was checked. Detail on what was and wasn't verified is in "How this was tested" below. This gates FR-SCAN-04's own physical-device testing requirement (M1-008, not this task) more than it gates M1-002 itself, but it's worth surfacing now rather than only when M1-008 comes up.

---

## What was built

- **`apps/web/lib/scanning/camera.ts`** — framework-agnostic camera access, per `ARCHITECTURE.md` §3. `getCameraStream()` wraps `getUserMedia` (rear/environment-facing camera preferred, 1920×1080 ideal-not-required resolution so a low-end device still gets a stream) and classifies every failure into a typed `CameraErrorReason` (`permission-denied`, `no-camera-found`, `camera-in-use`, `insecure-context`, `unsupported`, `unknown`) rather than leaking raw `DOMException` names to the UI. `stopCameraStream()` stops every track — always called on unmount, never left running.
- **`apps/web/app/(app)/scan/use-camera-stream.ts`** — the React hook wiring `camera.ts` into component lifecycle: requests the stream on mount, attaches it to a caller-owned `<video>` ref once available, stops it on unmount, and exposes `retry()` for the error-recovery path.
- **`apps/web/app/(app)/scan/scan-client.tsx`** (updated) — now shows a live camera preview once both OpenCV (M1-001) and the camera are ready. The two loading operations run concurrently, independent of each other — nothing here depends on OpenCV being ready before requesting the camera, or vice versa; that only starts mattering once M1-003 wires actual detection to the live frames. Camera errors get reason-specific messaging and, where the failure is plausibly transient (permission denied, camera busy, unknown), a working "Try again" button — this is what satisfies "permission-denied state has a clear recovery path."
- **Tests**: `camera.ts` — 8 tests covering success, every `DOMException` name the classifier handles, the insecure-context and unsupported-browser short-circuits (verified to never even call `getUserMedia` in those cases), and stream cleanup. `use-camera-stream.ts` — 6 tests covering the state machine, retry, cleanup on unmount (including the case where the stream resolves _after_ unmount), and a regression test described below. `scan-client.tsx` — updated for the combined OpenCV+camera readiness gate and the new error/retry UI.

## Key decisions

### 1. Deliberately not using the Permissions API

`navigator.permissions.query({ name: 'camera' })` would be the obvious way to check/poll camera permission state, but Safari (desktop and iOS) has never implemented it for the camera permission name — code that depends on it silently breaks there, which is exactly the kind of iOS-specific gap this task is supposed to guard against. `getCameraStream()`'s only source of truth is `getUserMedia`'s own resolve/reject, which works identically on every browser this product targets. The tradeoff: there's no way to proactively know permission state before asking (e.g., to skip straight to a "camera blocked" UI without a request), but that's an acceptable cost for something that actually works everywhere.

### 2. `insecure-context` and `unsupported` are checked before ever calling `getUserMedia`

Both conditions make `getUserMedia` fail with an unhelpful generic error (or not exist at all) — checking `window.isSecureContext` and API presence upfront means the UI can say something specific ("requires HTTPS", "this browser doesn't support camera access") instead of a confusing generic failure. `insecure-context` matters more for local development over plain HTTP than production (which is HTTPS-only), but it's a real failure mode worth a real message rather than a mysterious one.

### 3. A real bug found via browser verification, not caught by the first version of the unit tests

Building on the M1-001 report's theme: the first implementation set `videoRef.current.srcObject = stream` inside the same effect callback that resolves the camera stream, immediately before calling `setState({ status: 'live' })`. This looked correct and passed the initial unit tests — but the `<video>` element only mounts once `state.status === 'live'` (that's the readiness gate in `scan-client.tsx`), which happens on the render _after_ this callback runs. So on every real run, `videoRef.current` is still `null` at the exact point the code tries to use it, the `if (videoRef.current)` guard silently skips the assignment, and the stream never actually gets attached — verified directly with Playwright against a real (Chromium fake-device) camera stream: the video element appeared, but `srcObject` stayed `null` and no frame data ever arrived.

The unit test didn't catch this because its fake `videoRef` was pre-populated (`{ current: {...} }`) from the start, unlike a real React ref, which is `null` until the element it's attached to actually mounts — so the test's timing didn't match reality. Fixed with the standard pattern for this exact situation: a second `useEffect` with no dependency array (runs after every render) that re-checks whether both the resolved stream and the mounted video element are available, and attaches the stream then, whichever render that ends up being. Added a second, more realistic unit test that starts with a `null` ref and only populates it after `live` is reached (mirroring real mount order) — this one does catch the original bug if reintroduced, and is called out in the test file itself as the reason for the more elaborate setup rather than the simpler pre-populated version.

### 4. Newer React 19 hook lint rules changed the hook's shape

`eslint-plugin-react-hooks`'s newer `react-hooks/refs` and `react-hooks/set-state-in-effect` rules (React Compiler-oriented, stricter than what existed when this repo was scaffolded) flagged two real patterns in the first draft: returning a `ref` bundled inside an object from a custom hook (the linter can't prove reads of the other properties are ref-independent, so it flags all of them), and calling `setState` synchronously at the top of an effect body to reset state for a retry (recommended pattern: do that reset in the event handler that triggers the retry, not inside the effect). Fixed both — `useCameraStream` now takes `videoRef` as a parameter (the caller's own `useRef`) instead of returning one, and `retry()` sets `state` back to `requesting` itself before bumping the attempt counter, rather than the effect doing it.

## Deviations from the task description

None beyond what M1-001 already established as a pattern (verify claims in a real browser, not just a passing build) — no scope changes, nothing descoped or added.

## How this was tested

- **`npm run ci`** — green. 41 total tests across `web` now (was 27 before this task; api unaffected).
- **Real browser, granted-camera case** — Chromium launched with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` (a real, synthetic video device Chromium provides for exactly this kind of testing, not a mock) against the actual production build (`next build` + the real standalone `server.js`, same artifact the Dockerfile ships). Confirmed: the `<video>` element appears, `srcObject` is attached, `readyState >= 2` (genuinely has frame data, not just a stream reference), and reports the requested 1920×1080 dimensions.
- **Real browser, error case** — same setup without the fake-device flag, so `getUserMedia` genuinely fails with `NotFoundError` (this sandbox has no camera hardware at all). Confirmed the resulting UI: correct message, "Try again" button present. Also instrumented `getUserMedia` itself (via `page.addInitScript`) to count real invocations and confirmed clicking "Try again" triggers a second genuine call — the retry mechanism actually re-attempts, not just fires a mocked callback in a test.
- Found mid-verification and worth a note for any future Playwright-based check in this repo: Next.js's own client runtime renders a `role="alert"` route-announcer element into every page for accessibility, which collides with any test selector that just matches `[role="alert"]` — a real test needs to exclude `#__next-route-announcer__` explicitly or scope more narrowly.
- **Not done: iOS Safari / Android Chrome on physical hardware.** Flagged at the top of this report. `playsInline`, `muted`, `autoPlay` on the `<video>` element and the Permissions-API avoidance are implemented per well-documented platform behavior (iOS Safari specifically forces fullscreen playback without `playsInline`, and has never supported a camera permission query), not verified against a real device.
- **Not done: an actual Docker build** — no daemon in this sandbox, same limitation noted in the M1-001 report. This task doesn't change the Dockerfile or add any new build-time asset, so there's less new surface for that job to catch here than in M1-001, but CI's own Docker build job remains the actual check.

## Current status

Done, pending this session's CI verification and merge. M1-003 (corner marker detection) is next — the point where the camera pipeline built here and the OpenCV.js runtime from M1-001 actually connect.
