import { describe, expect, it } from "vitest";
import { assembleRerunCommand } from "../src/rerun";

describe("assembleRerunCommand", () => {
	it("renders a single new flag on one line when there are no other args", () => {
		expect(
			assembleRerunCommand([], ["--rename ddland.posts.slug=handle"]),
		).toBe("hejbro generate --rename ddland.posts.slug=handle");
	});

	it("preserves non-rename args in original order, then original rename flags in original order, before new flags", () => {
		const argv = [
			"--config",
			"db/hejbro.config.ts",
			"--name",
			"fix_blog",
			"--rename",
			"ddland.comments.body=content",
		];
		const rendered = assembleRerunCommand(argv, [
			"--rename ddland.posts.slug=handle",
		]);
		expect(rendered).toBe(
			[
				"hejbro generate \\",
				"  --config db/hejbro.config.ts \\",
				"  --name fix_blog \\",
				"  --rename ddland.comments.body=content \\",
				"  --rename ddland.posts.slug=handle",
			].join("\n"),
		);
	});

	it("sorts new flags by target identity (compareKeys order), independent of call order", () => {
		const rendered = assembleRerunCommand(
			[],
			[
				"--rename ddland.posts.slug=handle",
				"--rename ddland.posts.seo_title=meta_title",
			],
		);
		// "seo_title" < "slug" byte-wise, so it sorts first regardless of the
		// call order above.
		expect(rendered).toBe(
			[
				"hejbro generate \\",
				"  --rename ddland.posts.seo_title=meta_title \\",
				"  --rename ddland.posts.slug=handle",
			].join("\n"),
		);
	});

	it("mixes --rename and --confirm-drop new flags, sorted together by identity", () => {
		const rendered = assembleRerunCommand(
			[],
			[
				"--confirm-drop ddland.posts.slug",
				"--rename ddland.posts.seo_title=meta_title",
			],
		);
		// identity for --rename is the left-of-"=" side ("ddland.posts.seo_title"),
		// which sorts before the confirm-drop's whole value ("ddland.posts.slug").
		expect(rendered).toBe(
			[
				"hejbro generate \\",
				"  --rename ddland.posts.seo_title=meta_title \\",
				"  --confirm-drop ddland.posts.slug",
			].join("\n"),
		);
	});

	it("renders a bare 'hejbro generate' when there's nothing to preserve or add", () => {
		expect(assembleRerunCommand([], [])).toBe("hejbro generate");
	});
});
