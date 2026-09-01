# Proposal: add-polyrepo-sync

This revises the change rather than replacing it: the intent — a
consuming repository gets the schema's types — is unchanged, and the
mechanism is replaced.

Five settled directions govern this revision. One of them is not about
polyrepo at all and stands above the rest: **hejbro manages a database's
schema and access from declarations; it is not a tool that reaches into
live infrastructure and works from what it finds there.** The others
follow that line — the polyrepo channel becomes git rather than a
database; **D12 is revised in full**, so applying migrations is
first-class including production; **verifying that a database has the
declared shape is not built**; and reading an existing database is kept
as a **fallback**, not as a second channel — the same generator, fed by
inference instead of by declarations.

The identity judgement explains why the others are consistent rather
than merely simultaneous. Applying is writing in the declared
direction, and a ledger of what this tool itself applied is a record
of its own writes — neither is introspection. Verifying a database's
shape reads the infrastructure to decide what is true, and is out.
Reading a database to *start* — or to serve a consumer whose schema
repository does not use this tool yet — does the same, which is why
it is a marked fallback with a stated loss rather than a peer of the
git channel.

## Why the mechanism changes

The approved version carried the schema **out of the database**. The
settled design carries it **out of the repository**: the schema
repository commits an export directory, and a consumer vendors it over
git.

The reason is not that the first mechanism failed — it worked, and its
parts are measured and tested. It is that a database is not a file. It
cannot be read, diffed, or reviewed by the agent doing the work, and an
agent sandbox without a database could not obtain types at all. The
three principles the owner settled on are all file-shaped: **every
truth is a committed file**, **every check is a single command with an
exit code**, **every error message names the next command**.

### Why the database is not the truth here, even though it is a database

A tool that owns applying makes the database the *output* of the
declarations on every normal path. Carrying a hotfix from the
database to consumers is therefore not fidelity to the truth; it is
the quiet propagation of drift. The consumer's contract would follow
the hotfixed database, the schema repository would not know, and the
next apply would either revert the hotfix or fail — with no warning
to anyone in between.

Drift is a detection problem rather than a channel problem. One half
of the detection is settled here: the contract carries the point it
was generated from, which costs nothing and makes the comparison
possible. The other half — a consumer actually performing that
comparison against a database — is an open gate below, because it
touches the ruling that a database's shape is not verified.

## What the owner settled

- `hejbro link <repo>` records the source **repository only**. `vendor`
  resolves the remote's symbolic HEAD, writes the IR and the contract
  into the repository, and records `hejbro.lock` (`commit`,
  `resolvedFrom`); `--ref` overrides one run and does not stick. Branch
  is intent, commit is truth.
- What crosses is an **IR**, not declarations and not another
  language's finished mirror: a Go repository would otherwise need Node
  to read a schema, and a schema repository would otherwise have to
  know every consumer's language.
- The emitted mirror is **flat** — `Row`/`Insert`/`Update` per table in
  the shape Supabase's `Database` type already uses — plus runtime
  metadata and a `createDb(conn)` factory. The generic binding is done
  inside the generated module; no type parameter reaches the user.
- **No watch mode**, which was already permanently out of scope. The
  cost is a promise that `generate` stays fast enough that explicit
  invocation is not felt.
- **Applying is first-class** (D12 revised): `migrate`, `reset` in the
  schema repository, `db up` in the consumer.

## Two arguments corrected in the conversation, and corrected here

Both corrections came from the owner. The reasoning that survives is
the one this proposal cites.

1. **Not "emit because many languages."** The owner objected that a
   project rarely mixes languages, and the argument was withdrawn and
   replaced: a tool used by agents should teach **one pattern**, so
   prior knowledge accumulates instead of splitting per codebase. The
   multi-language case describes a *product* spanning single-language
   repositories, not a mixed build.
2. **Not "static types."** The claim was restated as: what matters is
   that the artifact is **committed**. A static type that lives only in
   a build cache is as invisible as an inferred one. This is the axis
   on which this change collides with an existing requirement, below.

## What the settled design does to this change's own premises

Three premises die, and each takes work with it. Stating this plainly
is the point of the revision — the alternative is carrying code whose
reason has quietly left.

**The sidecar's problem stops existing.** The manifest row carried six
declaration-time facts — numeric mode, array element nullability,
TypeScript keys, export names for tables and functions, role names —
because *a consumer read the schema out of a database, and a database
cannot be asked for them*. The export is produced by reading the
declarations, so those facts are in hand before anything is carried.

**The size argument inverts.** This change measured the embedded
payload at ≈44× the smallest migration it appears in and accepted that
cost, because the payload was the consumer's only channel. With the
consumer served by git, the same measurement argues the other way: a
cost paid for a reader that no longer reads.

**Runtime verification is not built.** The owner's third judgement
removes the last independent reason for a manifest row: comparing a
running database against a stamp. What may survive is not a check but a
**ledger** — the record an apply engine reads to know what to run next.
That is a question for the apply engine, not for this change, and it
appears below as a dependency rather than as a requirement here.

The already-shipped `check` catalog comparison is untouched: it is a
separate change and this one adds nothing on top of it.

## What survives, measured

Research read each artifact rather than reasoning about it. The
plumbing changes; the knowledge of *what must be carried* survives
almost entirely.

- **The payload builder is the IR's body.** The document assembled
  today is `{tables, functions, roles}` plus the snapshot, serialized
  by the one stable serializer. The IR is not a new format to invent:
  the snapshot is its subset, and the sidecar is the remainder. A
  consumer-facing projection was measured at −61.7%, most of the saving
  being policy bodies and table checks.
- **`snapshot.sql` already exists and is thrown away.** Startup
  assertion code already calls generation against an empty snapshot and
  keeps only `.snapshot`, discarding the `.sql` that is exactly the
  squashed schema a consumer would need. Baseline's "must be first"
  rule lives in the CLI, not in the engine, so nothing blocks the call.
- **Git is already a seam.** One file owns every git subprocess in the
  CLI, `execFileSync` only, no dependency, with UTC forced for
  determinism. Its thirteen functions are all local; the remote ones
  are new, and the precedent for adding them is established.
- **The overwrite guard, the loader's export names, and the optional
  config fields** all survive as they are. The consumer repository has
  no migrations directory and no snapshot path, which is precisely the
  case the optional-field work was built for.
- **The refusal that a vendored mirror cannot author migrations** keeps
  its wording exactly — it already says *the repository that owns its
  schema*. Whether the brand still has something to protect depends on
  whether a `Table` value reaches the consumer at all, which the
  emitted shape decides.

What ends: the manifest's SQL rendering and its quoting guard, the
chain-monotonicity gate (whose failure mode — a stale newest row read
as fresh — cannot occur when the truth is a committed file), the
database connection path in the consumer, and most of the module
emitter, whose output shape is replaced.

## How git is spoken to, measured

Four approaches were tried against a real remote. Symbolic-HEAD
resolution returns the default branch and its commit in one call, using
credentials already on the machine. `git archive --remote` is refused
by GitHub outright. A cone-mode sparse checkout brings root files along
with the directory asked for. A blobless partial clone reading files by
`show <sha>:<path>` is the cheapest and the most precise, and an
arbitrary reachable commit can be fetched directly — which is what
makes a lock file the build's truth in CI.

A constraint the owner set on this change's earlier round carries into
the new emitter unchanged: parsing a snapshot node's object keys stays
out of the pure core, which is why the reader restates an internal shape
rather than importing it. The emitted mirror is produced where the
files are, not in core.

## The requirement this change reverses

The existing requirement says query typing works purely at the type
level and the toolchain generates no on-disk type artifacts for
queries. This change's own delta did **not** weaken that sentence: it
left it untouched and argued that a synced module is not such an
artifact, because *it declares runtime values and query types are
inferred from those values*.

The settled design emits flat interfaces. That justification stops
being true — an emitted `interface` is a type declaration, not a value
— and so does the accompanying scenario, which promises that no type
artifact accompanies the module. The requirement is therefore removed
and replaced, not modified, and the decision-log entry behind it is
amended rather than clarified.

The honest reading of the collision: the prohibition protected users
from a codegen step they had no way to keep current. The new shape
supplies exactly that missing piece — a check whose failure names the
command that fixes it — but it does not make the old sentence partly
true.

## Structure: this change, and the apply engine beside it

**Recommendation: the apply engine is a separate change, sequenced
first, and this one depends on it.**

The reason is ownership, not size. If the apply engine's ledger lives
here, this change owns a contract whose reason belongs elsewhere — the
exact failure this revision is correcting, where a sidecar outlived the
channel that justified it. Kept apart, each change stands on its own
and this one's delta only has to say that a consumer can raise a
database from a pinned snapshot.

The dependency is explicit: the consumer loop (`db up`) and the
two-repository witness cannot close without apply, so those groups
sequence after it, exactly as this change already handed a
requirement's second half from one group to another.

Both observations that would have overturned this were checked, and
both fail.

**Nothing records what has been applied today.** The search for such a
device returns three things: baseline's report telling the user to
register the file *in your apply tool*, the specification saying the
same, and a timestamp column on the manifest row. The first two hand
the job to something outside hejbro. So an apply engine is not an
extension of an existing asset; it is a new contract, and adoption of
an already-migrated database — today handled entirely outside the tool
— comes with it.

**And the row's requirements are not settled by anything here.** The
existing row satisfies a ledger's easy half: the database assigns the
order, the history is append-only, and — newly measured — the row's
snapshot hash is **byte-identical to the `-- snapshot:` line in the
migration that wrote it**, so the join between ledger and files already
exists and needs no new plumbing. What it cannot do is represent a
failure: the insert is the file's last statement, so a migration that
dies midway leaves no row, and a partial application is
indistinguishable from one that never started. There is no column for
a state, and baseline writes no row at all, which leaves an adopted
database's first entry unaccounted for.

Two further measurements make the same point, and both belong to that
change rather than this one.

**The row's form already matches the identity ruling, for a reason that
also limits it.** The row is written by an INSERT inside the migration
file, from values computed before anything ran: nothing reads a
catalog, nothing is inferred from the database's state. That is
self-recording, not introspection. But the recorder is the migration
itself, so the record lives inside the thing that can fail — a failure
is therefore unrecordable in principle, and "no row" means *not yet
applied*, *failed midway*, and *applied from a migration generated
without a manifest* all at once. Keeping that property or moving the
write into the apply engine, which could record a start and a failure,
is that change's first fork.

**And one transaction per migration cannot be an unconditional rule.**
Adding a value to an enum type is constrained inside a transaction
block: the new value cannot be used until the transaction commits. The
kind ordering puts enum statements before table statements in the same
diff and the same stage, and the declaration surface can put a new
value into a default or a check constraint, so a single migration that
adds a value and uses it is expressible. Partial-failure semantics is
therefore not an optional refinement of the apply engine — it is
forced.

Those are the apply engine's questions, not this change's. Deciding
them here would put a ledger's contract inside a change about how a
consumer obtains types — which is the error this revision exists to
correct.

**One correction belongs to me.** I ruled during the previous round
that the manifest must never be read with a full-table fetch, because
an append-only history has no row-count ceiling. Against a ledger that
ruling is only half right: reading *many rows* is exactly what gap
detection needs, and the ceiling is the number of migrations the
repository has on disk, not the history's length. What stays right is
the reason underneath it — the expensive part is the payload column at
roughly 18 kB a row, not the row count, and the existing queries name
their columns explicitly, so a narrow projection is a one-line change.
The sentence as I wrote it reads as the broader prohibition and is
corrected here rather than quietly relaxed later.

## The fork everything else hangs on

Research reduced the question *what survives* to a single choice, and
it is a choice the owner has to make because it decides how much of the
built work exists at all.

**Does the consumer's query layer eat the emitted flat types and a
metadata constant, or does it keep eating table values?**

Today's query layer is built on table values: dozens of sites in the
query package match on a table's column type parameter, and the write
optionality a consumer sees — a defaulted column optional on insert, a
computed one absent, an identity column that yields to a supplied value
optional rather than absent — is derived from those values' metadata by
existing logic, with nothing extra to write.

If the mirror emits flat `Row`/`Insert`/`Update` interfaces, that
optionality is decided when the file is written, as a `?` on a field.
The consumer then holds no column builders at all, and everything that
exists to re-tag them loses its reader: the three write-fact helpers,
the usage-table constructor, the usage side of the authority brand, and
the origin carrier that rides on it. That is most of two completed
groups.

If instead the mirror keeps table values beside the flat types, those
assets stay exactly as they are, and the flat types are a second view
onto the same thing.

**This is settled: the consumer gets a metadata-based contract.** One
file holds a `Database` interface in the shape users already know —
tables, views, functions, enums — a metadata constant beside it, and a
`createDb(conn)` factory. Table values do not cross.

The reasoning, since the alternative was defensible. Keeping table
values would have preserved the built assets and let the flat types
ride along as a second view. But then a column's type is stated twice,
and something has to keep the two statements equal for as long as the
project lives — a permanent tax, paid at the centre of the contract,
of exactly the kind this change has removed three times already. The
metadata client costs a new layer once. A one-time construction beats a
standing obligation, and it is also the only option that gives the
owner's three requirements literally: one factory, one type file, no
generics in the user's hands.

What follows from it is written plainly below rather than softened.

**The built work that loses its reader.** With no column builders in a
consumer, nothing exists to re-tag them: the three write-fact helpers,
the usage-table constructor, the usage side of the authority brand, and
the origin carrier that rides on it. They are removed before merge,
where removal costs a diff. The *declared* side of the authority brand
is re-examined rather than removed with them — narrowing what
`generateMigration` accepts is a schema-repository property that does
not depend on what a consumer holds, and it either stands on that
ground or it does not.

**The work that appears.** The query package gains a client keyed by
names rather than by table values. How much of the existing chain and
compiler it reuses is a `[design]`, and it is the largest unknown in
this change.

Write optionality, which the removed helpers carried, is decided when
the file is written: a defaulted column is optional in `Insert`, a
computed one is absent, an identity column that yields to a supplied
value is optional. The facts are the same; the place they are expressed
moves from a type-level tag to a field's `?`.

## Three facts nobody has needed yet, and the owner's call on them

**Amended: the owner settled on none of the three, this version** (task
2.8's own decision) — this section is kept as the reasoning for why they
exist as a question at all, not as a claim about what shipped. The
three are not oversights; they are created by the new promise that the
mirror is the whole database contract, and the sidecar's carried list
stays at the same six facts it already had. A view yields no export
fact at all; a function's fact carries only its names, never a
signature — a consumer sees no view entry and no function
argument/return information, documented as absent on `ExportDescription`
itself rather than guessed at.

- **A view's column types.** The snapshot stores a view's column
  *names* and the select AST that produced them, not their types. A
  Supabase-shaped `Views` entry needs the types, which means resolving
  that AST against the table types. The one view in the examples is the
  easy shape; an arbitrary projection or join is not, and today a
  consumer cannot query a view at all.
- **A function's signature, structurally.** The snapshot keeps the
  rendered SQL text. The declaration keeps a discriminated form that
  says *returns a set of this table*, which is exactly what turns into
  a typed call returning that table's rows. Recovering it from the text
  would mean parsing SQL type syntax.
- **A function argument's TypeScript key.** This one is not merely
  unserialized — the declaration itself does not keep it. Argument keys
  are converted to snake case on the way in and the original is
  dropped, and the conversion is one-way. A typed RPC call would
  therefore ask for `user_id` rather than `userId` unless the
  declaration side starts keeping the key.

The last one reaches back into the declaration DSL rather than the
export format, which is why it is listed here rather than buried in a
task. It is also the natural boundary for how far function emission
goes in this version: a fact the declaration itself does not keep
cannot be carried by any format, so emitting typed calls with their
declared argument names is a decision about the DSL, taken separately
or deferred.

The follow-up already filed against the old model — carrying function
export names without emitting function declarations — is superseded in
its reasoning by this section, and its disposition is **absorbed here**:
the export's own `functions` fact list already carries each function's
`exportName` alongside its schema-qualified name (`schema-export`'s own
description shape). Emitting a typed call from that fact remains a DSL
decision this change does not make, the same as every other item this
section lists — the follow-up's own request is already satisfied at the
fact-carrying layer; only the emission is still open, and it stays open
here rather than being redefined into a new obligation.

- **An object this repository does not own.** An application that joins
  a platform-owned table has nothing to join against: the export
  describes what the schema repository declares, and that table is not
  declared. What is needed is a declaration that produces **no
  migration** but does produce types and metadata. This is missing
  regardless of which channel carries the schema, so it is recorded
  here and belongs in its own change.

## Owner gates, in the order they must be answered

D12 is answered (revised in full). The rest, in dependency order:

1. **The replacement wording for the generated-artifact prohibition**,
   and the amendment to the decision it rests on. Removal plus a new
   requirement, not a modification.
2. **The manifest row's fate** — now a sub-question of the apply
   engine's ledger rather than an independent one, since verification
   is not being built.
3. **The assets already built.** `DeclaredTable`, `syncedTable`, the
   write-fact helpers: on this branch, not published — the shipped core
   carries none of them. Removing one costs a diff through merge; the
   point of no return is the release, because npm keeps a version
   number for good. So this gate sits below the others rather than
   above them.
4. **Vocabulary, and one name that means the opposite elsewhere.** Our
   `manifest` is a database row; the settled design has a
   `manifest.json` in the export directory. Two artifacts, one word —
   separated now, or conflated in specs and code later.

   The command surface, settled:

   ```
   hejbro link github.com/org/schema   # register the source once
   hejbro vendor                       # write the IR and contract, pin the lock -- first run and every later pin move alike
   hejbro vendor --check               # verify against the lock (offline, CI)
   hejbro outdated                     # is there a newer commit (advisory)
   hejbro pull --db-url <url>          # the database fallback, with its warning
   ```

   **Correction (D106 M8): the shipped surface folds "move to the
   newest commit" into plain `vendor` rather than a separate
   `--update` flag** — `vendor` is first-run and update alike, so there
   is nothing left for a satellite flag to name. The verb stays
   `vendor` and the remaining satellites follow package-manager habit:
   it names what happens — the IR is copied into the repository and
   pinned — and this revision is what earns the name: with the IR
   itself committed, the word describes the artifact rather than the
   intent. The precedent it borrows from is the module ecosystem this
   channel is modelled on. `pull` is free to mean the database
   fallback, which is what the tools that trained everyone's
   expectations already use it for, so the one name that would have
   fought prior knowledge now agrees with it. `outdated` and `--check`
   say to a package manager's user exactly what they say here.

   One property of the surface is worth stating because it is the
   point of the vendored IR: **only `vendor` — and the advisory
   `outdated`, which also reaches the remote to answer "is there a
   newer commit" — need the network.** Checking, regenerating and
   type-checking all run from committed files alone.
5. **The DSL becomes a statically parseable subset — decided now,
   built later.** Today's DSL is executed: callbacks and thunks mean a
   reader must run TypeScript to learn a schema. The constraint cannot
   be applied retroactively, so the decision is recorded now and the
   detection gate and documentation follow in their own change. Two
   things fall out of it: a reader in another language could one day
   read declarations without a JavaScript runtime, and the schema
   repository's own tooling stops depending on execution to know what
   was declared.

6. **`generate`'s speed is a stated requirement.** Declining watch mode
   rested on generation being fast enough that running it by hand is
   not felt; that promise is written down as a requirement rather than
   left as an intention, with sub-second generation as the target and
   the reason — no daemon — recorded beside it.

**The database path, stated honestly.** An external review of the
two channels found the briefing's premise — that both produce the
same artifact — does not hold here. A catalog cannot supply three
things the declarations decide: the TypeScript key each column is
read under, the argument names of a function, and the value-conversion
policy this client applies. The first two are guesses that quietly
change the contract's identity, and a name collision has to be
resolved by the generator rather than by the author. The third is
worse in a polyrepo: three applications each reading the same
database can settle on different handling for `numeric`, `bigint` and
`timestamptz`, because the policy is inferred separately in each. A
tool with no such policy does not have this problem; a full client
does.

So the honest description is not "a second channel" but **a catalog
reading composed with the generator the git channel already uses**:
`pull --db-url` is the import heuristics feeding the same emitter,
and it inherits exactly the losses import already accepts. It exists
because one situation genuinely needs it — a repository adopting this
model, or a consumer that must connect before the schema repository
uses this tool at all — and it says so when it runs, naming what was
inferred and what to do instead once the other side is linked.

Beyond that marked fallback, no feature takes a live catalog reading
as a source of truth for the declared schema. The fallback does
generate from one, and announces it; that is the difference between
a path with a stated loss and a path that pretends there is none.

The one gate still recorded without a recommendation: whether
`generate`'s speed becomes a stated requirement, since declining watch
mode rested on it.

The already-shipped surfaces that do read a live catalog stay exactly as
they are — this change neither extends them nor removes them.

## Decision log entries this change would add or amend

The settled directions live in a design conversation, which is not a
decision record. They land as owner-gated entries before any delta
cites them; otherwise a reviewer working from the repository alone
meets a contract with no stated basis.

Draft list, to be confirmed with the owner, the first one standing above
the others and cited by them:

1. **hejbro works from declarations, not from live infrastructure.**
   The schema and its access are managed from what is declared; what a
   database currently contains is not a source of truth the tool reads
   to decide. Applying, and keeping a ledger of one's own applications,
   are writes in the declared direction and are not exceptions to this.
2. The git channel as the consumption mechanism.
3. The emitted mirror as the consumer's type source, amending the
   inference-only decision.
4. D12's revision: applying is first-class, production included.
5. A database's shape is not verified against the declarations.
6. The vocabulary split between the database row and the export file.
7. **The database path is a marked fallback.** The import heuristics
   composed with the shared generator, carrying a stated loss and
   announcing it. It is never a second channel, and its existence
   does not license reading a catalog anywhere else.

## Open decisions (`[design]`)

1. **The fate of the sync command** — removed, or retained as an
   internal step of `vendor`.
2. **How CI is told apart from a local run**, since replace and `--ref`
   warn locally and fail in CI. Inferring from the environment is
   invisible; a flag is visible but forgettable exactly where it
   matters. **[awaits R1-01 axis ⑦ — precedent in this repository and
   in the tools it already uses]**
3. **The emitted module's file layout**, and what `createDb` binds to,
   which decides what a consuming repository depends on.
4. **The failure enumeration, recounted.** The seven states were
   counted for a database reader. Research maps them: two are purely
   runtime, one is purely deployment, and four span both because they
   share the structure *reading a versioned document*. With runtime
   verification not being built, the two runtime-only states have no
   reader left in this change — they either move to the apply engine's
   ledger, where the question becomes what this tool has applied, or
   they end. The four spanning states reappear on the git side against
   different artifacts, and new git-side failures join them: no export
   directory at the resolved commit, a ref that does not resolve, a lock
   naming a commit the remote does not have. The count is redone across
   delta, verification table and task text together — this change has
   already paid four times for a counting sentence left behind.
5. **Whether the consumer also commits the squashed schema SQL**,
   which only matters once `db up` exists and therefore rides with the
   apply engine.
6. **Whether the banner's manifest line is repurposed or retired.**
7. **A consumer-side comparison against the applied-migration ledger**,
   which answers *the database is at 0041, this contract is 0042* with
   the command that fixes it. **Owner gate**: whether this is
   compatible with the judgement that a database's shape is not
   verified — comparing a ledger rather than inspecting a shape, which
   the identity ruling permits, but it also presumes the consumer role
   may read that table.

## What happens to the groups already done or planned

Nothing here is closed yet; this is the map the sweep follows once the
revision is approved. Completed groups keep their ticks and their
ledger rows — the work happened, and the record of how long it took
stays true regardless of what its output becomes.

**G1 — manifest emission in core.** The SQL rendering and its quoting
guard end with the row. The payload assembly survives as the export's
body. The banner line is a `[design]`: repurposed as an export marker,
or retired.

**G2 — migration authority as a type.** The usage side loses its reader
and is withdrawn before merge. The declared side is re-examined on its
own ground: narrowing what generation accepts is a schema-repository
property and does not depend on what a consumer holds. Nothing is
published, so either outcome costs a diff.

**G3 — sidecar collection and configuration.** The sidecar *moves*: it
is the part of the IR the snapshot does not carry. The optional-config
work survives untouched and is needed more, since a consumer repository
has no migrations directory.

**G4 — emission wiring and monotonicity.** The monotonicity gate's
failure mode cannot occur once the truth is a committed file. A
different gate replaces it: the schema repository's own check that its
export matches its declarations.

**G5 — the sync command.** The overwrite guard and the
snapshot-to-source type mapping survive. The origin carrier goes with
the usage constructor it rides on. The connection path, the state
classifier and most of the emitter end with the database channel.

**G6 — freshness at startup.** Purpose dissolved by the judgement that
a database's shape is not verified. Closes.

**G7 — documentation and release.** Redefined against the new surface;
reissued.

**G8 — two-repository witness.** Redefined, and sequenced after the
apply engine, since the consumer's loop cannot close without it.

The groups this change holds, with estimates frozen now that the shape
is settled. The numbers are agent execution minutes, set against the
measured actuals of the completed groups rather than against intuition.

1. **Withdrawing what lost its reader** — the write-fact helpers, the
   usage-table constructor, the usage side of the brand, the origin
   carrier; and the re-examination of whether the declared side still
   stands on its own ground. `est_frozen: 20m`
2. **The export directory** — the IR assembled from declarations
   including the three facts nobody has needed yet, the squashed schema
   SQL generation already computes and discards, and the export's own
   manifest. Determinism is this group's property. `est_frozen: 60m`
3. **The schema repository's own check** — that the committed export
   matches the declarations, which turns "the default branch's export
   is valid" into a contract. Replaces the monotonicity gate, whose
   failure mode no longer exists. `est_frozen: 30m`
4. **`link` and `vendor`** — symbolic-HEAD resolution, fetching one
   commit's export, the lock, and the overwrite guard carried over
   intact. The consumer commits the contract file, the IR and the
   lock, so that checking, regenerating and type-checking all run from
   committed files and only `--update` needs the network. The lock
   records the IR format version alongside the commit. `est_frozen: 70m`
5. **The emitted contract** — the `Database` interface, the metadata
   constant, the factory. The contract file also carries the point it
   was generated from — the migration head it corresponds to, or the
   IR's hash. `est_frozen: 75m`
6. **The name-keyed client in the query package** — the layer the
   metadata contract needs. `est_frozen: 90m`
7. **The consumer's check** — a lock naming a commit the remote lacks,
   a ref resolved from somewhere other than the default branch, an
   active local replacement, and the local-versus-CI boundary. A
   toolchain too old to read the vendored IR fails with the version it
   needs and the command that installs it, rather than with a parse
   error. `est_frozen: 45m`
8. **Documentation, skill and changeset.** `est_frozen: 26m`
9. **The two-repository witness**, after the apply engine.
   `est_frozen: 25m`

Group 6 carries the most uncertainty and is the one to watch: it is the
only group with no comparable predecessor, and its reuse of the
existing chain and compiler is an open design question rather than a
known quantity. If a re-freeze happens, it happens there, and the
reason will be recorded rather than absorbed.

## Deferred, with reasons

- **Per-query codegen (the sqlc model).** Named in the conversation as
  the principled endpoint for query result types. The name-keyed client
  types entity-level operations from the `Database` contract, which is
  what a consumer needs to read and write its tables. Emitting a
  committed result type for each arbitrary projection or join is a
  further step, weighing as much as the client itself, and it is its
  own change.
- **Other languages.** The IR carries a version field from day one; only
  the TypeScript mirror is produced here.
- **A hosted registry.** The owner chose the git-native channel only.
- **Unifying the schema repository's own surface.** The consumer now
  reads a contract file; whether the repository that owns the schema
  eventually queries through one too, rather than through its
  declarations, is a real question and a later one.
- **The database path belongs to the `import` change**, not to this
  one: the catalog-to-IR inference is built once there and serves
  both entry points — the one-time adoption and the standing
  fallback. This change owns only the statement of what that path is
  and what it costs. What remains genuinely deferred is the lossless
  variant: storing the real IR beside the applied-migration ledger so
  the fallback stops inferring, which would also give drift detection
  for free — and which still would not make it primary, since the
  credential requirement and the ambiguity of *which* database
  survive it.
- **A bot that runs `outdated` and opens the update pull request.**
  `outdated` itself is a settled command; what remains is automating
  it. Manual updating is documented as intent, not as a gap.
- **A second transport over the package registry.** The owner chose
  the git-native channel only; this is a later, additive option.

## Measurement protocol, pre-registered

The property this change stands or falls on moves from the migration's
bytes to the export's and the mirror's.

- **Claim**: the same declarations produce a byte-identical export
  directory and a byte-identical mirror, on any machine, at any time,
  under any file name.
- **Instrument**: two runs over identical declarations with the clock
  advanced between them, compared byte for byte; and a mirror emitted
  twice from the same export.
- **Judgment, fixed in advance**: any byte difference fails the claim.
  No allowance for ordering, whitespace, or a timestamp in a header.
- **A second, independent check** asserts the absence of the causes
  rather than the symptom — no value derived from a clock, a machine,
  or a path reaches either artifact — because two runs a second apart
  can agree by luck.
- **Determinism is now load-bearing in a way it was not.** Both
  artifacts are committed and reviewed as diffs; an emitter that
  reorders its output on a different machine turns every unrelated
  pull request into a review of noise.

If the mirror carries both flat types and table values, one further
property is pre-registered: **the two expressions of a column's type
agree**, checked by a type-level assertion that fails when they
diverge, since nothing else would observe it.

## Impact

- **Affected**: the CLI gains git remote functions in the file that
  already owns every git subprocess, an export writer, an emitter, and
  two commands. The core keeps its purity: parsing a snapshot node's
  object keys stays outside it, by the owner's condition on this
  change's earlier round.
- **Ends**: the manifest's SQL rendering and quoting guard, the
  chain-monotonicity gate, the consumer's database connection path.
- **Not touched**: the shipped `check` and its live catalog comparison
  — neither extended nor removed.
- **Depends on**: the apply engine, for the consumer loop and the
  witness only.
- **Dependencies added**: none. Remote git is reached through the same
  subprocess seam as local git, measured against a real remote.
