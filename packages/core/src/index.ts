// @hejbro/core — declaration model, builder DSL, compiler, snapshot & diff engine.
// This package is pure: it never touches the filesystem or a database.
// See /docs/specs/2026-08-19-hejbro-design.md before implementing anything here.

// The full public API surface is re-exported here in Task 13; for now this
// re-exports just the snapshot version constant (defined in
// snapshot/snapshot.ts, its natural home, to avoid a circular import
// between this barrel and the modules it re-exports).
export { HEJBRO_SNAPSHOT_VERSION } from "./snapshot/snapshot";
