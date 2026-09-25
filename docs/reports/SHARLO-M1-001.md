# Report: SHARLO-M1-001 — OpenCV.js (WASM) integration & lazy-load strategy

**Status: implementation complete, locally verified (including in a real browser), PR #12 open and pending this session's CI-verify-then-merge.**

---

## 🚩 Flags — read this section first

Nothing blocked, ambiguous, or descoped. One thing worth flagging even though it's resolved, not open: **the task's literal implementation approach changed mid-task**, and changed again a second time, based on evidence gathered while building it — not a scope question, but worth being upfront about since the first two approaches are gone from the final diff entirely and a future session reading only the code wouldn't see the reasoning. Full detail in "Key decisions" below.

---

## What was built

- **`apps/web/lib/scanning/opencv-loader.ts`** — the actual lazy-load mechanism. Exports `loadOpenCv()`, which on first call injects a `<script src="/vendor/opencv.js">` tag, waits for it to load, then waits for the OpenCV runtime to signal ready (handling both documented shapes the package can export — a Promise, or a Module object with an `onRuntimeInitialized` callback). Concurrent/repeated calls reuse the in-flight promise or the cached result; a failed load resets to `idle` so the next call retries. Framework-agnostic plain TypeScript, per `ARCHITECTURE.md` §3's requirement for `/lib/scanning`.
- **`apps/web/scripts/copy-opencv-asset.mjs`** — copies the pinned `@techstark/opencv-js` package's `dist/opencv.js` into `apps/web/public/vendor/opencv.js`, resolved via `import.meta.resolve` (npm workspaces hoist the package to the repo-root `node_modules`, not `apps/web/node_modules`). Wired into `predev`/`prebuild` in `package.json`. The copied file is gitignored, not committed — it's fully reproducible from the locked dependency version, the same reasoning as not committing `node_modules`.
- **`apps/web/app/(app)/scan/page.tsx`** + **`scan-client.tsx`** — the scan route. `page.tsx` is a plain Server Component; `scan-client.tsx` (`'use client'`) is a small state machine (`loading` → `ready`/`error`) that calls `loadOpenCv()` in a `useEffect` and renders a visible loading indicator until it resolves. Deliberately minimal beyond that — camera capture, corner detection, and everything else in the scanning pipeline are separate M1 tasks (M1-002 onward), not this one.
- **`apps/web/app/(marketing)/page.tsx`** — the existing homepage, moved (not rewritten) into the `(marketing)` route group. `ARCHITECTURE.md` §3 already documented this split; it just hadn't been applied yet since there was only one page. Doing it now gives "the marketing bundle is unaffected" an actual structural boundary to verify against, which this task's own acceptance criterion needed anyway.
- **Test infrastructure for `apps/web`** — Vitest + jsdom + Testing Library, none of which existed yet (the workspace had zero tests before this task). `vitest.config.mts` (`.mts` specifically — see "Deviations"), `vitest.setup.ts` (loads `@testing-library/jest-dom` matchers). 7 tests total: 4 for the loader's state machine (both upstream response shapes, caching/dedup, failure-doesn't-stick-forever — including a regression test described below), 3 for the component (loading indicator shown, transitions to ready, transitions to error).
- **`docs/ARCHITECTURE.md`** — not changed this task; its existing §3 route-group structure and `/lib/scanning` description were already accurate for what this task builds, confirmed by re-reading before starting rather than assumed.

## Key decisions

### 1. How OpenCV.js gets into the page changed twice, based on evidence, not preference

**First attempt: `import('@techstark/opencv-js')` (bundler dynamic import).** This is the obvious, idiomatic Next.js way to lazy-load a dependency, and it's what I implemented first. It failed to even build: Turbopack refused to resolve the package's internal `require('fs')`/`require('path')` calls (dead Node.js-only code paths inside the UMD build, but bundlers still try to statically resolve them). Fixable with `next.config.ts`'s `turbopack.resolveAlias` pointed at a stub module — documented in Next.js 16's own upgrade guide, so not a guess.

**That fix made it build, but not work.** Once built, I tested it in a real browser (Playwright, using this environment's pre-installed Chromium — see "How this was tested") rather than trusting that a successful build meant a working feature. The scan page's loading indicator appeared, but never progressed to "ready." Direct process inspection showed the renderer pinned at 100%+ CPU continuously — not slow, genuinely stuck. I isolated this with a sequence of increasingly targeted tests (raw `<script>` tag load of the same file: ~1.1s, works fine; the same file loaded via bundler `import()`: never completes) and concluded the Turbopack-bundled dynamic import of this specific ~11MB legacy emscripten file is the problem, not my code or this environment's raw performance.

**Second (final) approach: a dynamically-injected `<script>` tag pointing at a copy of the file in `public/`.** This is the pattern the emscripten build is actually designed for (its own README shows `<script>`-tag usage as the primary example), and it sidesteps bundler reprocessing entirely — the browser just fetches and executes the file as-is. Verified this reaches the ready state in ~1.5s, matching the raw-script-tag baseline. The tradeoff: the file needs to physically exist under `public/` at a URL the browser can fetch, hence the `copy-opencv-asset.mjs` script rather than a bundler reference.

### 2. A second bug, found while root-causing the first, turned out to be the actual cause of the hang

Fixing the bundler-import problem (switching to a `<script>` tag) did **not** fix the hang — it just changed where the hang happened. I kept the browser-based diagnostic approach (adding timestamped logging at each step of the load sequence, then removing it once done — no diagnostic code remains in the final diff) and narrowed the hang to one exact boundary: my `loadAndAwaitRuntime()` function's `return cv;` statement, at the very end of an `async function`.

The cause: the emscripten Module object (`cv`) has its own `.then()` method, so it can be used as `Module.then(cv => ...)` directly — that's a real, documented feature of this package, not a bug in it. But that `.then()` implementation resolves itself **with itself** (`func(Module)`, calling back with the same object). JavaScript's own Promise machinery, per spec, checks whether any value used to resolve a Promise is itself "thenable" (has a callable `.then`) and if so, unwraps it by calling that `.then()` — which is exactly the right behavior for a real Promise, and exactly the wrong behavior here: `return cv` from my async function triggered this check, which called `cv.then()`, which called back with `cv` again, which triggered the same check again, forever. Each step is a queued microtask, so this doesn't stack-overflow — it just runs forever, which is precisely the "100%+ CPU, never recovers" symptom I'd seen and initially, incorrectly, attributed entirely to the bundler.

Fixed by making sure `cv` never crosses a Promise boundary unwrapped, anywhere in the chain: `loadOpenCv()` resolves with `{ cv }` (a plain object, no `.then` of its own), always destructured synchronously inside a `.then()` callback body rather than returned bare. Documented directly on the `OpenCvHandle` type so a future change doesn't reintroduce this by "simplifying" the return type back to `OpenCvRuntime`.

**Test coverage for this specific regression**, not just the feature: `opencv-loader.test.ts`'s mock `cv` object has a real `.then()` method shaped like the actual package's (self-resolving), but bounded — it throws after being called more than a few times rather than genuinely recursing forever. A true infinite version would hang the test (and CI) exactly the way the real bug did, since the resulting microtask storm would starve the event loop before Vitest's own timeout (a macrotask) ever got a chance to fire — bounding it converts a would-be-infinite hang into a fast, clearly-diagnosed test failure if this regresses.

### 3. The copied asset is gitignored, not committed

`@techstark/opencv-js` is pinned in `package.json` (devDependency — it's only ever read at build/dev time by the copy script, never imported into shipped application code, hence dev not prod). The copy is fully reproducible from that pinned version, so committing an ~11MB generated file alongside the source it's generated from would just be duplication with a staleness risk if the two ever drifted. Same reasoning already applied to `node_modules` and `.next/`.

## Deviations from the task description

- **`vitest.config.mts`, not `.ts`.** Vite's config loader warned about ESM-in-a-CommonJS-context ambiguity for a plain `.ts` config in a package without `"type": "module"`. `eslint.config.mjs` already solves the identical problem the same way in this repo (explicit `.mjs` extension rather than a package-wide `"type": "module"` change); `.mts` is the direct TypeScript equivalent, so this follows existing convention rather than introducing a new one.
- **`vite-tsconfig-paths` plugin added, then removed again in the same task.** Needed it briefly for the `@/*` import alias to resolve inside tests; a warning pointed out that a recent Vite version supports this natively via `resolve.tsconfigPaths: true`, so switched to that and dropped the extra dependency before finishing.
- **Route-group move of the homepage** — not explicitly asked for by M1-001's description, but directly required to make "marketing bundle unaffected" a checkable claim rather than an assumption, and it's a pure move (route groups don't affect URLs), not a rewrite.

## How this was tested

- **`npm run ci`** (format, lint, typecheck, test across both workspaces) — green. 7 new tests for `web` (previously 0); `api`'s existing tests unaffected.
- **Production build inspected directly**, not just "it compiled": checked `.next/static/chunks/` file sizes and each route's `build-manifest.json`/`client-reference-manifest.js` before and after the fix. Confirmed the OpenCV file is not referenced by either route's static chunk list at all (it's a runtime-only fetch triggered by `loadOpenCv()`, not a bundled dependency of the route).
- **A real browser, not just Playwright's usual DOM assertions** — this is the part worth calling out explicitly, since it's what actually caught both bugs above; neither would have been caught by unit tests alone (my own mocks didn't originally replicate the real package's problematic `.then()` shape either, until I understood why it mattered). Used this environment's pre-installed Chromium via Playwright (scratchpad-only script, not committed to the repo) against the actual production build (`next build` + the real standalone `server.js`, the same artifact the Dockerfile ships) to verify, with real network/DOM observation:
  - The marketing page's network requests never include the OpenCV asset.
  - The scan page's do, exactly once, and the loading indicator is visible from first paint.
  - Time from navigation to the "ready" state: ~1.7s, consistent with the raw-file baseline.
  - The loading indicator is removed once ready (not left stuck alongside the ready content).
- **Not done: an actual Docker build.** This sandbox has the Docker CLI but no daemon (`docker info` confirms no socket) — consistent with what earlier M0 reports already noted about this environment. Reasoned through why the Dockerfile needs no changes (the `prebuild` script runs during the existing `npm run build -w web` step inside the `build` stage, before the existing `COPY --from=build .../public ./apps/web/public` line, so the generated `public/vendor/opencv.js` is included automatically) rather than leaving it unverified — but the actual build is CI's "Docker images build" job to confirm, the same division of labor as every prior task in this project.

## Current status

Done, pending this session's CI verification and merge on PR #12 (same open-then-verify-then-merge pattern as this session's other PRs — this one doesn't need founder review before merging, unlike the Addendum 2 docs PR, since it's an authorized M1 task rather than a scope decision).
