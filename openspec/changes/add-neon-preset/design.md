# Design: add-neon-preset

## Context

`@hejbro/neon` is the first package in this repository that is both a
provider preset and a real driver. `@hejbro/supabase` has no runtime
dependency on any `@supabase/*` package — `supabaseDriver` decorates an
existing driver with `contributedRoles` and declares no capabilities of
its own — so the preset template covers everything except the part that
touches a wire. `packages/pg` covers that part but is not a preset.
This change composes the two, and the composition is what needs
recording: which decisions come from `packages/pg`, which from
`packages/supabase`, and which from Neon itself.

Two facts about the target platform drive the rest. Neon's client library
offers two connection paths with genuinely different capabilities, and
Neon's RLS story runs through the `pg_session_jwt` extension, which has
two authentication modes that read different settings and are mutually
exclusive. Both modes turned out to be expressible through the existing
context mechanism — the extension's settings are ordinary `Userset`
GUCs — so the question this document answers is not which mode to
support, but how to keep a codebase from using the wrong one.

## Goals / Non-Goals

**Goals:**

- Ship a preset whose driver declares the truth about both Neon
  connection paths, so the query layer's missing-capability error fires
  where it should and nowhere else.
- Prove the provider interface admits a second provider: no file under
  `packages/core`, `packages/query`, `packages/cli`, `packages/pg`, or
  `packages/supabase` is edited.
- Keep every surface traceable to something Neon dictates.

**Non-Goals:**

- Feature parity with `@hejbro/supabase`. Parity for its own sake is
  surface without justification.
- Checking that a declared authentication mode matches the database's
  actual configuration. That would mean reading database state, which is
  the probe this design refuses everywhere else.
- A live HTTP round trip in committed tests. Neon publishes no official
  HTTP proxy image.

## Decisions

### One driver, overloaded on the client — not two exported drivers

`pgDriver` already establishes the pattern: one name, and the argument's
shape decides the rest. Two exported names would ask the user to repeat a
choice they already made when they constructed a `Pool` or called
`neon()`. Both forms fix the capability set at construction, which is
what the contract requires; the overload additionally keeps the surface
symmetric with the vanilla driver, and that symmetry is justified because
the two packages do the same job.

A third option — one driver that probes the connection to learn its
capabilities — is rejected on the record. D95 names runtime feature
probing as a rejected alternative, and `driver-contract` requires the
query layer to consult declarations "instead of probing behavior at
runtime". A probe also cannot satisfy the contract's requirement that
capabilities be readable before any connection is made.

### The HTTP driver pins its session settings inside each execution

`session-state: false` is a true statement about persistence and an
insufficient one about correctness. `@hejbro/query`'s value conversion
depends on the pins `setupSession` applies once per connection
(`IntervalStyle`, `bytea_output`); over a path with no session, those
pins never take effect and values arrive shaped by server defaults.
Nothing catches this: the capability is declared truthfully, and no code
in the repository reads that capability. The declaration is documentation
that changes no behavior.

The driver therefore sends each execution as one batch — pins, then the
caller's statement — using the client's own non-interactive batch form.
This is not a capability being faked. The driver never claims state
persists; it claims only that its own statements run under its own pins,
which it can deliver. The alternative shapes were weighed and rejected:
teaching `@hejbro/query` to enforce `session-state` is the right fix for
a different problem (#481) and lands in a package this change must not
touch; declaring `session-state: true` would be the exact lie D95 names.

### The authentication mode is stated once, at construction

`pg_session_jwt` exposes `auth.uid()` and `auth.jwt()` and sources
identity from one of two settings: `request.jwt.claims` when no JWK is
configured, or `pg_session_jwt.jwt` — a raw token it verifies itself —
when one is. Both are ordinary `Userset` GUCs, so both modes are
expressible through the existing `{role, settings}` context; only the key
differs. The extension's own `auth.jwt_session_init(jwt)` helper is not
needed for the second mode: it is a thin wrapper that runs a
session-scoped `SET`, which is strictly weaker than the transaction-local
`set_config` the mechanism already emits.

Both modes therefore ship. Shipping only one would have been a bet on
which mode a user's database runs, and losing that bet is silent: in the
verifying mode the claims setting is ignored outright, so a claims-only
surface would set a GUC nothing reads.

The mode is taken **once**, when the auth surface is constructed, and the
surface exposes only that mode's builders. This is the driver's overload
decision applied a second time — a fact about the environment fixed as
data at construction, never discovered by a probe — and it is what keeps
one codebase from mixing two modes that no single database has.

## Risks / Trade-offs

### The batch-pin approach, measured, and the fallback that stays open

The risks were that the client's batch form might not accept `SET`
statements as members, might not return results the driver can read the
caller's statement out of, might cost more than one request, or might let
the pins leak into the next call. All four were probed before this
document was written. What was found:

- `SET` statements are accepted as batch members and return empty result
  sets. Batch members are built with the client's own
  `sql.query(text, params)` form, which maps one-to-one onto a compiled
  statement's SQL text and parameters.
- Results come back as an array, one entry per member, so the driver
  reads the last entry — exactly the single result set the driver
  contract requires.
- The batch is **one HTTP request**, confirmed by counting requests at
  the proxy: a three-statement batch produced one. Adding two pins to
  every execution therefore costs body size, not round trips.
- The batch runs as one implicit transaction (a failing member rolls the
  others back), and the pins **do not leak**: a non-default
  `bytea_output` set inside a batch reads back at its default on the next
  request. This is what makes `session-state: false` both honest and
  harmless.

**The one real cost**: a batch error carries no member index. If a pin
statement failed, the error a user sees would be indistinguishable from
their own statement failing. The pins are two constant `SET` statements
that `@hejbro/pg` already sends at every checkout, so the failure is
close to unreachable — but "close to" is why it is written down here and
carried into the skill's Neon reference, where a user who meets a
confusing error can read what it might be. Defending against it in code
would mean a retry that has no information the first attempt lacked.

**What the committed tests can and cannot hold.** The committed test
fixes the batch's *composition and order* — both pins, then the caller's
statement, and the last result read back — against a stub transport.
That is inside the verification boundary and is what a later refactor
would silently break. It cannot hold *arrival shape*, which needs a real
server and the community HTTP proxy this change refuses to depend on.

**The fallback's trigger is therefore a one-time manual measurement, and
it is recorded here.** Before the rest of group 2 is written, an
`interval` and a `bytea` are read back over the HTTP path and compared
to the same values over `@hejbro/pg`. If they differ, the HTTP driver is
dropped from this change, the WebSocket path ships alone, and HTTP is
reopened with #483 — no further approval round. Until the result is
written into this paragraph, group 2 is not finished: an unrecorded
measurement is indistinguishable from one that was never run.

> **Measurement result:** _(to be filled by the task that runs it —
> record the client version, the proxy image reference, and both
> values.)_

**Reproduction** (design probe, never committed infrastructure). Three
traps are recorded because each one costs an hour to rediscover and none
of them is in the vendor documentation:

```bash
docker network create ne
docker run -d --name ne-pg --network ne --network-alias ne-pg \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=main postgres:17
until docker exec ne-pg pg_isready -U postgres; do sleep 1; done   # trap 3

# WebSocket path, Neon's official image:
docker run -d --name ne-wsproxy --network ne \
  -e ALLOW_ADDR_REGEX='.*' -p 5433:80 ghcr.io/neondatabase/wsproxy:latest

# HTTP path, community image (probe only, never a committed dependency):
docker run -d --name ne-http --network ne \
  -e PG_CONNECTION_STRING='postgres://postgres:postgres@ne-pg:5432/main' \
  -p 4444:4444 ghcr.io/timowilhelm/local-neon-http-proxy:main
```

1. **The proxy's route is `/v1`, not `/v2`.** The client's default
   `wsProxy` appends `/v2`; the open-source proxy registers `/v1`. The
   default, and every community example that copies it, fails with a
   WebSocket 404. Set
   `wsProxy = (host, port) => \`localhost:5433/v1?address=${host}:${port}\``.
2. **`APPEND_PORT` is concatenated, not substituted.** The client already
   sends `address=host:port`, so setting `APPEND_PORT` — as community
   examples do — produces `ne-pg:5432ne-pg:5432`. Leave it unset.
3. **The HTTP proxy must start after Postgres accepts connections.**
   Started together, its mock control plane fails to bootstrap and every
   query afterwards dies with `HTTP 500 "Control plane request failed"`,
   an error that names nothing useful on the client side. `docker
   restart` on the proxy clears it; the `pg_isready` wait above prevents
   it.

### The verification boundary is asymmetric, and the specs say so

The WebSocket path gets a local witness against Neon's official proxy
image. The HTTP path gets pure tests over its capability declarations and
error paths, and no live round trip. Stating that boundary is part of the
deliverable: a checker that stays quiet about its blind spots is read as
a guarantee it never made.

### Fixing the mode at construction moves the risk; it does not remove it

Stated plainly, because the opposite reading would be an overclaim:
taking the mode once makes it impossible to **mix** the two modes in one
codebase, and impossible to call a builder the declared mode cannot use.
It does **not** make it impossible to declare the mode the database does
not actually run. That declaration is a claim about the environment, and
nothing in the type layer or at run time checks it — checking it would
mean reading database state, which is the probe this design refuses
everywhere else.

So the residual risk is precisely the one this repository has already
named once: a declaration that is honest, and that nothing verifies
(#481, on the driver side). Its shape here is a silent fail-closed. Under
a wrong mode the identity function returns NULL, and policies that
require an identity deny — safe, but with no error to read. A policy that
tolerates a NULL identity would instead admit under an empty identity,
which is the dangerous end of the same fault, and belongs to how the
user's policies are written rather than to what this surface can prevent.

What the design owes in exchange is a path from symptom to cause, in
documentation rather than in code: when every row disappears under a
context, the first thing to compare is the declared mode against whether
the database has a JWK configured. That line belongs in the skill's Neon
reference, next to the two builders, not buried in a spec.

### Two facts remain unconfirmed and are visible in the output

Whether Neon's Data API runs `pg_session_jwt` in claims mode or JWK mode,
and whether `neondb_owner` may `SET LOCAL ROLE authenticated` on a real
Neon instance, can only be settled against a live Neon account. Neither
blocks this change — the mechanism is proven locally — but both are
stated as unverified in the specs and the user-facing skill rather than
implied to be covered. A local witness proves the mechanism; it cannot
prove the platform's grants.
