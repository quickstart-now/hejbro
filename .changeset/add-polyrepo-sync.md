---
"hejbro": minor
---

Schema across repositories (#314): a schema repository commits an
export (`hejbro generate --export`) and a consuming repository vendors
it over git — `hejbro link <repository>` records the source, `hejbro
vendor` fetches one commit's export and writes `.hejbro/vendor/
{schema.json, snapshot.sql, contract.ts}` plus `hejbro.lock`, `hejbro
vendor --check` compares offline (CI's own gate), and `hejbro outdated`
reports staleness without failing. The generated `contract.ts` exports
a `Database` interface, `contractMetadata`, and `createDb(conn)` —
`@hejbro/query`'s new `createNameKeyedDb` binds a real, unmodified
`db()` handle to it, so a vendored contract queries exactly like a
locally declared schema (`select`/`insert`/`update`/`deleteFrom`,
`.where(eq(...))`, relations), with no `Table`-typed value anywhere in
its public surface. Ten named failures are each their own coded
diagnostic with its own remedy repository; `--strict`/`--no-strict`
(default: fail outside a TTY) governs the one situation still open to
judgement — a lock resolved from a non-default ref. A monorepo
consumer in the same workspace as the schema keeps using a plain
alias import instead — `link`/`vendor` are for an actual repository
boundary, including a locally cloned neighbor repository.
