# diagnostics Delta

## Purpose

The hejbro diagnostic format every user-facing failure follows — a
stable error code plus an actionable `Next:` line — so that every other
capability's "a hejbro-coded error" means one verifiable thing.

## ADDED Requirements

### Requirement: Every hejbro diagnostic carries a code and a Next line
Every user-facing hejbro failure — a declaration-time error, a CLI
refusal, a query-layer error — SHALL carry a stable, kebab-case hejbro
error code (e.g. `baseline-not-first`, `scalar-return-missing`,
`statement-builder-unused`) and an actionable `Next:` line naming what
the user can do about it. The code is the machine-readable identity: it
SHALL stay stable across releases while message prose MAY change, and a
consumer branching on a failure SHALL be able to branch on the code
alone. A failure surfaced to the user without a code and a `Next:` line
— a raw stack trace, a bare third-party error, an argument-parser
message — is a defect of the surfacing layer, not a permitted format.

#### Scenario: A CLI refusal is coded and actionable
- **WHEN** any hejbro CLI command refuses to run
- **THEN** its output carries a kebab-case hejbro error code and a
  `Next:` line naming a concrete action

#### Scenario: A declaration-time failure is coded and actionable
- **WHEN** a declaration fails at declaration time
- **THEN** the thrown error carries its hejbro error code and a `Next:`
  line, and the code is the same one the same failure carried in the
  previous release

#### Scenario: Message prose may move, the code may not
- **WHEN** a diagnostic's message wording is improved in a release
- **THEN** its error code is unchanged, and a consumer branching on the
  code behaves identically before and after
