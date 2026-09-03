Refs:
- openspec/changes/add-query-layer/tasks.md @ blob 0f75edca54b8eeceb93678ba14019f38cec0b185
- packages/query/src/index.ts @ blob 2d8bd5b68616cb4c8512c43c8d69aa3aa6b239b0
- packages/query/package.json @ blob f52474656f0e98dd733a553a83d88f1d09937580

# Groups 5/6 re-plan and [design] pre-settlement round (add-query-layer, #293)

## Owner inputs (English rewrites, in order)

1. Session opener: "What should I do next — is it g5 and g6's turn?"
2. On go-ahead: "Yes. For the record: the reason brainstorming happens
   *after* the OpenSpec proposal is for **elaboration, not drift**. If a
   fundamental problem exists, drift is possible — but I wanted you to
   know the intent."
3. D1 (pg factory): chose **instance-based with nominal `pg` typing**
   (the Drizzle-parallel option), over the assistant's recommended
   structural typing.
4. D2 (row representation): first replied "How does Drizzle handle
   this?"; after the assistant verified Drizzle's node-postgres session
   source (per-query `types.getTypeParser` overrides, identity for
   TIMESTAMP/TIMESTAMPTZ/DATE/INTERVAL plus array oids, delegation for
   the rest), accepted the recommended per-query override, scoped to
   interval only.
5. D3 (Supabase driver composition): "How does Drizzle do it? The
   difference between us seems large. Show (1) the Drizzle comparison
   and (2) the user UX of each option." After the comparison (Drizzle
   has no Supabase driver at all; its supabase module ships only
   role/table/helper constants, and its docs tell users to hand-write
   an RLS wrapper that splices JWT claims into SQL via `sql.raw`):
   "Let's go with option 1, the decorator. But looking at
   orm.drizzle.team/docs/connect-supabase, our syntax is more complex
   than theirs."
6. D4 (the complexity remark, turned into a decision): approved adding
   the `pgDriver(connectionString)` convenience overload to group 5.
7. D5 (asUser surface) — an extended exchange:
   - "Shouldn't it be both? Something like Supabase takes just the JWT
     and verifies it itself, while other setups decode sub/claims in
     the app and pass them."
   - "Why would I pass a secret? If I just hand over the JWT, the
     Supabase service verifies it on its own."
   - "I don't see why the secret is needed — isn't JWKS-based
     decoding the Supabase default? Hasn't HS256 gone away?"
   - "How does Drizzle do it?" (for this exact question)
   - "What if the user is on a custom JWKS — Supabase for the DB but
     Clerk or Auth0 for auth?"
   - "With Supabase third-party auth enabled, can't we just set
     `accessToken: async () => Clerk session token` in `createClient`
     like their example? Research it further."
   - "Show me the DX/UX a user gets under each option."
   - "No — I'm asking why *we* should verify at all. With Supabase or
     Clerk, their own verify functions run in middleware/providers and
     hand you verified claims (`getClaims`, `sessionClaims`). Why
     would an ORM carry verification? Just delegate to them."
   - "What exactly is the 'callback form'?"
   - Settled: **A — claims object only**, verification delegated to
     the app's auth layer, the claims-provider callback automation
     parked.
8. D6 (operations batch): approved as presented (prerequisite re-plan
   PR, `test:integration` convention, spec-delta file split, group 6
   changeset, parking issues, lockfile handling by the lead).
9. Mid-turn, separate thread: agent model names must be bare family
   names only (`opus`/`fable`/`sonnet`), never version-suffixed — and
   when the assistant saved that to session memory: "Not memory — put
   it into the skill." (Landed in the team-up skill's own blackbox.)
10. Mid-turn: "Where did the operations-batch queue go?" — calling out
    that the decision-queue ledger line had stopped appearing.

## What was built

- `tasks.md` groups 5 and 6 rewritten from 3 tasks each to 7 + 6,
  every former [design] item resolved in the group headers, red tests
  and file lists per task (D88).
- `packages/query` gained a provisional entry surface: `src/index.ts`
  barrel + source-pointing `exports` in `package.json` — discovered as
  a hard prerequisite (the package had no entry point at all, so
  neither driver package could resolve `@hejbro/query`). Task 7.1
  replaces this surface; the barrel deliberately excludes the four
  test-only conversion exports and `sql`.
- Parking issues #317 (transaction-mode pooler capability story) and
  #318 (claims-provider callback automation) filed under #282.

## Decision rationale

- **D1 nominal typing**: owner preference for the Drizzle-parallel
  surface and familiar DX; costs accepted knowingly (peer `pg`,
  `@types/pg` in the public surface, heavier unit-test fakes).
- **D2 per-query override**: verified against Drizzle's actual source
  as the production-proven mechanism; global parser mutation rejected
  as silently rewriting the user's own queries; driver-side conversion
  rejected for splitting the conversion path and truncating
  microseconds (postgres-interval carries milliseconds).
- **D3 decorator**: zero duplication, no wrapper-drift class, keeps
  g5/g6 truly parallel (group 6 depends only on the contract type),
  and the same shape reuses for Nile (also wire-standard Postgres).
  The Drizzle comparison showed the same division of labor —
  transport generic, preset contribution as data — with hejbro
  productizing the RLS wrapper Drizzle leaves as a user exercise.
- **D4 overload**: closes the visible verbosity gap with
  `drizzle(url)`; lifecycle follows Drizzle (expose, never
  auto-close).
- **D5 claims object**: the decisive chain was factual. The owner's
  "the service verifies it" intuition is true only on the PostgREST
  path; the TCP driver sits in PostgREST's seat and Postgres itself
  never verifies claims. The owner then falsified the assistant's
  HS256-secret proposal (signing-keys docs: legacy, "no longer
  recommended"), and the Clerk/Auth0 scenario showed a token-accepting
  surface either breaks on non-Supabase issuers or forces hejbro to
  re-own per-issuer JWKS policy. The owner's final formulation —
  verification belongs to the auth layer that already does it; the ORM
  receives its verified output — is exactly the claims-object surface,
  so the settlement records the owner's own reasoning, not a
  concession to the assistant's.
- **D6**: operational batching allowed by the brainstorming skill's
  exception for decisions that cannot constrain other open questions.

## Internal processing

- Evidence fetches: Drizzle node-postgres `session.ts` (per-query type
  parser overrides), Drizzle RLS docs twice (no Supabase driver; user
  hand-rolls the context wrapper with `sql.raw`; `createDrizzle`
  receives a decoded claims object obtained via `getSession` +
  `decode`, unverified), Supabase signing-keys doc (HS256 legacy
  status, JWKS endpoint), third-party-auth overview and Clerk pages
  (`accessToken` callback attaches, platform verifies, Data-API-only
  scope, `role: authenticated` claim requirement).
- One recommendation reversal, recorded as such: the assistant
  recommended claims-only, then (on the owner's "both" push) a
  verified-token path with an HS256 secret, then returned to
  claims-only after the owner falsified the HS256 premise and the
  third-party scenario landed. Each swing followed new evidence the
  owner's questions forced; the final state matches the first
  recommendation but for corrected reasons.
- Process fault, owner-caught (input 10): the M2 ledger line
  ("확정 n/N · 지금 · 남은 큐") was dropped mid-round while handling the
  interleaved model-naming instruction; restored on the spot. The
  earlier interval-parser claim about `String(PostgresInterval)`
  breaking `parseInterval` was asserted from API knowledge, not
  executed code — group 5's scout task 5.0 pins it against the
  installed `pg` before any implementation trusts it.
- Prerequisite discovery: `packages/query` had no `exports`, no build,
  no `src/index.ts` — found by reading the package manifest before
  planning, not by a failed resolution at implementation time.
