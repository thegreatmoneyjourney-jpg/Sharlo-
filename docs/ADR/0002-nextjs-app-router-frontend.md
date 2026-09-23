# ADR-0002: Next.js (App Router) for the whole frontend, including the scanning app

**Status:** Accepted

## Context

The product has two very different frontend needs: a marketing/content site that needs strong SEO/AEO/GEO (server-rendered, crawlable, fast), and a camera/WASM/crypto-heavy scanning app that is inherently a client-side application. We want one codebase and one deploy pipeline rather than splitting these into separate stacks.

## Decision

Use Next.js with the App Router for everything — marketing pages as server components with full SSR/metadata support, and the scanning/results app as client components within the same app, sharing routing, auth, and design system.

## Alternatives considered

- **Separate SPA (e.g., Vite + React) for the app, static site generator for marketing.** Rejected: two codebases, two deploy pipelines, duplicated auth/design-system work, and the marketing site would need its own solution for anything dynamic (pricing by country tier, etc.) that the app already has to solve.
- **A non-React SSR framework (e.g., SvelteKit, Remix).** Not rejected on technical merit so much as ecosystem fit — React has the deepest OpenCV.js/WASM and camera-API community precedent to build on, and Next.js's metadata/SEO tooling directly serves FR-SEO requirements out of the box.

## Consequences

- Marketing pages get proper SSR, metadata, and OpenGraph support for free, satisfying FR-SEO-01/02/05 without extra tooling.
- The scanning/results routes are client-heavy by necessity (camera access, WASM, Web Crypto) — care is needed to keep them out of the SSR critical path so they don't hurt marketing-page performance/bundle size; route-level code splitting handles this.
- One shared design system and auth layer across marketing, app, and (as a separate deploy target) admin.
