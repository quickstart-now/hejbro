# Proposal: add-config-driver (#458)

## Why

Every CLI command that opens a database connection — `check`, `status`,
`migrate`, `raise`, `reset`, `import`, `pull` — procures its driver the
same way: it imports `@hejbro/pg` dynamically and builds the vanilla
driver from `--url` or `DATABASE_URL`. That was the one pre-built asset
that avoided a hard runtime dependency, and it is wrong for every
project whose runtime driver is not the vanilla one. A Supabase project
whose application runs through `supabaseDriver(pgDriver(url), { endpoint:
"transaction-pooler" })` has `hejbro check` and `hejbro migrate` connect
through vanilla `@hejbro/pg` instead — silently bypassing the decorator
that pins the session and declares the pooler's real capabilities. The
driver contract exists so that any conforming driver can execute; the
CLI is the one caller that cannot be handed one.

## What Changes

- **`hejbro.config.ts` can name a driver factory.** A new optional
  `driver` field holds a function from a connection string to a
  contract driver (synchronously or as a promise). The configuration
  loader validates its shape like every other field and names it in
  the shape hint. Connection credentials stay where they are: the
  factory receives the string `--url`/`DATABASE_URL` resolved, and the
  configuration file still never carries one.
- **Every connecting command prefers the configured factory.** When
  `driver` is set, the command calls it with the resolved connection
  string and uses what it returns; `@hejbro/pg` is neither imported nor
  required. When it is absent, the dynamic import and its
  `*-driver-missing` diagnostic behave exactly as today. Capability
  checks are unchanged: an apply command still refuses a driver without
  interactive transactions, whatever built it.
- **The CLI can close what it was handed.** The command closes the
  driver after its work as it closes the vanilla one; a configured
  factory whose driver exposes no way to close is refused at the moment
  it is used, with a coded error naming the field — a process kept
  alive by an open pool is a hang, not a driver.
- The preset references show `driver` pointing at the decorated
  driver; one `minor` changeset.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`cli-commands`** — MODIFIED requirement: *Declarations can be
  checked against a live database* (the driver paragraph: configured
  factory first, `@hejbro/pg` otherwise). ADDED requirement: *A
  configured driver factory serves every command that connects*.

## Impact

- `hejbro` (CLI): `config.ts` (field, schema, hint), `check/driver.ts`
  (procurement), the seven commands' call sites threading the
  configured factory through, their in-process tests, one subprocess
  end-to-end test.
- `skills/hejbro`: the Supabase, Neon and Nile preset references.
