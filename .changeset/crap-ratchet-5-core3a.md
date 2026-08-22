---
"@hejbro/core": patch
"hejbro": patch
"@hejbro/supabase": patch
---

Internal refactor, no behavior change: lowers CRAP scores ahead of the
`CRAP_THRESHOLD = 5` ratchet (#154), continuing #241's slice split. Ten
`@hejbro/core` functions the ratchet-5 measurement found over the new
threshold — `validateFormatVersion` (`snapshot/snapshot.ts`),
`retargetColumnRef`/`retargetSelectNode` (`expr/retarget.ts`),
`encodeLiteral`/`decodeLiteral`/`decodeProjection` (`expr/codec.ts`),
`liftLiteral`/`renderLiteral` (`expr/literal.ts`), `recordReturn`
(`plpgsql/body-context.ts`), `renderStatementLines`
(`plpgsql/render-body.ts`) — are now built on a `.some()`/`.every()`
over-an-array dispatch or a closed handler map instead of an `if`/`||`
chain or a `switch`, mirroring the technique #154 PR2 and #241 already
used elsewhere. Several (`encodeLiteral`, `decodeProjection`,
`renderLiteral`, `renderStatementLines`) close a coverage gap no test
could ever have closed the other way: their former `switch`'s `default:
assertNever(...)` branch was structurally unreachable. The rest needed
test coverage only, no code change (`decodeLiteral`'s malformed-input
fallback, `liftLiteral`'s unsupported-JS-type fallback, `recordReturn`'s
insert/delete-returning-query branches).
