# Report: SHARLO-M0-012 — Incorporate Addendum 4 (M2 sign-off, capacity dashboard, load testing, status report)

**Status: done, this session.**

---

## 🚩 Flags — read this section first

### 1. "M-Ops milestone from Addendum 3" doesn't exist as a literal milestone — folded into M5 again, same reasoning as last time

The addendum offers "could fold into the M-Ops milestone from Addendum 3" as one placement option for the capacity dashboard. There is no milestone literally named "M-Ops" in `docs/TASKS.md` — Addendum 3's operations/finance/support scope was folded into the existing M5 (Admin Panel) milestone, not a new parallel one (see `docs/reports/SHARLO-M0-011.md` Flag 2 and `ARCHITECTURE.md` §15 item 11). I've read the founder's phrasing as shorthand for "wherever the ops-shaped admin-panel work already lives" rather than an instruction to retroactively rename or create a milestone, and placed the new task (`M5-016`) there for the identical reason item 11 already gives: it's admin-panel-shaped work that needs M5-001/002's subdomain/auth/audit-log infrastructure regardless, and a separate milestone would fragment one cohesive area for no dependency-graph benefit.

### 2. Load testing was already a task (`M7-006`) — concretized in place, not duplicated

The addendum's load-testing request (k6/Artillery, 1k/5k/10k/20k concurrent users, server-touching surfaces, a documented VPS-tier recommendation) substantially overlaps with an existing task, `M7-006` ("Load/performance testing... against the VPS sizing assumptions in `ARCHITECTURE.md` §12"). Rather than adding a second, parallel load-test task, I rewrote `M7-006` in place with the addendum's specifics and added a firm new deliverable (a new ADR documenting real findings + the VPS-tier/scaling-plan recommendation, not just a report) — the task ID, and every existing cross-reference to it (`NFR-SCALE-02`), stayed the same.

### 3. Explicitly un-gated `M7-006` from the rest of M7, per the founder's own timing guidance

The addendum is explicit: "it doesn't need to block ongoing feature work, but it should happen well before real user growth approaches that range, not after." Taken literally, that means `M7-006` should not wait for `M7-001`–`005`/`007`–`011` to also be underway — it only actually needs M3 (auth) + M4 (billing/webhooks) + M5 (admin API) to have stable-enough server surfaces to point a load-test tool at. I applied the exact pattern this document already uses for `M1-011` (a task that lives in one milestone's list, explicitly noted as not gated on the rest of that milestone) rather than inventing a new convention — a standalone callout sentence after the M7 table, plus the note embedded in `M7-006`'s own row.

### 4. Capacity-metrics data flow: a design decision made now, not deferred to whoever builds `M5-016`

The founder said the metrics exporter "doesn't need to be fancy." Rather than leave "how do OS/Docker metrics get into the dashboard" as an open question for the implementing session to invent from scratch, I proposed a concrete, appropriately-lightweight design now (`ARCHITECTURE.md` §6/§12): a periodic snapshot job — reusing the _existing_ in-process scheduler already built for the Recovery Key reminder cadence, not new job-queue infra — reading CPU/RAM/disk via a direct local read (`/proc`, `docker stats --no-stream`) rather than standing up a full Prometheus/node_exporter/Grafana stack, writing into one new table (`capacity_metrics_snapshots`) the admin dashboard reads directly. This matches every other infrastructure choice already made in this project (no Kubernetes, no separate job queue, Docker Compose over a fleet-scale orchestrator) — a real metrics stack is explicitly noted as something to revisit only once there's an actual fleet to justify it, not to build preemptively for one VPS. Warning thresholds reuse the existing `app_config` table rather than a new config mechanism, the same "don't build a parallel system" discipline `M5-014`'s quota override already follows for `usage_counters`.

### 5. The pre-deployment security deep-dive is noted, not scheduled — per the founder's own instruction

Section 5 of the addendum is explicit that this is "not needed as part of this addendum's scope right now." I added one `CLAUDE.md` bullet flagging that it's expected and distinct from `M7-001` (which only verifies the _already-documented_ threat model, not a fresh deep-dive) so a future session doesn't either forget it or wrongly treat `M7-001` as already covering it. No task ID, ADR, or milestone slot was created for it — that would be scheduling something the founder explicitly said not to schedule yet.

---

## What was built

Governance/docs work only — no application code touched.

- **`docs/SRS.md`**: `FR-ADMIN-16` added (capacity/scaling dashboard: active users, scans/day-week, DB size/growth, VPS CPU/RAM/disk, configurable warning thresholds). `NFR-SCALE-02` extended with the concrete load-test methodology and target (1k/5k/10k/20k concurrent users, server-touching surfaces only, real measured findings in a new ADR).
- **`docs/ARCHITECTURE.md`**: §6 gains `capacity_metrics_snapshots` (new table) and a new `app_config`-seeded-threshold comment; §12 gains a paragraph on the lightweight (non-Prometheus) metrics-collection approach; §15's resolution log gains item 12 recording both decisions (capacity-dashboard placement in M5, load-test concretization) in one entry, matching item 11's style.
- **`docs/TASKS.md`**: `M5-016` added (capacity/scaling monitoring dashboard); `M7-006` rewritten in place with the addendum's specifics and a new ADR deliverable; a standalone note added after the M7 table stating `M7-006` doesn't need to wait for the rest of M7, mirroring the existing `M1-011` pattern.
- **`CLAUDE.md`**: decisions-log bullet for M1 trimmed to drop the now-stale "M2 authorized" clause (M2 is done now, its own bullet covers it); new bullet recording M2's completion and M3's authorization (naming the real pdfjs-dist compatibility bug M2-009 caught via real-browser verification, since the founder called that discipline out explicitly); two new bullets for the capacity-dashboard/load-test additions; one new bullet flagging the future pre-deployment security deep-dive as expected-but-not-yet-scheduled.

## Key decisions

Covered in full in the Flags section above (M-Ops-vs-M5 placement, concretizing `M7-006` in place rather than duplicating it, un-gating it from the rest of M7, the metrics data-flow design, and not scheduling the future security review) — not repeated here.

## Deviations from the addendum's original description

- The addendum names "M-Ops" as one placement option for the capacity dashboard; no such milestone exists, so it went into M5 instead — see Flag 1.
- The addendum's load-test request is phrased as if proposing new work; it was applied as a rewrite of the existing `M7-006` rather than a new task ID, to avoid two overlapping load-test tasks — see Flag 2.

## How this was tested

Docs-only change — no test suite applies to the content itself. `npm run ci` (format-check, lint, typecheck, test) run before pushing per the standing rule. Cross-references between the new/changed IDs (`FR-ADMIN-16`, the extended `NFR-SCALE-02`, `M5-016`, the rewritten `M7-006`, `ARCHITECTURE.md` §15 item 12) were checked by hand for consistency across all four touched files (`SRS.md`, `ARCHITECTURE.md`, `TASKS.md`, `CLAUDE.md`) as they were written.

## Current status

Done. Per the founder's explicit "go," M3 (Accounts, Auth & Drive Sync) starts next, in a separate task/report. The Section 4 status report (full milestone list + honest remaining-work estimate) the founder also requested is delivered directly in this session's chat reply, not as a separate `docs/reports/` file, since it's a point-in-time status communication for the founder to read now rather than a completed-task record.
