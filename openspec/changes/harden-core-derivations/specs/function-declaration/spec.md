## ADDED Requirements

### Requirement: Two argument keys never share one SQL name
`defineFunction` SHALL refuse at declaration time, with
`duplicate-argument`, an `args` object in which two keys derive to the
same SQL name — naming the function, both keys and the shared name —
exactly as a table refuses two column keys that derive to one column
name. Postgres refuses such a parameter list when the function is
created (`parameter name "user_id" used more than once`), so a
declaration that produced it would fail only when the migration is
applied; the declaration is the earliest place the collision can be
named.

The check runs where the column check runs: after every key's own
refusals — the SQL-name refusal and the reserved-name refusal, each
applied to keys in declaration order — and over the whole argument list
at once. Of several collisions the first pair in declaration order is
reported; the argument order the declaration keeps is unchanged for
every list that passes.

#### Scenario: Two keys deriving to one SQL name are refused
- **WHEN** a function declares two arguments whose keys derive to one
  SQL name — a camelCase and a snake_case spelling (`userId` and
  `user_id`, in either order), a digit boundary (`v2Id` and `v2_id`), a
  single-letter segment (`aB` and `a_b`), a trailing underscore
  (`userId_` and `user_id_`), or three keys of which two collide
  (`userId`, `userID`, `user_id`)
- **THEN** the declaration fails with `duplicate-argument`, naming the
  function, both colliding keys and the shared SQL name, and no
  declaration is produced

#### Scenario: Keys that only look alike keep their own names
- **WHEN** a function declares arguments under `postID` and `postId`, or
  under `id` and `id_`
- **THEN** the declaration succeeds and each argument keeps its own
  derived name — `post_i_d` beside `post_id`, `id` beside `id_`

#### Scenario: A key's own refusal precedes the pair refusal
- **WHEN** a function declares `{ order, userId, user_id }` or
  `{ "my-arg", userId, user_id }`
- **THEN** the declaration fails with `reserved-local-name`, or with
  `invalid-sql-name`, for the offending key — not with
  `duplicate-argument`
