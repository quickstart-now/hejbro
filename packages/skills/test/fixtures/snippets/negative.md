# Negative fixture (meta test only)

This file exists solely to prove `snippet-check.ts`'s own failure paths
fire — it is not hejbro documentation, is never linked from `SKILL.md`,
and lives outside `skills/hejbro/` precisely so the real gate
(`snippet-compile.test.ts`) never scans it. Only
`snippet-check-negative.test.ts` reads this file.

## A type error with no directive token must be reported

```ts
const n: number = "not a number";
```

## An expect-error block that actually compiles cleanly must be reported

```ts expect-error
const n: number = 1;
```

## A no-check block is never type-checked, only allowlist-matched

```ts no-check=demo-reason
const n: number = "still broken, but excluded from type-check";
```

## A prelude is compiled in the same program as the snippet

```ts prelude=demo
const total: number = demoValue + 1;
```
