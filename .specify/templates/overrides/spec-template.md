# Feature Specification: [FEATURE NAME]

**Feature Directory**: `specs/[###-feature-name]` | **Issue**: #[NNN] (sub-issue of the phase issue) | **Target release**: [next 0.1.x patch — 0.2.0 is the owner-cut stability milestone, D83]

**Created**: [DATE]

**Status**: Draft

**Input**: User description: "$ARGUMENTS"

## User Scenarios & Testing *(mandatory)*

<!--
  User stories are PRIORITIZED journeys of a hejbro user (a developer or an
  agent declaring a Postgres/Supabase schema in TypeScript and running
  `hejbro generate`). Each story must be INDEPENDENTLY TESTABLE: implementing
  only P1 must still deliver value — typically "declare X → generate → the
  expected SQL, and the diff/rename/drop paths behave".
-->

### User Story 1 - [Brief Title] (Priority: P1)

[Describe this user journey in plain language]

**Why this priority**: [Explain the value and why it has this priority level]

**Independent Test**: [e.g., "Declare X in a fresh project, run `hejbro generate`, the migration contains …; edit X, generate again, the diff is …"]

**Acceptance Scenarios**:

1. **Given** [declaration state], **When** [generate / verify / restore], **Then** [SQL / diagnostic / snapshot outcome]
2. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

### User Story 2 - [Brief Title] (Priority: P2)

[Describe this user journey in plain language]

**Why this priority**: [Explain the value and why it has this priority level]

**Independent Test**: [Describe how this can be tested independently]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

[Add more user stories as needed, each with an assigned priority]

### Edge Cases

- What happens on the **alter** path (declaration changed after the first migration)? On **drop**? On **rename** (`--rename`)? On `restore`?
- What does the **diagnostic** say when the declaration is invalid (why + `Next:`)?
- [Other boundary conditions specific to this feature]

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: hejbro MUST [specific capability, e.g., "accept `using("gin")` on an index"]
- **FR-002**: `hejbro generate` MUST [emitted SQL / diff behaviour]
- **FR-003**: The snapshot MUST [what is recorded, so `emit` renders from the snapshot alone]
- **FR-004**: hejbro MUST [diagnostic for the invalid case, with `Next:`]

*Example of marking unclear requirements:*

- **FR-005**: hejbro MUST [NEEDS CLARIFICATION: specific question — max 3 markers in the whole spec]

### Key Entities *(include if the feature adds or changes a declared object)*

- **[Kind / DSL entry]**: [What it represents for the user; attributes, without implementation]
- **[Snapshot shape]**: [What the snapshot records, without field-level design]

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: [e.g., "A user can declare X and get a correct migration on the first `generate` without hand-editing SQL"]
- **SC-002**: [e.g., "The round-trip (chain vs. fresh) produces identical `pg_dump` output for the example that uses X"]
- **SC-003**: [e.g., "Every invalid declaration of X fails at declaration time with a message that names the fix"]

## Decision-log impact *(mandatory)*

- **Reads**: [decision-log rows (D#) this feature relies on, one line each]
- **Proposes**: [new decisions this feature needs the owner to make — candidate D# rows with alternatives; or "none"]
- **Conflicts**: [any logged decision this feature would revisit — must be surfaced to the owner before planning; or "none"]
- **Deferred-list check**: [confirm nothing under the roadmap's *Deferred* list is required; or name it and the owner approval]

## Out of scope

- [What this feature explicitly does not do, so `/speckit-converge` does not flag it as missing]

## Assumptions

- [Reasonable defaults chosen when the description did not specify — e.g. "existing `index()` builder is extended, no new builder"]
- [Dependencies on other 0.2.0 features or on published 0.1.x behaviour]
