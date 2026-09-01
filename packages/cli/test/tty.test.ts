import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	colorize,
	resolveStrictMode,
	shouldUseColor,
	shouldUseLinks,
} from "../src/tty";

describe("tty.ts", () => {
	const originalIsTTY = process.stdout.isTTY;
	const originalNoColor = process.env.NO_COLOR;

	afterEach(() => {
		process.stdout.isTTY = originalIsTTY;
		if (originalNoColor === undefined) {
			delete process.env.NO_COLOR;
		} else {
			process.env.NO_COLOR = originalNoColor;
		}
	});

	describe("shouldUseColor", () => {
		it("true in an interactive terminal with NO_COLOR unset", () => {
			process.stdout.isTTY = true;
			delete process.env.NO_COLOR;
			expect(shouldUseColor()).toBe(true);
		});

		it("false when not a TTY", () => {
			process.stdout.isTTY = false;
			delete process.env.NO_COLOR;
			expect(shouldUseColor()).toBe(false);
		});

		it("false when NO_COLOR is set, even in a TTY", () => {
			process.stdout.isTTY = true;
			process.env.NO_COLOR = "1";
			expect(shouldUseColor()).toBe(false);
		});
	});

	describe("shouldUseLinks", () => {
		beforeEach(() => {
			process.stdout.isTTY = true;
			delete process.env.NO_COLOR;
		});

		it("--links always plain, regardless of TTY/NO_COLOR", () => {
			expect(shouldUseLinks(true)).toBe("plain");
			process.stdout.isTTY = false;
			expect(shouldUseLinks(true)).toBe("plain");
			process.env.NO_COLOR = "1";
			expect(shouldUseLinks(true)).toBe("plain");
		});

		it("--no-links always none, even in an interactive terminal", () => {
			expect(shouldUseLinks(false)).toBe("none");
		});

		it("no flag, interactive terminal, NO_COLOR unset: osc8", () => {
			expect(shouldUseLinks(undefined)).toBe("osc8");
		});

		it("no flag, not a TTY: none", () => {
			process.stdout.isTTY = false;
			expect(shouldUseLinks(undefined)).toBe("none");
		});

		it("no flag, NO_COLOR set: none", () => {
			process.env.NO_COLOR = "1";
			expect(shouldUseLinks(undefined)).toBe("none");
		});
	});

	describe("resolveStrictMode", () => {
		beforeEach(() => {
			process.stdout.isTTY = true;
			delete process.env.NO_COLOR;
		});

		it("--strict always true, even in an interactive terminal", () => {
			expect(resolveStrictMode(true)).toBe(true);
			process.stdout.isTTY = false;
			expect(resolveStrictMode(true)).toBe(true);
		});

		it("--no-strict always false, even when not a TTY", () => {
			process.stdout.isTTY = false;
			expect(resolveStrictMode(false)).toBe(false);
		});

		it("no flag, not a TTY (piped/CI): true — nobody is there to notice a warning", () => {
			process.stdout.isTTY = false;
			expect(resolveStrictMode(undefined)).toBe(true);
		});

		it("no flag, interactive terminal: false — a developer sees the warning live", () => {
			expect(resolveStrictMode(undefined)).toBe(false);
		});
	});

	describe("colorize", () => {
		it("wraps text in the color's ANSI code and a trailing reset", () => {
			expect(colorize("+ added", "green")).toBe("\x1b[32m+ added\x1b[0m");
			expect(colorize("~ changed", "yellow")).toBe("\x1b[33m~ changed\x1b[0m");
			expect(colorize("- removed", "red")).toBe("\x1b[31m- removed\x1b[0m");
		});
	});
});
