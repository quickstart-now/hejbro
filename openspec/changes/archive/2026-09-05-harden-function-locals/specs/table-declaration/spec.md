## ADDED Requirements

### Requirement: Two column keys never share one SQL name
A table SHALL refuse at declaration time, with `duplicate-column`, a
column map in which two keys derive to the same SQL name — naming the
table, both colliding keys and the shared name, in the order the
function declaration's `duplicate-argument` uses — so a reader sees
which two keys collide, not only the name they produced. Of several
collisions, the one reported is the first key in declaration order
whose derived name repeats an earlier key's, together with that earlier
key.

#### Scenario: Two keys deriving to one column name are refused naming both keys
- **WHEN** a table declares columns under `userId` and `user_id`, in
  either order, or under four keys forming two pairs (`aB`, `xY`, `x_y`,
  `a_b`)
- **THEN** the declaration fails with `duplicate-column`, naming the
  table, both colliding keys (`xY` and `x_y` for the four-key map) and
  the shared name, and no declaration is produced
