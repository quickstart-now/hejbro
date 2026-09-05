# Design: harden-catalog-inference-2

Settled by the lead under the owner's full delegation for this pass;
recorded as rulings on the change's issues.

## Q1 — Roles from policies (#678)

`pg_policies.roles` is `name[]`, `{public}` when the policy applies to
everyone. The names join the union the three grant sources already
feed; `public` is dropped there and nowhere else (a grant to `public`
already carries the same spelling and is already excluded on that
path, or must be — the input table covers both). No policy expression
is inferred; the requirement's not-inferred list is unchanged.

## Q2 — Enum names (#712)

- (i) Carry an enum whose name D36 rejects and document that `pgEnum`
  does not assert its name.
- (ii) Hold the enum name to the same rule as every identifier: omit
  and name, columns included.
- **Ruling (ii).** One rule for identifiers is the requirement's own
  sentence ("the DSL's own rule, consulted, never a second rule"); an
  enum reaching DDL as `"Status"` would be the one object hejbro emits
  under a name it refuses everywhere else. A column typed by an omitted
  enum cannot be declared (its type is gone), so it is omitted with it
  and named on the same line; `check` then lists the column and the
  enum as unmanaged until both are renamed and declared — the line says
  so, per the existing rule for omission lines.
