## MODIFIED Requirements

### Requirement: A migration's banner carries machine-readable chain and version lines
Every migration file hejbro writes SHALL open with a banner of comment
lines that carry, each under its own known prefix: the hash-chain lines
(the normalized snapshot's hash before and after this migration, so that
each file's "before" is its predecessor's "after" — the chain `verify`
checks), the hejbro-version line, — on a baseline migration only — the
`-- baseline:` marker line, whose consumers are the tools deciding
whether to run the migration or register it as applied, hejbro's own
apply path among them, and — on a tip migration whose snapshot hash was
rewritten by a format upgrade only — the `-- upgraded-from:` line
carrying the hash the tip recorded before the upgrade, whose consumer is
the tool resolving which commit originally carried that snapshot. A tip
carried forward by more than one upgrade SHALL still carry exactly one
such line, naming the hash the tip recorded when it was first written —
the commit that added the file holds those bytes, and those are the
bytes the resolving tool has to match. hejbro
SHALL expose public parsers for these lines, so that decision never
requires string-matching the banner — including when hejbro is the one
making it. Each parser SHALL read its line by its own known prefix only
and ignore unknown banner lines, so an older hejbro reading a newer file
stays unaffected; the machine contract is the prefix, and any prose
after it is for humans and MAY change — a parser that matched the whole
line would report the marker absent after a wording change, and a false
"absent" tells an apply tool, hejbro's own included, to *run* a
migration that must only be registered.

#### Scenario: The banner chains onto the predecessor
- **WHEN** two migrations are generated in sequence and the second's
  banner is parsed
- **THEN** its hash-chain line names its predecessor's hash, and
  `verify` accepts the pair as an intact chain

#### Scenario: An unknown banner line is ignored
- **WHEN** a migration file carries a banner line with a prefix this
  build does not know
- **THEN** every parser returns its own line's result unchanged, and the
  unknown line changes nothing

#### Scenario: Prose after a prefix is not part of the contract
- **WHEN** the guidance prose following a banner prefix changes between
  releases
- **THEN** the parsers' results for files written before and after the
  change are identical

#### Scenario: A baseline migration is identified by its marker
- **WHEN** a tool parses a migration file written by `hejbro baseline`
- **THEN** the exported parser reports the marker as present, and reports
  it absent for a migration written by `hejbro generate`

#### Scenario: An upgraded tip records the hash it replaced
- **WHEN** a tool parses a tip migration after a format upgrade, and a
  migration that was never upgraded
- **THEN** the exported parser returns the replaced hash for the first
  and `null` for the second, and the hash-chain parser returns the
  current hash for both

#### Scenario: A second upgrade keeps the first recorded hash
- **WHEN** a tip that already carries an `upgraded-from` line is carried
  through another format upgrade
- **THEN** the file still carries exactly one such line, its value is the
  hash the tip recorded when it was first written rather than the hash
  the second upgrade replaced, and the exported parser returns that value
