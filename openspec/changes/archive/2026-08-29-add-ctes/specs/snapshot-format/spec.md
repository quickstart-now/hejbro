# snapshot-format (delta)

## ADDED Requirements

### Requirement: A stored view body may declare CTEs
The snapshot's stored query vocabulary SHALL include the `with` statement
node, so a view whose body declares CTEs is storable and comparable like
any other view. Adding it SHALL NOT change `formatVersion`: a new
discriminator is vocabulary (D73), the precedent set by `select-expr` and
`set-op`.

Existing declarations' serialization SHALL be unchanged, byte for byte. A
new statement node adds a key to no existing encoded object; a diff in a
golden or an example snapshot means something else moved and is
investigated rather than regenerated.

The stored subset SHALL remain select-only. A `with` node whose body or
whose entries are anything other than a select or a set operation has no
snapshot form, upholding D94's rule that mutations never reach a snapshot.

#### Scenario: A view declaring a CTE is stored and compared
- **WHEN** a view whose body declares a CTE is snapshotted, and the same
  declaration is snapshotted again
- **THEN** the two snapshots are identical and the diff is empty

#### Scenario: Existing snapshots do not move
- **WHEN** the snapshot of a declaration containing no CTE is taken before
  and after this change
- **THEN** the two are byte-identical, and `formatVersion` is unchanged
