# query-type-inference (delta)

## ADDED Requirements

### Requirement: Nested read types equal the declared read types
A row read through `jsonArrayFrom`/`jsonObjectFrom` or `related()`
SHALL surface each column with exactly the TypeScript type the same
column has in a top-level select — a `bigint`-mode column reads
`bigint`, a datetime column reads `Date`, an `interval` column reads
the structured value, arrays keep their element nullability — never
the JSON-mediated shape (`number`/`string`). A `jsonArrayFrom`
projection key SHALL type as `ReadonlyArray<Row>` (empty array when no
child matches, never `null`); a `jsonObjectFrom` or forward `related()`
key SHALL type as `Row | null`. `related()` keys SHALL be derived at
the type level from the declared foreign-key edges — reverse keys from
the schema map's table names, forward keys from the FK column name
with one trailing `Id` stripped — so autocomplete offers exactly the
derivable relations and nothing else.

#### Scenario: Nested and top-level types agree column by column
- **WHEN** `comments.createdAt` (`timestamptz`) and `posts.viewCount`
  (`bigint`) are read once at top level and once inside a nested read
- **THEN** both positions type `createdAt: Date` and
  `viewCount: bigint` — identical

#### Scenario: Collection and single-row shapes
- **WHEN** a select projects a `jsonArrayFrom` key and a forward
  `related()` key
- **THEN** the first types `ReadonlyArray<Row>` and the second
  `Row | null`

#### Scenario: Relation keys are derived, not invented
- **WHEN** `posts.ownerId` declares `.references(() => users.id)` and
  `comments.postId` references `posts.id`
- **THEN** `related()` on `posts` accepts exactly the keys `owner`
  (single row) and `comments` (collection), and any other key fails to
  type-check
