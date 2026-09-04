# schema-vendoring Specification

## Purpose
This capability covers how a repository obtains a schema it does not
own: naming a source once, copying one commit's export into itself,
pinning that commit, and checking the copy against the pin without
reaching the network. It states the shape of what a consumer holds —
a contract of types and metadata rather than declarations — the
guarantee that nothing in it can author migrations, and each named
way the obtaining and checking can fail.

## Requirements

### Requirement: A repository obtains a schema it does not own over git
A consuming repository SHALL name its source once, and thereafter
obtain the schema from that repository's committed export. `link`
records the source **repository** and nothing else. `vendor` resolves
the remote's default branch, reads the export at the resolved commit,
writes the contract, the intermediate description, and the squashed SQL
into the consuming repository, and records the commit in a lock.
`--ref` overrides the resolution for one run and does not persist; the
lock records which ref a commit was resolved from.

Branch is intent and commit is truth: everything except a deliberate
update reads the lock, so a colleague's clone and a continuous
integration run build from the same commit whatever the branch has done
since.

**Only `vendor` — and the advisory `outdated`, which also reaches the
remote to answer whether a newer commit exists — reach the network.**
Checking, regenerating and type-checking SHALL work from committed
files alone, which is what lets an agent with no credentials do all of
them.

#### Scenario: Linking records the repository alone
- **WHEN** a consumer links a source
- **THEN** the recorded source names the repository, and no branch

#### Scenario: Vendoring pins what it read
- **WHEN** `vendor` runs against a linked source
- **THEN** the contract, the description and the squashed SQL are
  written into the repository and the lock records the commit they
  came from

#### Scenario: A one-off ref does not stick
- **WHEN** `vendor --ref` runs and then `vendor` runs again
- **THEN** the second run resolves the default branch, and the lock
  records which ref each resolution came from

#### Scenario: Checking needs no network
- **WHEN** the vendored files are checked against the lock with the
  remote unreachable
- **THEN** the check completes and reports its result

#### Scenario: Outdated is advisory, and it does reach the network
- **WHEN** `outdated` runs against a linked source
- **THEN** it resolves the remote's current default branch to answer
  whether a newer commit exists, unlike checking or type-checking

### Requirement: The vendored contract is a function of the commit
Two vendoring runs against the same commit SHALL write byte-identical
files. The contract SHALL therefore contain no value derived from a
clock, from the machine, or from the order in which anything was read.

Without this a consumer re-vendoring sees a change where the schema has
none, and a pull request that updates a schema becomes unreviewable.

#### Scenario: Two runs against one commit are byte-identical
- **WHEN** `vendor` runs twice against the same commit, the first run's
  output discarded
- **THEN** both runs write byte-identical files

#### Scenario: The contract names no clock
- **WHEN** a contract is written
- **THEN** it contains no timestamp and no host name

### Requirement: The contract names the point it was generated from
The contract SHALL carry the identity of the export it was generated
from, as a value a program can read, so that a check can compare
without recomputing anything.

#### Scenario: The origin is readable
- **WHEN** a vendored contract is read
- **THEN** the commit and the export identity it was generated from are
  available as values

### Requirement: A consumer holds a contract, not declarations
What a consumer receives SHALL be a description of the database's
shape — its tables, the enums their columns use, and the rows they
yield and accept — together with the metadata a client needs and a
factory that binds the two. It SHALL NOT contain declarations, and no
value in it SHALL be capable of authoring a migration.

A consumer that tries to generate migrations from a vendored contract
SHALL be refused, with the refusal naming what it observed — that the
input carries nothing declared here — and pointing at the repository
that owns the schema.

#### Scenario: The contract yields no declaration
- **WHEN** a vendored contract's exports are inspected
- **THEN** none of them is a declaration, and none can be passed to
  migration generation

#### Scenario: Generating from a vendored contract is refused
- **WHEN** a vendored contract is used as the declaration entry point
- **THEN** generation fails with a coded error naming the owning
  repository, and writes nothing

### Requirement: The contract reproduces the consumer-visible type layer
Types read through a vendored contract SHALL equal the types read
through the declarations it was generated from. **Each of these
properties is observable, and each is checked:** a row's keys are the
declared TypeScript keys rather than the SQL column names; an array
column's element nullability follows the declared constraint; a numeric
column's visible type follows its declared mode; an enum column types
as its declared values rather than as a string; and a column's write
input follows what the database does for it — one the database fills is
optional on insert, one it computes is absent from writes altogether,
and an identity column that yields to a supplied value is optional
rather than absent.

#### Scenario: Row keys match the declaring repository
- **WHEN** a row is read through a vendored contract
- **THEN** its keys are the declared TypeScript keys

#### Scenario: Element nullability follows the declaration
- **WHEN** an array column declared with non-null elements is read
- **THEN** its element type is not nullable

#### Scenario: Numeric mode follows the declaration
- **WHEN** a numeric column with a non-default mode is read
- **THEN** its visible type is the declared mode's type

#### Scenario: Enum columns keep their values
- **WHEN** an enum column is read through a vendored contract
- **THEN** its type is the union of the declared values

#### Scenario: Write inputs follow what the database does
- **WHEN** a table with a defaulted column, a computed column and an
  identity column that yields to a supplied value is written through a
  vendored contract
- **THEN** the defaulted and identity columns are optional in the
  insert input and the computed column is absent from it

### Requirement: Type brands do not cross the boundary
A `$type` brand names a TypeScript type that exists only where the
schema is declared. A vendored contract SHALL carry no brand, and a
branded column SHALL read as its underlying type.

This is a property of the boundary rather than of any vehicle: no
export format could carry it, because there is nothing on the other
side for the name to refer to.

#### Scenario: A branded column reads as its unbranded type
- **WHEN** a column declared with a `$type` brand is read through a
  vendored contract
- **THEN** its type is the underlying type, unbranded

### Requirement: Role names travel with the contract, and opting in is a call, not a configuration
**Revised (D106 B2): opt-in moved from construction time to call time.**
The contract SHALL export the role names the schema declares, and the
generated client SHALL carry that list as its own whitelist — a
consumer never passes it separately, and holding the client adopts no
role by itself. A role is only ever active for the one call that names
it: `client.as({role})` accepts a role in the contract's list and
rejects one that is not, and a call that never names a role SHALL run
with none active, the same as an unscoped `db()` call.

The metadata carries only the **candidate set** a client is willing to
accept — never permission. What a role can actually do once accepted is
decided entirely by the database's own RLS policies and grants; vendoring
a schema grants nothing on its own.

#### Scenario: An in-list role is accepted at the call that names it
- **WHEN** a consumer calls `client.as({role})` with a role the contract
  exports
- **THEN** the call succeeds and that role is active for it

#### Scenario: An out-of-list role is rejected exactly as before
- **WHEN** a consumer calls `client.as({role})` with a role the contract
  does not export
- **THEN** it is rejected the same way an undeclared role always is

#### Scenario: No role is active without calling `as()`
- **WHEN** a consumer calls a table method directly, without `as()`
- **THEN** the call runs with no role active, never one silently chosen
  from the contract's list

### Requirement: A reference to a table the schema does not own has no relation
Where a foreign key points at a table the export does not describe, the
contract SHALL carry the column and derive no relation from it, rather
than inventing a target it cannot describe.

#### Scenario: A relation to an unmanaged target is absent
- **WHEN** a table references one the export does not carry
- **THEN** the column is present and no relation is derived from it

### Requirement: Each way vendoring can fail is named separately
This enumeration is scoped to the process of **obtaining and checking**
a vendored schema — `link`, `vendor`, `vendor --check`, `outdated`.
Whether the external tool that process depends on (`git`) is even
present is a different question with a different owner: `cli-commands`'
"An external tool is an optional dependency" already covers it (`git`
missing SHALL be reported as a coded failure there, not counted again
here).

A consumer's toolchain meets **eleven** distinct situations within that
scope, and SHALL report each under its own code with its own remedy.
They are: no source is linked; the remote cannot be reached; the ref
does not resolve; the resolved commit carries no export; the export
does not answer its own format; the export's format is newer than this
toolchain knows; the lock names a commit the remote no longer has; the
vendored files disagree with the lock; the destination holds a file
this tool did not write; the lock was resolved from somewhere other
than the default branch; and a check is asked for before anything has
ever been vendored.

A situation earns its own code when its remedy is **distinct** — a
different action, not necessarily a different destination: most of
these send the reader back to their own repository, but the action they
take there (re-vendor, edit `--ref`, decide with `--force`, remove a
hand-written file, …) still differs from one code to the next. A few do
send the reader elsewhere entirely — to the repository that owns the
schema, or to upgrade the consumer's own toolchain — and reporting one
under another's code there sends someone to fix what they do not own.

Being behind the newest commit is not among them: a lock that names an
older commit is doing its job, and staleness is reported as advice. Nor
is an active local replacement: that situation belongs to `replace`
(a committed source overridden locally by an uncommitted, gitignored
file), and this change does not build `replace` — no caller can reach
it yet. It returns to this enumeration when `replace` lands.

#### Scenario: The eleven situations are told apart
- **WHEN** a toolchain meets each of the eleven in turn
- **THEN** it reports eleven distinct codes, each carrying its own
  remedy

#### Scenario: A commit with no export names the other repository
- **WHEN** the resolved commit carries no export
- **THEN** the failure names the repository that owns the schema and
  the command that publishes one, not anything the consumer can change

#### Scenario: A lock naming a lost commit is not silently moved
- **WHEN** the lock names a commit the remote no longer has
- **THEN** vendoring fails, and the lock is unchanged

#### Scenario: Checking before ever vendoring names the remedy
- **WHEN** `vendor --check` runs against a repository that has never
  run `vendor`
- **THEN** it fails naming `vendor` as the command to run first, rather
  than failing on a missing file with no such guidance

#### Scenario: Being behind is advice, not failure
- **WHEN** the lock names an older commit than the default branch's tip
- **THEN** the staleness is reported without failing the check

### Requirement: An explicit flag decides warn-vs-fail; without one, the terminal does
The lock resolved from a non-default ref is advisory at `vendor` itself
and refused at `vendor --check` — the boundary between local freedom
and committed state. `--strict`/`--no-strict` SHALL decide which side of
that boundary a run treats a non-default-ref lock as; an explicit flag
SHALL always win. Without either, `vendor --check` SHALL fail when its
output is not an interactive terminal (including piped output, not only
a recognized CI environment variable — this repository reads no such
variable), and SHALL only warn when it is.

#### Scenario: An explicit flag always wins
- **WHEN** `--strict` or `--no-strict` is passed to `vendor --check`
- **THEN** that flag's own behavior applies regardless of whether output
  is a terminal

#### Scenario: A non-interactive check fails by default
- **WHEN** `vendor --check` runs against a non-default-ref lock with
  neither flag and output is not an interactive terminal
- **THEN** it fails, naming the non-default ref

#### Scenario: An interactive check warns by default
- **WHEN** `vendor --check` runs against a non-default-ref lock with
  neither flag and output is an interactive terminal
- **THEN** it warns and exits zero, rather than failing

### Requirement: A description format newer than the reader is refused
Format skew is asymmetric because the description format only ever
gains fields. A toolchain meeting a **newer** format SHALL refuse,
naming the version it found, the version it knows, and the command that
installs a newer hejbro. A toolchain meeting an **older** format SHALL
read it and treat the facts that format does not carry as absent.

The two skew axes are observed differently, and the scenario titles below
say which is which. The format-**number** axis stays structural: the
description format has only ever been 1, so no export declaring a lower
number was ever written, and the suite pins only the refusal side. A
fixture declaring format 0 would be a fabricated artifact, not an older
export, so the older-number branch is recorded as unobservable rather
than promised as checked — exactly what its scenario title says.

The **shape** axis is observed. Format 1 now has two shapes: the one
written before functions carried their argument and return facts, and the
one written since. A reader meeting the earlier shape SHALL read the
function as present and its typed-call facts as absent, and SHALL NOT
carry that function into the contract's `Functions` section — a call it
cannot type is not offered.

#### Scenario: A newer format is refused with the command that fixes it
- **WHEN** the vendored description declares a newer format
- **THEN** the failure names both versions and the command that
  installs a newer toolchain, and no contract is written

#### Scenario: An older format is read (unobservable until a second format exists)
- **WHEN** the vendored description declares an older format
- **THEN** it is read, and facts that format does not carry are absent

#### Scenario: A pre-functions export reads with its functions absent
- **WHEN** `hejbro vendor` reads a format-1 export whose function facts
  carry no `args` or `returns`
- **THEN** the export is read, the tables are carried as before, and the
  contract's `Functions` section carries none of those functions

### Requirement: Vendoring never overwrites a file it did not write
Where the destination holds `hejbro.lock` or the vendored `contract.ts`
and either is not a file this tool wrote, vendoring SHALL refuse rather
than overwrite it. The check SHALL be textual, so that deciding never
requires loading the existing file as code — a clause that matters for
`contract.ts` specifically, the one vendored destination a consumer's
own code imports and therefore the one whose accidental execution as
code would actually matter.

`.hejbro/vendor/schema.json` and `.hejbro/vendor/snapshot.sql` are
exempt from this same textual guard, for a different reason: both are
byte-identical copies of what the schema repository published, never
loaded as code by anything, and their integrity is already covered by
`hejbro.lock`'s own per-file hashes (`vendor --check`'s job). A guard
against overwriting them would be a second, redundant check on a
property the lock already proves.

#### Scenario: A hand-written lock is not overwritten
- **WHEN** `hejbro.lock` exists and is not a file this tool wrote
- **THEN** vendoring fails with a coded error and the file is unchanged

#### Scenario: A hand-written contract is not overwritten, even before a first vendor
- **WHEN** `.hejbro/vendor/contract.ts` exists and is not a file this
  tool wrote, whether or not `hejbro.lock` exists yet
- **THEN** vendoring fails with a coded error and the file is unchanged

### Requirement: The check compares without writing
`vendor --check` SHALL compare the vendored files against the lock and
write nothing, exiting non-zero when they disagree.

#### Scenario: Checking leaves the files untouched
- **WHEN** the check runs against files that disagree with the lock
- **THEN** it exits non-zero and no file is modified

#### Scenario: A matching set passes quietly
- **WHEN** the vendored files agree with the lock
- **THEN** the check succeeds and writes nothing

### Requirement: The schema filter is reserved, not silently ignored
Where a schema filter is supplied, the command SHALL refuse it as
reserved rather than accept and ignore it, because a caller who
believes a filter applied would ship a contract describing more than
they asked for.

#### Scenario: The reserved filter is refused
- **WHEN** a schema filter is supplied
- **THEN** the command fails with a coded error naming it as reserved

### Requirement: The contract carries a typed function surface
A vendored contract SHALL emit, under its `Functions` section, one entry
per function the export carries an export name for — keyed by that
export name, while `Tables` stays keyed by SQL name as it already
ships, because a function is called the way the declaring repository
calls it and a function's SQL name is frequently not the name anyone
wrote — with the argument object type (the declared TypeScript
keys, each typed as the declared argument type would be read) and the
result type (the mapped scalar type, or the rows of the returned table,
with the same numeric-mode and element-nullability rules the table
entries follow). A function synthesized as part of a trigger definition
carries no export name and SHALL NOT appear. Neither SHALL a function
whose returned table the contract does not itself carry: there is no
row type to resolve to, and typing it against a table that is not there
would be a guess — the rule a foreign key pointing outside the schema
already follows. The name-keyed client
built from that contract SHALL expose those functions under `fn`,
keyed the same way, as callables whose rendered SQL is the same
parameterized invocation the declaring repository's own `db.fn` renders
— an explicit column list for a table return, never `select *` — and
the same surface under `.as(context)`, since a function called for a
role is the case a scoped handle exists for. So a consumer calls the
owning repository's functions with the types the declarations gave them
and no declaration in hand.

A mismatch is caught where TypeScript can see it: a missing or wrongly
typed argument fails to compile anywhere; an extra property fails to
compile on a fresh object literal. A value TypeScript never checked —
built elsewhere, widened, or parsed from text — is refused at the call
instead: the runtime check compares the caller's key set against the
declared arguments, so an argument object carrying a key the function
does not declare is refused, naming that key and the declared ones,
never sent as a missing value for the argument it was misspelling.

#### Scenario: A scalar function crosses the boundary
- **WHEN** a schema declaring a scalar-returning function is vendored
  and the consumer calls it through the client's `fn` with matching
  arguments
- **THEN** the call type-checks against the declared argument keys and
  types, executes a parameterized invocation, and resolves to the
  mapped scalar type — through the scoped handle as well, where the
  same invocation runs inside the context the scope applies

#### Scenario: A table-returning function crosses the boundary
- **WHEN** a schema declaring a function that returns a table is
  vendored and called through the client's `fn`
- **THEN** it resolves to that table's typed rows and the rendered SQL
  lists the returned columns explicitly

#### Scenario: A mismatched call fails the type check
- **WHEN** the consumer calls a vendored function with a missing or
  wrongly typed argument, or with an extra property on a fresh object
  literal
- **THEN** the call fails to compile; a pre-built value whose key count
  does not match the declared arguments, and one whose keys are the
  right number but name an argument the function does not declare, are
  both refused at runtime before any SQL is sent, the second naming the
  unknown key and the declared arguments

#### Scenario: A function returning an uncarried table is absent
- **WHEN** a vendored schema declares an exported function returning a
  table the contract does not carry
- **THEN** that function has no `Functions` entry and no `fn` callable,
  rather than an entry typed against rows the contract cannot describe

#### Scenario: A synthesized trigger function is absent
- **WHEN** the vendored schema's only functions come from trigger
  definitions
- **THEN** the contract's `Functions` section is empty and the client
  exposes no `fn` entry

### Requirement: A vendored mutation's type matches what it returns
The name-keyed client's bare `insert()`, `update()` and `delete()` SHALL
type as resolving to no rows, because the statement they send carries no
`RETURNING` clause. A consumer who needs the written rows back reads them
in a second statement; the client SHALL NOT promise rows in a type it
never delivers.

#### Scenario: A bare insert resolves to no rows, and says so in its type
- **WHEN** a consumer awaits `client.<table>.insert(row)` through a
  vendored contract
- **THEN** the promise resolves to an empty array and its awaited type is
  exactly `ReadonlyArray<never>` — the table's row type is not what it
  resolves to

### Requirement: A contract vendored before functions were carried still runs
`createNameKeyedDb` SHALL accept contract metadata that carries no
`functions` member — the shape every contract vendored before the typed
function surface existed has — and expose an empty `fn`.

#### Scenario: A pre-functions contract still builds a client
- **WHEN** a consumer builds a client from a vendored `contract.ts` whose
  metadata has no `functions` member
- **THEN** the client's tables work as before and `fn` carries no callables

### Requirement: Every emitted key compiles
The contract emitter SHALL quote a table column key or function argument
key that is not a valid TypeScript identifier, and SHALL import every
value type its own output names, so that a contract compiles whatever the
export carries.

Such a key reaches the emitter from the export it reads, never from a
declaration: a declared column key and a declared function argument key
both derive a hejbro SQL name, and every key that survives that
derivation is already a valid TypeScript identifier. The emitter carries
the key the export holds and never re-derives it, so quoting is what
keeps a hand-edited export — or one written by a toolchain whose rules
differed — compiling.

#### Scenario: A non-identifier key is quoted
- **WHEN** an export whose table fact carries a column key such as
  `user-id`, and whose function fact carries an argument key such as
  `my-arg`, is vendored
- **THEN** the contract compiles and each key is preserved as written

#### Scenario: An interval column compiles
- **WHEN** a schema declaring an `interval` column and an `interval`
  function argument is vendored
- **THEN** the contract compiles with the interval value type resolved

### Requirement: An existing table crosses the boundary
A vendored contract SHALL emit an existing table — one the schema
declares with `existingTable()` — under `Tables` with the same `Row`,
`Insert`, and `Update` derivation a managed table gets, and its client
metadata SHALL mark it existing. The name-keyed client SHALL expose it
for reading like any other table, and a managed table's foreign key
onto it SHALL resolve to a relation in the contract exactly as one onto
a managed table does; a foreign key onto a table the schema does not
declare at all keeps having none.

Following that relation from the client is a separate surface: the
name-keyed client exposes no `.related()` for any table, managed or
existing. What this requirement guarantees is that the relation is
carried in the contract.

No code reads that mark today — the client already treats every
vendored table as existing, and whether a relation resolves is decided
when the contract is emitted, not when it is read. The mark is carried
for the reader of the generated file and for tooling built on it.

#### Scenario: A consumer reads a platform-owned table
- **WHEN** a schema declaring `auth.users` with `existingTable()` and a
  managed table referencing it are vendored, and the consumer reads
  both tables through the vendored client
- **THEN** the contract carries the relation to `auth.users`, and rows
  of the existing table read through the client type as its declared
  columns

#### Scenario: An undeclared table still has no relation
- **WHEN** a managed table references a table the schema neither
  manages nor declares with `existingTable()`
- **THEN** the contract carries no relation for that reference, as
  before

### Requirement: A database-sourced contract is marked and refused by the checks that need a commit
A contract's metadata SHALL name where the contract came from, and the
two sources are told apart there rather than guessed at: one names the
commit it was vendored from, the other names the database it was
inferred from — its name and the schemas that were read, never the
connection string, which carries a secret. A contract written by
`pull --db-url` SHALL carry the second, with no commit, and SHALL say
in its header that it was inferred from a database rather than vendored
from a schema repository. `vendor --check` and `outdated` SHALL refuse
to run against it with a coded diagnostic naming `link` as the way to a
commit-anchored contract. A contract vendored before the origin was
named — carrying a commit and no source — SHALL still type-check
against the client that reads it, so upgrading the client never breaks
a contract already committed.

#### Scenario: pull writes where vendor writes
- **WHEN** `hejbro pull --db-url <db> --schema public` runs in a
  repository that has vendored before
- **THEN** it writes the vendor layout in place, under the same
  existing-file rules `vendor` itself applies, and the lock it leaves
  is marked as written by `pull`

#### Scenario: A database-sourced contract says so and carries no commit
- **WHEN** `hejbro pull --db-url <db> --schema public` writes a contract
- **THEN** its header says it was inferred from a database, its metadata
  names that database and the schemas read, and it carries no commit

#### Scenario: outdated refuses a database-sourced contract
- **WHEN** `hejbro outdated` runs in a repository whose contract came
  from `pull --db-url`
- **THEN** it fails with the coded diagnostic and names `link`

### Requirement: An emitted key survives as data, whatever it is named
One key name carries meaning in a JavaScript object instead of becoming
a property, and a vendored schema travels through two objects keyed by
what the declaring repository named things: the description that is read
and the metadata that is emitted. Both SHALL carry every table key,
function key and column key as an own property, whatever the schema
named it — the facts a description holds under such a key SHALL reach
the contract, and the contract's own keys SHALL be own properties at run
time. A key that is silently absorbed rather than carried loses the
column from every statement the client builds, or loses what the
declaring repository said about it, with the contract still compiling
and every type still claiming the column is there.

#### Scenario: A column whose name is meaningful in an object literal is carried
- **WHEN** an export carries a table whose column key is `__proto__`,
  and a contract is generated from it
- **THEN** the generated module's metadata lists that column among the
  table's own column keys, and a read of that table names the column in
  its statement like any other

#### Scenario: What the description says under such a key reaches the contract
- **WHEN** a vendored description holds a column fact under the key
  `__proto__`, carrying that column's TypeScript key and numeric mode
- **THEN** the contract carries that column with the key and the mode
  the description gave it, not with values recovered from elsewhere

#### Scenario: A key that only looks dangerous is carried the same way
- **WHEN** an export carries column keys named `constructor`,
  `prototype`, `hasOwnProperty` and `toString`
- **THEN** each is an own property of the emitted metadata and reaches
  the client's statements, unchanged from how an ordinary key is carried
