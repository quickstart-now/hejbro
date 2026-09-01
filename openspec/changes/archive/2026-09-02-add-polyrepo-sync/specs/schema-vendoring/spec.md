# schema-vendoring (delta)

## ADDED Requirements

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

**Not yet observable, and recorded as such rather than promised**: the
description format has held one shape (format 1) since it first
existed, so there is no earlier shape yet for an "older format" branch
to read — the asymmetry above is structural, built ahead of the day
format 2 ships, the same way the local-replacement absence elsewhere in
this document names a destination rather than a proof that doesn't
exist yet. This closes for real, with a real fixture, the day a second
description format exists.

#### Scenario: A newer format is refused with the command that fixes it
- **WHEN** the vendored description declares a newer format
- **THEN** the failure names both versions and the command that
  installs a newer toolchain, and no contract is written

#### Scenario: An older format is read (unobservable until a second format exists)
- **WHEN** the vendored description declares an older format
- **THEN** it is read, and facts that format does not carry are absent

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

## REMOVED Requirements

### Removed: A synced module carries its freshness stamp as a value
**Moves** into the requirement that the contract names its origin: the
value survives, the runtime reader it was written for does not.

### Removed: Freshness is judged by comparison, never by hashing at run time
**Ends.** Verifying at run time that a database matches a contract is
not built. Comparison against the lock is a different requirement with
a different subject, and it is stated above rather than inherited here.

### Removed: A synced module carries tables and enums, not functions
**Ends as written.** What the contract carries is stated positively
above; how far function and view descriptions go in this version is
settled in the tasks, not assumed here.
