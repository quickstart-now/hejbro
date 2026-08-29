/**
 * Set-operation result typing (add-set-operations, D103 decision 4) — moved
 * to `@hejbro/core` (add-ctes, task 6.5): the subject (whether two
 * `SelectProjection` shapes are union-compatible) is core vocabulary, and a
 * recursive CTE's anchor/recursive-term pair (core, `with.ts`) needs the
 * exact same rule this package's chain typing already had. Re-exported
 * unchanged so this package's own `SetOpResult` name and behavior are
 * untouched — no surface change here, only its definition's home moved.
 */
export type { SetOpResult } from "@hejbro/core";
