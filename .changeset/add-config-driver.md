---
"hejbro": minor
---

`hejbro.config.ts` can now name a `driver`: a factory from the resolved connection string to a contract driver, returned directly or as a promise. Every command that connects — `check`, `status`, `migrate`, `raise`, `reset`, `import` and `pull` — prefers the configured factory when one is set: it calls it once with the same string `--url`/`DATABASE_URL` already resolved, and `@hejbro/pg` is neither imported nor required on that path. A driver the factory returns that offers no way to close (`client.end`) is refused before any statement is sent, naming the `driver` field. Without a configured factory every command behaves exactly as it did before the field existed.
