# hejbro

> hej (Swedish: "hello") + bro (Swedish: "bridge") — hello, bridge.

**TypeScript-native Postgres schema & RPC management.** Declare everything in
your database — tables, RLS policies, functions, triggers, views, grants — in
TypeScript, and generate deterministic migration SQL from the diff.

hejbro is the safe middle ground between letting an AI touch your database
directly (MCP) and writing raw SQL by hand: everything is code, every change
is a reviewable, generated migration.

```ts
export const publishPost = defineFunction("ddland", "publish_post", {
	args: { postId: uuid() },
	returns: posts,
	security: "definer",
	grants: ["authenticated"],
}, (ctx, { postId }) => {
	const post = ctx.row(select(posts).where(eq(posts.id, postId)));
	ctx.if(isNotNull(post.publishedAt), () => {
		ctx.raise("already published: %", postId);
	});
	ctx.return(
		update(posts).set({ publishedAt: now() }).where(eq(posts.id, postId)).returning()
	);
});
```

## Status

**Pre-alpha — under active design and development. Nothing is published yet.**

- Design spec: [`docs/specs/2026-08-19-hejbro-design.md`](docs/specs/2026-08-19-hejbro-design.md)
- Roadmap: [`docs/plans/2026-08-19-roadmap.md`](docs/plans/2026-08-19-roadmap.md)

## Packages

| Package | Role |
|---------|------|
| `hejbro` | User-facing package: the DSL + CLI (`hejbro init`, `hejbro generate`) |
| `@hejbro/core` | Declaration model, builder DSL, compiler, snapshot & diff engine (pure) |
| `@hejbro/supabase` | Supabase provider preset (auth helpers, storage buckets, role presets) |
| `@hejbro/skills` | Agent skills that teach coding agents the hejbro workflow |

Generic Postgres at the core; provider presets for Supabase first, with Neon
and Nile planned on the same extension interface.

## Built AI-natively

This project is developed by AI agents (Claude Code), openly: the design
specs, decision logs, and implementation plans in `docs/` are the actual
artifacts the agents work from — not documentation written after the fact.

## License

[MIT](LICENSE)
