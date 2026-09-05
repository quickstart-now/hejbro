## MODIFIED Requirements

### Requirement: Stored query-node decode strictness follows the node's format provenance
The snapshot codec SHALL decide decode strictness per stored node by its
format provenance, not by a single global policy. A node kind introduced
within the current format version (the `window` node, the `with` node
and the `aggregate-filter` node) SHALL be decoded strictly: a stored node of that kind missing a
required field (a window node's function call; a `with` node's body or
entry list; an aggregate-filter node's call or condition) is corruption, and decoding SHALL fail naming it rather than
repairing it into a plausible value — a repaired snapshot is a silently
different declaration. A node kind whose absence of a field can be an
older shape genuinely written by an earlier release (the set-operation
node) SHALL be decoded leniently: absence is read as history, not as
invalid input.

Lenient decoding is what puts a decoded snapshot outside the reach of
query-builder's construction-time key-order guard; the backstop for a
hand-edited snapshot is `hejbro verify`, which hashes the
parsed-and-re-rendered snapshot against its recorded value and reports a
reordered set-operation branch as a mismatch when the user runs that
command.

#### Scenario: A damaged window node is refused, not repaired
- **WHEN** a stored window node has no function call
- **THEN** decoding fails, naming the corruption, rather than producing a
  declaration the snapshot never described

#### Scenario: A damaged with node is refused, not repaired
- **WHEN** a stored `with` node has no body
- **THEN** decoding fails, naming the corruption, rather than producing a
  declaration the snapshot never described

#### Scenario: A stored set-operation node decodes leniently, and verify is the backstop
- **WHEN** a hand-edited snapshot reorders a stored set-operation
  branch's projection and the snapshot is decoded
- **THEN** decoding succeeds (absence and reordering are not decode
  errors for this node kind), and `hejbro verify` reports the edit as a
  hash mismatch when run

#### Scenario: A damaged aggregate-filter node is refused, not repaired
- **WHEN** a stored aggregate-filter node has no condition, or no
  function call
- **THEN** decoding fails, naming the corruption, rather than producing
  a declaration the snapshot never described
