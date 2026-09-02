## ADDED Requirements

### Requirement: A synthesized function declaration is refused by generate
A function declaration carrying usage authority — one synthesized from a
vendored contract rather than written in a declaration module — SHALL be
refused by `generate` with `synced-function-declared`, the function-side
twin of the table guard, so a consumer never migrates from a description
it does not own. A declaration written with `defineFunction` or
synthesized by a trigger definition carries no such authority and is
never touched by this guard.

#### Scenario: A usage-authority function reaching generate is refused
- **WHEN** a function declaration tagged with usage authority is passed to
  `generateMigration`
- **THEN** it fails with `synced-function-declared`, naming the function
  and the way forward, and no migration is produced

#### Scenario: Ordinary declarations are untouched
- **WHEN** a schema whose functions come from `defineFunction` and trigger
  definitions is generated
- **THEN** the guard never fires
