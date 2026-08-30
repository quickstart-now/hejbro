# rls-execution-context Delta

## MODIFIED Requirements

### Requirement: The preset states what it cannot detect about the database
The preset SHALL NOT read database state to discover which authentication
mode the database is configured for: that is a probe, and the mechanism
applies a context without asking the database anything first. Fixing the
mode at construction therefore removes mixing, not mismatch — the
declared mode can still be the wrong one for that database, and nothing
in the type layer or at run time can say so.

The `@hejbro/neon` package's README SHALL therefore carry a
mode-mismatch section stating the failure this produces, **in both of
its halves**: a context applies a role and an identity setting, and a
wrong mode disables only the identity half. Policies keyed on the
identity function therefore deny, but policies keyed only on the role —
`to authenticated using (true)` and its relatives, the ordinary way to
write "any signed-in user" — still admit, and the request then runs as a
generic authenticated user with no identity ever resolved. The section
SHALL warn about that second case, SHALL give the reader a way to reach
the cause from the symptom, and SHALL state that a token's validity is
checked by the database when identity is first read, not when the
context is applied. This documentation obligation is verified by a
repository test that asserts the README's mode-mismatch section exists
and names both halves and the token-validity timing — the contract is
the section's presence and its three stated facts, not its prose.

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
  README's mode-mismatch section warns about rather than prevents

#### Scenario: An invalid token surfaces at first use
- **WHEN** a context carrying a malformed or unverifiable token is
  applied
- **THEN** applying the context succeeds and the failure surfaces when
  the database first resolves identity, which the README's mode-mismatch
  section states rather than masks

#### Scenario: The documentation obligation is machine-checked
- **WHEN** the repository's test suite runs
- **THEN** a test asserts that `@hejbro/neon`'s README carries the
  mode-mismatch section naming the deny half, the still-admits half, and
  the token-validity timing, and fails when any of the three is absent
