## MODIFIED Requirements

### Requirement: Every declared tier's obligation is machine-verified in this repository
A driver shipped from this repository SHALL be checked, at test time,
against the obligation its declared `session-state` tier carries: a
`false` declaration is checked for carrying its settings with every
execution, in that order; a `true` declaration is checked for delivering
them through its session-setup hook. This check observes order, not
content: it reads no driver's own settings text, so it cannot tell a
genuinely unrelated statement that merely precedes the caller's own from
the settings themselves — it checks only that some statement precedes
the caller's own for a `false` declaration, in the position the settings
would occupy if present, and asserts nothing about what follows the
caller's own statement. This is a deliberate limitation of what this
verification observes, not an oversight it is expected to close.

Where a driver declares session state `false` and interactive
transactions `true`, the check SHALL additionally observe the
transaction the settings and the caller's statement travel in: the
transaction opens first, some statement follows it, the caller's own
statement follows that, and no transaction ends between them. The
observation for such a driver SHALL be taken where the driver's own
transaction control is visible — the statements it emits on its
connection — and an observation that cannot show transaction control
SHALL be refused rather than passed, because it cannot tell settings
sent before the transaction opened, where a transaction-local setting is
discarded without applying, from settings sent inside it. Recognizing
where a transaction opens and ends reads SQL's own transaction-control
statements only; the check still reads no driver's own settings text. A
statement is recognized by the transaction-control keyword it leads
with, not by its exact text, so the ordinary spellings of opening and
ending a transaction are all seen. A statement is classified by its
leading word: the text is trimmed and lower-cased, and the leading word
is the first run of characters that are neither whitespace nor `;`, so
a semicolon glued to the word, and any semicolons around it, never
become part of it. Where a control word is read together with the words
after it (`start transaction`; `rollback`, which rolls back to a
savepoint — and so stays ordinary — when `to` follows it directly or
after one optional `work` or `transaction`, and ends the transaction
otherwise), each following word counts only when whitespace alone
separates it from the one before; a `;` between them ends the leading
statement, and nothing past it is read. A string is never split on an interior `;`
into several statements: a string carrying several is classified by its
first alone, and what a later statement in it does is not seen. Text
that leads with a comment leads with the comment's own characters and
is classified as an ordinary statement; the check reads no SQL lexical
structure beyond the leading word. A statement that only manipulates a
savepoint — establishing one, releasing one, or rolling back to one —
neither opens nor ends a transaction, and counts as an ordinary
statement here. The refusal above reads which record the caller handed
over, not the statements inside it: a record taken where transaction
control is visible but carrying none is judged against the obligation
and fails it, rather than being refused as the wrong record.

The check SHALL read which tier applies from the driver's own
capabilities declaration, never from a choice the caller makes
independently of it, and SHALL NOT use observed
behavior to infer, normalize, or correct the declaration itself — reading
the declaration to select an obligation is required; changing it from
what is observed is forbidden. This verification is repo-internal; it is
not part of any package's published surface, and a package that consumes
it internally SHALL wire the two resolution paths that need it
separately — a test runner's own module aliasing for the specifier at
test time, and the consuming package's own type-checker path mapping to
the same single file for type-checking, since a type-checker follows a
package's published `exports` map rather than a test runner's aliasing
and would not otherwise see an internal-only module. Exposing this
verification as a public export is additive and is deferred until a
driver author outside this repository needs it — deferring does not
modify this requirement.

#### Scenario: A driver that fails its declared tier's obligation is caught
- **WHEN** a driver's actual behavior does not carry out the obligation
  its own capabilities declare
- **THEN** a test run against it fails, naming which tier's obligation
  was not observed

#### Scenario: A driver checked against the wrong tier is refused, not silently passed
- **WHEN** a driver is checked with the observation shape for a tier
  other than the one its own capabilities declare
- **THEN** the check itself refuses, rather than silently applying the
  wrong obligation or passing without having checked anything

#### Scenario: A compliant driver's declaration is left unchanged
- **WHEN** a driver's behavior is checked against its declared tier and
  found compliant
- **THEN** its capabilities value reads exactly as it did before the
  check ran

#### Scenario: Settings sent before the transaction opens are caught
- **WHEN** a driver declaring session state `false` and interactive
  transactions `true` sends its settings before the transaction that
  carries the caller's statement opens
- **THEN** the check fails, naming the tier's obligation, even though a
  statement did precede the caller's own

#### Scenario: An observation that cannot show transaction control is refused
- **WHEN** such a driver is checked against an observation that records
  only the statements crossing the driver's own execute contract, where
  a transaction's opening never appears
- **THEN** the check refuses on which record it was handed rather than
  on what that record contains, instead of applying the obligation to
  statements that cannot show where the transaction begins

#### Scenario: A semicolon glued to the leading word does not hide it
- **WHEN** an envelope carries, in the position of a transaction
  boundary, any of `commit;`, `commit; ;`, `COMMIT;;`, `;commit`,
  `rollback; to savepoint x`, `  BEGIN ;`, `begin; set local x`
- **THEN** each is classified by its leading word — the `commit` and
  `rollback` forms end the transaction, so a caller statement after one
  of them is reported as sent outside an open transaction, and the
  `begin` forms open one, so a conforming wire that opens with either is
  not refused

#### Scenario: Nothing past the leading statement is read
- **WHEN** an envelope carries, between the transaction's opening and
  the caller's own statement, any of `start; transaction`,
  `savepoint x;`, `select 'begin; commit'`, `select ';'`
- **THEN** each counts as an ordinary statement — `start; transaction`
  opens nothing because its second word is past a `;`, and a semicolon
  or a control word inside a string literal is never reached — so the
  envelope conforms with that statement standing in for the settings

#### Scenario: A savepoint rollback keeps its optional words
- **WHEN** an envelope carries, between the transaction's opening and
  the caller's own statement, any of `rollback transaction to savepoint
  x`, `rollback work to savepoint x`, `ROLLBACK TRANSACTION TO SAVEPOINT
  s`
- **THEN** each counts as an ordinary statement, exactly as `rollback to
  savepoint x` does, so the envelope conforms — while `rollback work`
  and `rollback transaction` on their own still end the transaction

#### Scenario: A comment-led statement is ordinary
- **WHEN** an envelope carries `-- opens\nbegin` where the opening would
  be, or `/* trace */ commit` between the opening and the caller
- **THEN** each is classified as an ordinary statement — the first
  envelope has no opening and is reported as such, the second conforms —
  because the leading word is the comment's own text, and that is the
  limit of what this check reads
