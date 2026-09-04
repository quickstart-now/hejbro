## MODIFIED Requirements

### Requirement: A preset refuses declarations its platform will not accept
A provider preset whose platform rejects part of the DSL SHALL refuse
those declarations at generate time, with an explicit error, rather than
emitting SQL the platform will refuse. The error SHALL name the
declaration that caused it, state what the platform does with it, and
give the caller a way forward. The preset SHALL NOT silently drop,
rewrite, or downgrade the declaration: a declaration that cannot be
honored is a failure, not a no-op.

This refusal is a property of the preset, not of the core DSL. The same
declaration remains valid for platforms that accept it, and adding a
preset SHALL NOT change what any other preset generates.

This refusal SHALL be the same whichever of `hejbro generate` or `hejbro
verify` the caller runs: both run every registered validator over the
same declared snapshot, so a declaration one refuses the other refuses
too, with the same error.

#### Scenario: A refused declaration fails generation with an explicit error
- **WHEN** a schema declares something the active preset's platform
  rejects, and migration SQL is generated
- **THEN** generation fails with an error naming that declaration and what
  the platform does with it, and no SQL is written

#### Scenario: A refused declaration is never silently dropped
- **WHEN** the same schema is generated
- **THEN** no output is produced that omits the declaration while
  reporting success

#### Scenario: An accepted declaration is untouched
- **WHEN** a schema declares only what the platform accepts
- **THEN** generation succeeds and the SQL is identical to what the same
  declarations produce with no preset registered

#### Scenario: Another preset's output is unchanged
- **WHEN** the same declarations are generated with a different preset
  registered
- **THEN** the refusal does not apply and that preset's output is
  unchanged by this capability existing

#### Scenario: generate and verify agree on the same refusal
- **WHEN** a schema declares something the active preset's platform
  rejects, and separately `hejbro generate` and `hejbro verify` each run
  against it
- **THEN** both refuse, and both name the same coded error
