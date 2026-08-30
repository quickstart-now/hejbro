# rls-execution-context Delta

## MODIFIED Requirements

### Requirement: The preset states what it cannot detect about the database
The preset SHALL NOT read database state to discover which authentication
mode the database is configured for: that is a probe, and the mechanism
applies a context without asking the database anything first. Fixing the
mode at construction therefore removes mixing, not mismatch — the
declared mode can still be the wrong one for that database, and nothing
in the type layer or at run time can say so.

The preset's user documentation — the hejbro skill's Neon reference
(`skills/hejbro/references/neon-preset.md`), the surface AGENTS.md names
as the user contract — SHALL therefore state the failure this produces,
**in both of its halves**: a context applies a role and an identity
setting, and a wrong mode disables only the identity half. Policies
keyed on the identity function therefore deny, but policies keyed only
on the role — `to authenticated using (true)` and its relatives, the
ordinary way to write "any signed-in user" — still admit, and the
request then runs as a generic authenticated user with no identity ever
resolved. The documentation SHALL warn about that second case, SHALL
give the reader a way to reach the cause from the symptom, and SHALL
state that a token's validity is checked by the database when identity
is first read, not when the context is applied. This documentation
obligation is verified by a repository test asserting the three stated
facts are present — the contract is the facts, not the prose.

#### Scenario: A mismatched context denies where identity is the key
- **WHEN** a context built for one authentication mode is applied to a
  database configured for the other, and a policy is keyed on the
  identity function
- **THEN** the identity function returns NULL under that context and the
  policy denies access

#### Scenario: A mismatched context still admits where the role is the key
- **WHEN** the same mismatched context is applied and a policy is keyed
  only on the role
- **THEN** the policy admits, because the role half of the context
  applied normally — the request runs with no identity, which the
  preset's documentation warns about rather than prevents

#### Scenario: An invalid token surfaces at first use
- **WHEN** a context carrying a malformed or unverifiable token is
  applied
- **THEN** applying the context succeeds and the failure surfaces when
  the database first resolves identity, which the documentation states rather
  than masks

#### Scenario: The documentation obligation is machine-checked
- **WHEN** the repository's test suite runs
- **THEN** a test asserts that the Neon reference documentation states
  the deny half, the still-admits half, and the token-validity timing,
  and fails when any of the three is absent
