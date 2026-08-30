# migration-format Delta

## Purpose

What a generated migration file carries beyond its DDL — the banner
whose hash chain and version lines make the migration directory
verifiable and machine-readable without running anything.

## ADDED Requirements

### Requirement: A migration's banner carries machine-readable chain and version lines
Every migration file hejbro writes SHALL open with a banner of comment
lines that carry, each under its own known prefix: the hash-chain line
(this migration's own content hash chained onto its predecessor's, the
chain `verify` checks), the format-version line, and — on a baseline
migration only — the `-- baseline:` marker line, whose only consumer is
a tool deciding whether to run the migration or register it as applied.
hejbro SHALL expose public parsers for these lines, so that decision
never requires string-matching the banner. Each parser SHALL read its
line by its own known prefix only and ignore unknown banner lines, so
an older hejbro reading a newer file stays unaffected; the machine
contract is the prefix, and any prose after it is for humans and MAY
change — a parser that matched the whole line would report the marker
absent after a wording change, and a false "absent" tells an apply tool
to *run* a migration that must only be registered.

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
