# ADR-0006: Paddle (global MoR) + Bank Alfalah (Pakistan PKR) behind one provider-adapter interface, not Stripe/PayPal

**Status:** Accepted

## Context

Billing needs to work globally with proper tax/VAT handling, and separately needs to support PKR payments in Pakistan specifically, without integrating Stripe or PayPal (explicit exclusion) and while leaving room to add Easypaisa/JazzCash later without a redesign.

## Decision

- **Paddle** as Merchant of Record for all billing outside Pakistan — Paddle handles tax/VAT calculation, remittance, and localized currency presentment, which removes a large chunk of international tax-compliance work we'd otherwise have to own directly.
- **Bank Alfalah's gateway** for PKR-denominated billing inside Pakistan specifically.
- Both sit behind a single `PaymentProviderAdapter` interface (`docs/ARCHITECTURE.md` §10) so the rest of the app — plan checks, feature flags, admin panel — never needs to know which provider a given subscription is on.

## Alternatives considered

- **Stripe or PayPal.** Explicitly excluded by the founder. Worth noting for the record: Stripe as MoR (Stripe Tax + Stripe Billing) is a plausible alternative to Paddle in general SaaS architecture, and Stripe's Pakistan support is limited/inconsistent, which is part of why a Pakistan-specific gateway is needed regardless of the global choice — so the Bank Alfalah integration would likely be necessary even under a different global provider.
- **Paddle alone, everywhere, including Pakistan.** Rejected per explicit founder instruction (Bank Alfalah required for PKR) — likely reflects Paddle's Pakistan payment-method coverage/settlement not being as strong as a local Pakistani bank gateway for local cards/bank transfers.
- **One unified custom billing engine instead of an adapter interface.** Rejected — Paddle and Bank Alfalah have genuinely different integration shapes (Paddle: hosted checkout + rich subscription webhooks; Bank Alfalah: more bank-gateway-style redirect + callback). Forcing one code path for both would either leak provider-specific quirks into shared code or require the adapter abstraction anyway — better to build the abstraction boundary explicitly from the start.

## Consequences

- Two webhook/callback integrations to build, verify (signatures, NFR-SEC-11), and keep idempotent (`payment_events` table keyed by provider event ID) — genuinely more integration surface than a single provider, accepted as the cost of correct Pakistan support.
- Country-tier pricing logic must treat "is this a Pakistan-billed account" as effectively its own tier/provider combination distinct from Paddle's country-tier mapping (`docs/ARCHITECTURE.md` §6, `pricing_tiers` + `country_tier_map`).
- Adding Easypaisa/JazzCash later (FR-BILLING-05) is "implement a third adapter," which is exactly what this ADR is optimizing for — the interface has two real implementations behind it already, which is the actual proof this will work, not just an assertion.
- Refunds in the admin panel (FR-ADMIN-03) must route through the correct adapter based on the subscription's provider — a place a naive implementation could easily get wrong by assuming a single global provider.
