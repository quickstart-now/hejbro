import { execFileSync } from "node:child_process";
import { eq, schema, select, table, uuid } from "@hejbro/core";
import type { CompileResult } from "@hejbro/query";
import { compile } from "@hejbro/query";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgDriver } from "../src/driver";

/**
 * Group 4's own measurement harness (no product code in this group,
 * tasks.md's own header) -- the session-path evidence group 5's
 * capability gate is conditioned on. Never runs under the default
 * `pnpm test`/CI (wired via `vitest.integration.config.ts`) --
 * local-only, `pnpm --filter @hejbro/pg test:integration`. Docker-gated:
 * `beforeAll` fails loudly (never a silent skip) when no daemon
 * answers, the same idiom this package's own
 * `test/integration.test.ts` uses. Run under an exclusive Docker window
 * (owner coordination) -- a timing figure taken while something else
 * competed for the machine does not announce itself as wrong, it just
 * reads as a slower number, so the window is part of the measurement
 * (recorded in `measurement.md`), not a note about it.
 *
 * The Docker harness below is a fourth independent copy of the same
 * boilerplate `packages/pg/test/integration.test.ts`,
 * `check-live.integration.test.ts`, and
 * `assert-schema-live.integration.test.ts` each already carry --
 * mirrored, never imported: none of the three prior copies is
 * exported, and there is no shared test-support module for it, so each
 * integration file owns its own setup (the same structural reason all
 * three state at their own top).
 *
 * "Independent run" (4.1) means a separate OS process, not a separate
 * `it()` in one process: five `it()`s in one vitest process would share
 * a warm connection pool, a warm query-plan cache, and a warm JIT --
 * every one of which would shrink the run-to-run spread the decision
 * rule's own denominator depends on, the same failure mode one layer up
 * from "within-run jitter is not run-to-run spread". The 4.1 `it()`
 * below is therefore an orchestrator: it shells out to `npx vitest`
 * five times, once per independent run, each spawning its own container
 * and its own connection, and reads each child's single measurement
 * back over stdout (`MEASUREMENT_MARKER`). Order is alternated between
 * runs (unnamed-then-prepared, then prepared-then-unnamed, ...) so a
 * warm-up advantage cannot accumulate on one shape.
 */
const IMAGE = process.env.HEJBRO_PG_IMAGE ?? "postgres:17";
const CONTAINER = `hejbro-pg-bench-${process.pid}`;
const MEASUREMENT_MARKER = "BENCH_MEASUREMENT_JSON:";
const REVERSE_ORDER_ENV = "HEJBRO_BENCH_REVERSE_ORDER";

const dockerAvailable = (): boolean => {
	try {
		execFileSync("docker", ["info"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
};

const sleepSync = (seconds: number): void => {
	execFileSync("sleep", [String(seconds)]);
};

/** Polls `pg_isready` over TCP -- mirrors `test/integration.test.ts`'s own `waitUntilReady`, including its own reasoning (the image's temporary bootstrap server answers ready on the Unix socket well before the host pool's TCP path has a listener). */
const waitUntilReady = (maxAttempts = 30): void => {
	const isReady = (): boolean => {
		try {
			execFileSync(
				"docker",
				[
					"exec",
					CONTAINER,
					"pg_isready",
					"-h",
					"127.0.0.1",
					"-U",
					"postgres",
					"-q",
				],
				{ stdio: "ignore" },
			);
			return true;
		} catch {
			return false;
		}
	};
	const attempt = (remaining: number): void => {
		if (isReady()) {
			return;
		}
		if (remaining <= 0) {
			throw new Error(
				`postgres in container "${CONTAINER}" never became ready. Next: check \`docker logs ${CONTAINER}\`.`,
			);
		}
		sleepSync(1);
		attempt(remaining - 1);
	};
	attempt(maxAttempts);
};

const discoverHostPort = (): number => {
	const output = execFileSync("docker", ["port", CONTAINER, "5432/tcp"], {
		encoding: "utf8",
	});
	const firstLine = output.trim().split("\n")[0];
	const lastColon = firstLine?.lastIndexOf(":");
	if (firstLine === undefined || lastColon === undefined || lastColon === -1) {
		throw new Error(
			`could not parse the host port docker mapped for container "${CONTAINER}" from: ${JSON.stringify(output)}`,
		);
	}
	return Number(firstLine.slice(lastColon + 1));
};

// --- measurement primitives ----------------------------------------------
//
// "Spread" here is the interquartile range (p75 - p25) -- robust to the
// occasional slow outlier a shared machine's scheduler produces, unlike
// a standard deviation or a bare min/max range, either of which one
// stalled sample would dominate. Used both within one run's own 1000
// samples (4.0, 4.2) and across independent runs' own median figures
// (4.1's cross-run spread, the decision rule's actual denominator).

type Stats = {
	readonly n: number;
	readonly medianMs: number;
	readonly spreadMs: number;
};

const percentile = (sorted: ReadonlyArray<number>, p: number): number => {
	const index = (sorted.length - 1) * p;
	const lowerIndex = Math.floor(index);
	const upperIndex = Math.ceil(index);
	const lower = sorted[lowerIndex] ?? 0;
	const upper = sorted[upperIndex] ?? lower;
	const weight = index - lowerIndex;
	return lower + (upper - lower) * weight;
};

const statsOf = (samplesMs: ReadonlyArray<number>): Stats => {
	const sorted = [...samplesMs].sort((a, b) => a - b);
	return {
		n: samplesMs.length,
		medianMs: percentile(sorted, 0.5),
		spreadMs: percentile(sorted, 0.75) - percentile(sorted, 0.25),
	};
};

/** `values` split into `groups` equal-sized chunks, each reduced to its own median -- how 4.0 turns one workload's raw samples into several independent-ish estimates of its own typical value, the same shape 4.1's per-run medians take, so 4.0's own spread computation exercises the identical machinery. */
const groupMedians = (
	values: ReadonlyArray<number>,
	groups: number,
): ReadonlyArray<number> => {
	const size = Math.floor(values.length / groups);
	return Array.from(
		{ length: groups },
		(_, i) => statsOf(values.slice(i * size, (i + 1) * size)).medianMs,
	);
};

/** Runs `iterate` `n` times, sequentially (never `Promise.all` -- overlapping runs would measure concurrency, not per-call cost), timing each with `process.hrtime.bigint()`. Connection/session setup happens *before* this is called, in every site below -- never inside the timed window. */
const timeSequential = async (
	n: number,
	iterate: (i: number) => Promise<void>,
): Promise<ReadonlyArray<number>> => {
	const samples: number[] = [];
	for (let i = 0; i < n; i += 1) {
		const start = process.hrtime.bigint();
		await iterate(i);
		const end = process.hrtime.bigint();
		samples.push(Number(end - start) / 1_000_000);
	}
	return samples;
};

const ITERATIONS = 1000;

// --- the decision rule, as one pure function ------------------------------
//
// Owner decision (group 4 header, tightened after review): ships only
// if the improvement exceeds twice the run-to-run spread AND is at
// least 5% of the median -- and "the spread" is not one estimator's
// word alone. Whichever of IQR, MAD, standard deviation, or range is
// used changes whether "twice the spread" is cleared when the effect
// sits close to the noise floor, so the rule is invariant: all four
// must independently clear the spread condition (the relative-
// improvement condition, being a plain percentage of the median, has
// no such ambiguity and is computed once). A single function both 4.0
// (sensitivity: does it correctly call a real, unmistakable gap
// significant, and a real absence of one insignificant?) and 4.1 (the
// actual verdict) call -- so a threshold mutation, or a same-workload
// mutation, reaches both the same way a verdict reached by eyeballing
// printed numbers never could.

const mean = (values: ReadonlyArray<number>): number =>
	values.reduce((sum, value) => sum + value, 0) / values.length;

const medianOf = (values: ReadonlyArray<number>): number =>
	statsOf(values).medianMs;

const iqrOf = (values: ReadonlyArray<number>): number =>
	statsOf(values).spreadMs;

const madOf = (values: ReadonlyArray<number>): number => {
	const centre = medianOf(values);
	return medianOf(values.map((value) => Math.abs(value - centre)));
};

const stdDevOf = (values: ReadonlyArray<number>): number => {
	if (values.length < 2) {
		return 0;
	}
	const centre = mean(values);
	const variance =
		values.reduce((sum, value) => sum + (value - centre) ** 2, 0) /
		(values.length - 1);
	return Math.sqrt(variance);
};

const rangeOf = (values: ReadonlyArray<number>): number =>
	Math.max(...values) - Math.min(...values);

export type SpreadEstimatorName = "iqr" | "mad" | "stdDev" | "range";

const SPREAD_ESTIMATORS: Readonly<
	Record<SpreadEstimatorName, (values: ReadonlyArray<number>) => number>
> = {
	iqr: iqrOf,
	mad: madOf,
	stdDev: stdDevOf,
	range: rangeOf,
};

const SPREAD_ESTIMATOR_NAMES = Object.keys(
	SPREAD_ESTIMATORS,
) as ReadonlyArray<SpreadEstimatorName>;

export type EstimatorResult = {
	readonly spreadMs: number;
	readonly spreadThresholdMs: number;
	readonly exceedsSpreadThreshold: boolean;
};

export type DecisionInput = {
	/** The per-run (4.1) or per-group (4.0) improvement samples -- never a single pre-reduced number, so every spread estimator below computes from the same real distribution. */
	readonly improvements: ReadonlyArray<number>;
	readonly medianMs: number;
	/** Defaults to 2 -- overridden only by 4.0's own threshold-mutation drill. */
	readonly spreadMultiplier?: number;
	/** Defaults to 5 (percent) -- overridden only by 4.0's own threshold-mutation drill. Percent, not a fraction (owner decision): the relative condition is already a percentage of the median. */
	readonly minRelativeImprovementPercent?: number;
};

export type Decision = {
	/** `true` only when the relative condition holds AND every one of the four spread estimators independently clears its own "twice the spread" condition (owner decision: invariance, not any single estimator's word). */
	readonly shipWorthy: boolean;
	readonly improvementMs: number;
	readonly relativeThresholdMs: number;
	readonly exceedsRelativeThreshold: boolean;
	readonly estimators: Readonly<Record<SpreadEstimatorName, EstimatorResult>>;
};

export const decide = (input: DecisionInput): Decision => {
	const improvementMs = medianOf(input.improvements);
	const spreadMultiplier = input.spreadMultiplier ?? 2;
	const relativeThresholdMs =
		input.medianMs * ((input.minRelativeImprovementPercent ?? 5) / 100);
	const exceedsRelativeThreshold = improvementMs >= relativeThresholdMs;

	const estimators = Object.fromEntries(
		SPREAD_ESTIMATOR_NAMES.map((name) => {
			const spreadMs = SPREAD_ESTIMATORS[name](input.improvements);
			const spreadThresholdMs = spreadMs * spreadMultiplier;
			return [
				name,
				{
					spreadMs,
					spreadThresholdMs,
					exceedsSpreadThreshold: improvementMs > spreadThresholdMs,
				},
			];
		}),
	) as Record<SpreadEstimatorName, EstimatorResult>;

	const shipWorthy =
		exceedsRelativeThreshold &&
		SPREAD_ESTIMATOR_NAMES.every(
			(name) => estimators[name].exceedsSpreadThreshold,
		);

	return {
		shipWorthy,
		improvementMs,
		relativeThresholdMs,
		exceedsRelativeThreshold,
		estimators,
	};
};

describe("prepared-statement bench / 4.0 instrument sensitivity", () => {
	let pool: Pool | undefined;
	let containerStarted = false;
	let hostPort: number | undefined;

	beforeAll(async () => {
		if (!dockerAvailable()) {
			throw new Error(
				"packages/pg's prepared-statement bench needs a running Docker daemon (Docker Desktop, or colima: `colima start`) -- `docker info` failed. Next: start Docker and re-run `pnpm --filter @hejbro/pg test:integration`.",
			);
		}
		execFileSync("docker", [
			"run",
			"-d",
			"--name",
			CONTAINER,
			"-e",
			"POSTGRES_PASSWORD=postgres",
			"-P",
			IMAGE,
		]);
		containerStarted = true;
		waitUntilReady();
		hostPort = discoverHostPort();
		pool = new Pool({
			host: "localhost",
			port: hostPort,
			user: "postgres",
			password: "postgres",
			database: "postgres",
		});
	}, 60_000);

	afterAll(async () => {
		await pool?.end();
		if (containerStarted) {
			execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
		}
	});

	it("the decision function, fed the harness's own real workloads, calls a manufactured gap significant and an absent one insignificant", async () => {
		const activePool = pool;
		if (activePool === undefined) {
			throw new Error("beforeAll did not set up the pool");
		}
		const client = await activePool.connect();
		try {
			// Both workloads go through the exact same timed harness
			// (`timeSequential` against a real connection) every other
			// task in this file uses -- a hand-built sample array would
			// verify the decision function alone, never the measurement
			// path a mis-timed window or a secretly-identical send could
			// still corrupt.
			const fast = await timeSequential(50, async () => {
				await client.query("select 1");
			});
			const slow = await timeSequential(50, async () => {
				await client.query("select pg_sleep(0.01)");
			});

			// Five groups of ten samples each, per workload -- the same
			// shape 4.1's per-run medians take (several independent-ish
			// estimates, not one pre-reduced number), so this exercises the
			// identical spread machinery 4.1's real verdict does.
			const fastGroups = groupMedians(fast, 5);
			const slowGroups = groupMedians(slow, 5);
			const realImprovements = slowGroups.map(
				(slowMedian, i) => slowMedian - (fastGroups[i] ?? 0),
			);
			const realGap = decide({
				improvements: realImprovements,
				medianMs: medianOf(fastGroups),
			});
			// An unmistakable, manufactured ~10ms gap: the decision
			// function must call this significant under the real rule.
			expect(realGap.shipWorthy).toBe(true);

			// The negative control, still from real harness data: `fast`
			// split into its own two independent-ish halves (odd/even
			// samples), so the "no gap" case is a real absence of a
			// difference within one workload's own noise, never a
			// hand-built zero.
			const fastOddGroups = groupMedians(
				fast.filter((_, i) => i % 2 === 1),
				5,
			);
			const fastEvenGroups = groupMedians(
				fast.filter((_, i) => i % 2 === 0),
				5,
			);
			const noGapImprovements = fastOddGroups.map(
				(value, i) => value - (fastEvenGroups[i] ?? 0),
			);
			const noGap = decide({
				improvements: noGapImprovements,
				medianMs: medianOf(fastGroups),
			});
			// The same function, on a real absence of a difference: must
			// call it insignificant. Together these two are what a
			// same-workload mutation (feeding `fast` for both sides above)
			// would collapse into one non-separating case.
			expect(noGap.shipWorthy).toBe(false);
		} finally {
			client.release();
		}
	}, 30_000);
});

describe("prepared-statement bench / measurement worker (spawned by 4.1, one independent run)", () => {
	let pool: Pool | undefined;
	let containerStarted = false;
	let hostPort: number | undefined;

	beforeAll(async () => {
		if (!dockerAvailable()) {
			throw new Error(
				"packages/pg's prepared-statement bench needs a running Docker daemon (Docker Desktop, or colima: `colima start`) -- `docker info` failed. Next: start Docker and re-run `pnpm --filter @hejbro/pg test:integration`.",
			);
		}
		execFileSync("docker", [
			"run",
			"-d",
			"--name",
			CONTAINER,
			"-e",
			"POSTGRES_PASSWORD=postgres",
			"-P",
			IMAGE,
		]);
		containerStarted = true;
		waitUntilReady();
		hostPort = discoverHostPort();
		pool = new Pool({
			host: "localhost",
			port: hostPort,
			user: "postgres",
			password: "postgres",
			database: "postgres",
		});
		const setupDriver = pgDriver(pool);
		await setupDriver.execute({
			sql: "create table bench_items (id integer primary key, value text not null)",
			params: [],
			kind: "sql",
		});
		await setupDriver.execute({
			sql: "insert into bench_items select g, 'row-' || g from generate_series(1, 1000) g",
			params: [],
			kind: "sql",
		});
	}, 60_000);

	afterAll(async () => {
		await pool?.end();
		if (containerStarted) {
			execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
		}
	});

	/**
	 * Only ever invoked directly (4.1's orchestrator spawns
	 * `npx vitest run ... -t "single measurement worker" --reporter=verbose`
	 * as a child process) -- also reachable from a plain, unfiltered
	 * `pnpm --filter @hejbro/pg test:integration`, where it simply
	 * contributes one more real measurement (harmless, not asserted on
	 * standalone; the orchestrator's own assertions are what matter).
	 */
	it("single measurement worker", async () => {
		const activePool = pool;
		if (activePool === undefined) {
			throw new Error("beforeAll did not set up the pool");
		}
		const client = await activePool.connect();
		try {
			const idFor = (i: number): number => (i % 1000) + 1;
			const measureUnnamed = () =>
				timeSequential(ITERATIONS, async (i) => {
					await client.query({
						text: "select value from bench_items where id = $1",
						values: [idFor(i)],
					});
				});
			const measurePrepared = () =>
				timeSequential(ITERATIONS, async (i) => {
					await client.query({
						name: "bench_prepared_select",
						text: "select value from bench_items where id = $1",
						values: [idFor(i)],
					});
				});

			const measureBothInOrder = async (
				reverseOrder: boolean,
			): Promise<readonly [ReadonlyArray<number>, ReadonlyArray<number>]> => {
				if (reverseOrder) {
					const prepared = await measurePrepared();
					const unnamed = await measureUnnamed();
					return [unnamed, prepared];
				}
				const unnamed = await measureUnnamed();
				const prepared = await measurePrepared();
				return [unnamed, prepared];
			};

			const reverseOrder = process.env[REVERSE_ORDER_ENV] === "1";
			const [unnamedSamples, preparedSamples] =
				await measureBothInOrder(reverseOrder);

			const unnamedStats = statsOf(unnamedSamples);
			const preparedStats = statsOf(preparedSamples);

			expect(unnamedStats.n).toBe(ITERATIONS);
			expect(preparedStats.n).toBe(ITERATIONS);

			console.log(
				`${MEASUREMENT_MARKER}${JSON.stringify({ reverseOrder, unnamedStats, preparedStats })}`,
			);
		} finally {
			client.release();
		}
	}, 120_000);
});

describe("prepared-statement bench / 4.1 prepared vs unnamed, session path", () => {
	const PackageRoot = new URL("..", import.meta.url).pathname;
	// The rule's own floor is 5; raised to 20 here after four independent
	// passes (two of 5, two of 10) straddled the decision boundary in
	// both directions (measurement.md records all four) -- the effect
	// sits close enough to it that neither 5 nor 10 runs was a stable
	// enough sample to answer from, empirically, on this machine, for
	// this workload. This is the final, largest pass; its own verdict is
	// reported as-is, not superseded by a fifth attempt.
	const IndependentRuns = 20;

	type RunResult = {
		readonly reverseOrder: boolean;
		readonly unnamedStats: Stats;
		readonly preparedStats: Stats;
	};

	const reverseOrderEnvValue = (reverseOrder: boolean): "1" | "0" => {
		if (reverseOrder) {
			return "1";
		}
		return "0";
	};

	const runIndependentMeasurement = (runIndex: number): RunResult => {
		const reverseOrder = runIndex % 2 === 1;
		const output = execFileSync(
			"npx",
			[
				"vitest",
				"run",
				"--config",
				"vitest.integration.config.ts",
				"test/prepared-statement.bench.integration.test.ts",
				"-t",
				"single measurement worker",
				// The default reporter buffers `console.log` and only ever
				// shows it for a failing test -- the marker line this
				// orchestrator parses back would silently vanish on every
				// passing child without this.
				"--reporter=verbose",
			],
			{
				cwd: PackageRoot,
				env: {
					...process.env,
					[REVERSE_ORDER_ENV]: reverseOrderEnvValue(reverseOrder),
				},
				encoding: "utf8",
				timeout: 120_000,
			},
		);
		const line = output
			.split("\n")
			.find((candidate) => candidate.startsWith(MEASUREMENT_MARKER));
		if (line === undefined) {
			throw new Error(
				`independent run ${runIndex} produced no measurement line. Full child output:\n${output}`,
			);
		}
		return JSON.parse(line.slice(MEASUREMENT_MARKER.length)) as RunResult;
	};

	it(
		"reports a median and a cross-run spread for both execution shapes, over independent process runs",
		() => {
			const runs = Array.from({ length: IndependentRuns }, (_, i) =>
				runIndependentMeasurement(i),
			);

			expect(runs).toHaveLength(IndependentRuns);
			runs.forEach((run) => {
				expect(run.unnamedStats.n).toBe(ITERATIONS);
				expect(run.preparedStats.n).toBe(ITERATIONS);
			});

			const unnamedMedians = runs.map((run) => run.unnamedStats.medianMs);
			const preparedMedians = runs.map((run) => run.preparedStats.medianMs);
			const improvements = runs.map(
				(run) => run.unnamedStats.medianMs - run.preparedStats.medianMs,
			);

			const unnamedAcrossRuns = statsOf(unnamedMedians);

			const verdict = decide({
				improvements,
				medianMs: unnamedAcrossRuns.medianMs,
			});

			const orderLabel = (reverseOrder: boolean): string => {
				if (reverseOrder) {
					return "prepared-first";
				}
				return "unnamed-first";
			};

			console.log(
				"[4.1] command: pnpm --filter @hejbro/pg test:integration -- prepared-statement.bench",
			);
			runs.forEach((run, i) => {
				console.log(
					`[4.1] run ${i + 1}/${IndependentRuns} (order=${orderLabel(run.reverseOrder)}): unnamed median=${run.unnamedStats.medianMs.toFixed(4)}ms, prepared median=${run.preparedStats.medianMs.toFixed(4)}ms, improvement=${(run.unnamedStats.medianMs - run.preparedStats.medianMs).toFixed(4)}ms`,
				);
			});
			console.log(
				`[4.1] across ${IndependentRuns} independent runs: unnamed median-of-medians=${unnamedAcrossRuns.medianMs.toFixed(4)}ms, improvement median=${verdict.improvementMs.toFixed(4)}ms`,
			);
			SPREAD_ESTIMATOR_NAMES.forEach((name) => {
				const estimator = verdict.estimators[name];
				console.log(
					`[4.1] spread estimator ${name}: spread=${estimator.spreadMs.toFixed(4)}ms threshold(2x)=${estimator.spreadThresholdMs.toFixed(4)}ms exceeds=${estimator.exceedsSpreadThreshold}`,
				);
			});
			console.log(`[4.1] decision: ${JSON.stringify(verdict)}`);

			expect(unnamedMedians).toHaveLength(IndependentRuns);
			expect(preparedMedians).toHaveLength(IndependentRuns);
			expect(typeof verdict.shipWorthy).toBe("boolean");
			// The relative-comparison collapse 4.2's own review finding
			// named: if the two shapes secretly sent the same wire message
			// (prepared silently ignored, or both unnamed), every run's
			// medians would coincide and `shipWorthy: false` alone would
			// read as an honest miss rather than a broken measurement. This
			// does not assert *how much* they differ (that is 4.1's own
			// empirical question) -- only that they are not literally the
			// same sequence.
			expect(unnamedMedians).not.toEqual(preparedMedians);
		},
		15 * 60_000,
	);
});

/**
 * Cross-pass pooled analysis (Docker-free -- pure arithmetic over already-
 * collected data, no `beforeAll`/container needed). 4.1's own `describe`
 * above was run five separate times (owner-coordinated escalation: the
 * rule's floor is 5, two passes each of 5/10 straddled the boundary, a
 * fifth pass at 20 was run to try to settle it) -- naming them A-E here.
 * Each pass's raw per-run `unnamed median=`/`improvement=` lines were
 * captured verbatim to a log file and are transcribed below as literal
 * constants, one-for-one, in run order, from:
 *
 *   Pass A (N=5):  /tmp/bench-41-real3.log
 *   Pass B (N=5):  /tmp/bench-41-real4.log
 *   Pass C (N=10): /tmp/bench-41-final.log
 *   Pass D (N=10): /tmp/bench-41-final2.log
 *   Pass E (N=20): /tmp/bench-41-FINAL20.log
 *
 * extracted by `grep "unnamed median=" <file>`, re-verified against the
 * log files a second time (byte-identical) immediately before writing
 * this block -- never retyped from memory or from an earlier summary.
 *
 * Owner-ratified framing (the point of this block, and the reason it
 * exists at all): a single "final" pass was previously picked (Pass E,
 * as "the largest, most stable") and reported as authoritative -- ruled
 * a selection-after-seeing-results violation, structurally identical to
 * the earlier 4-to-8-run escalation the owner had already flagged. No
 * pass is singled out here. Two things are computed instead, both from
 * the one real `decide()` this file already defines (never a second,
 * doc-only reimplementation): (1) all 50 raw improvement samples pooled
 * into one array, `decide()` called on it exactly once -- the rule's
 * actual application, at its largest and most stable sample; (2) each
 * pass's own `decide()`, unpooled -- a robustness check, exposing
 * whether the verdict is stable across passes of the identical protocol.
 * `measurement.md` reports both, verbatim from this block's own console
 * output (never hand-typed), and draws its conclusion from whether (2)
 * agrees with itself, not from which pass "looks best".
 */
describe("prepared-statement bench / cross-pass pooled analysis (Docker-free, 5 prior passes)", () => {
	type Pass = {
		readonly name: string;
		readonly logFile: string;
		readonly unnamedMediansMs: ReadonlyArray<number>;
		readonly improvementsMs: ReadonlyArray<number>;
	};

	const Passes: ReadonlyArray<Pass> = [
		{
			name: "A",
			logFile: "/tmp/bench-41-real3.log",
			unnamedMediansMs: [0.8852, 0.8365, 0.8746, 0.869, 0.9148],
			improvementsMs: [0.0775, 0.015, 0.063, 0.0501, 0.1093],
		},
		{
			name: "B",
			logFile: "/tmp/bench-41-real4.log",
			unnamedMediansMs: [0.8832, 0.8569, 0.9038, 0.845, 0.8607],
			improvementsMs: [0.0567, 0.04, 0.092, 0.0264, 0.0752],
		},
		{
			name: "C",
			logFile: "/tmp/bench-41-final.log",
			unnamedMediansMs: [
				0.8913, 0.868, 0.9303, 0.8717, 0.8715, 0.856, 0.8503, 0.8662, 0.8573,
				0.8493,
			],
			improvementsMs: [
				0.0638, 0.0423, 0.0927, 0.0437, 0.0758, 0.0576, 0.0819, 0.0489, 0.07,
				0.0153,
			],
		},
		{
			name: "D",
			logFile: "/tmp/bench-41-final2.log",
			unnamedMediansMs: [
				0.8576, 0.8289, 0.871, 0.8264, 0.8677, 0.8509, 0.8639, 0.8235, 0.8521,
				0.8229,
			],
			improvementsMs: [
				0.0723, 0.043, 0.0716, 0.0396, 0.0905, 0.0462, 0.0928, 0.034, 0.0778,
				0.0335,
			],
		},
		{
			name: "E",
			logFile: "/tmp/bench-41-FINAL20.log",
			unnamedMediansMs: [
				0.8492, 0.8278, 0.8664, 0.8084, 0.845, 0.816, 0.8636, 0.843, 0.8505,
				0.8448, 0.8527, 0.8448, 0.8405, 0.86, 0.8477, 0.8424, 0.8501, 0.8473,
				0.8384, 0.8168,
			],
			improvementsMs: [
				0.079, 0.0639, 0.115, 0.0346, 0.0823, 0.0552, 0.0837, 0.0644, 0.0741,
				0.0675, 0.0918, 0.0301, 0.099, 0.039, 0.104, 0.0478, 0.0792, 0.0381,
				0.0919, 0.041,
			],
		},
	];

	const TotalRunsAcrossPasses = 50;

	it("pools all 50 raw runs and calls decide() once -- the rule's actual application", () => {
		expect(
			Passes.reduce((sum, pass) => sum + pass.improvementsMs.length, 0),
		).toBe(TotalRunsAcrossPasses);

		const pooledImprovements = Passes.flatMap((pass) => pass.improvementsMs);
		const pooledUnnamedMedians = Passes.flatMap(
			(pass) => pass.unnamedMediansMs,
		);

		// The defense this section exists to carry, named explicitly (owner
		// requirement): mirrors 4.1's own `expect(run.unnamedStats.n).toBe(
		// ITERATIONS)` -- the same class of silent-partial-loss bug the
		// vitest-reporter marker-drop trap produced (a *passing* child whose
		// marker line silently never reached stdout without
		// `--reporter=verbose`, with no other symptom) would, one layer up,
		// show up here as a pooled array shorter than 50 with nothing else
		// wrong. Asserting the count is what turns that into a loud failure.
		expect(pooledImprovements).toHaveLength(TotalRunsAcrossPasses);
		expect(pooledUnnamedMedians).toHaveLength(TotalRunsAcrossPasses);

		const pooledBaselineMedianMs = medianOf(pooledUnnamedMedians);
		const pooledVerdict = decide({
			improvements: pooledImprovements,
			medianMs: pooledBaselineMedianMs,
		});

		console.log(
			"[pooled] command: pnpm --filter @hejbro/pg test:integration -- prepared-statement.bench (this it(), Docker-free, over 5 prior passes' saved data)",
		);
		console.log(
			`[pooled] N=${pooledImprovements.length}, baseline unnamed median-of-medians=${pooledBaselineMedianMs.toFixed(6)}ms, improvement median=${pooledVerdict.improvementMs.toFixed(6)}ms, relative=${((pooledVerdict.improvementMs / pooledBaselineMedianMs) * 100).toFixed(4)}%, relative threshold(5%)=${pooledVerdict.relativeThresholdMs.toFixed(6)}ms, exceedsRelativeThreshold=${pooledVerdict.exceedsRelativeThreshold}`,
		);
		SPREAD_ESTIMATOR_NAMES.forEach((name) => {
			const estimator = pooledVerdict.estimators[name];
			console.log(
				`[pooled] spread estimator ${name}: spread=${estimator.spreadMs.toFixed(6)}ms threshold(2x)=${estimator.spreadThresholdMs.toFixed(6)}ms exceeds=${estimator.exceedsSpreadThreshold}`,
			);
		});
		console.log(`[pooled] decision: ${JSON.stringify(pooledVerdict)}`);

		// The verdict is reported, not asserted either way: the pre-
		// registered rule (fixed before any of these numbers existed) says
		// what ships, but this file's job is to compute and print the real
		// number, not to encode "must be false" as a test expectation --
		// that would make the test itself a second, silently-drifting copy
		// of the conclusion `measurement.md` states in prose.
		expect(typeof pooledVerdict.shipWorthy).toBe("boolean");
	});

	it("reports each pass's own decide() unpooled -- the robustness/instability check", () => {
		console.log(
			"[per-pass] command: pnpm --filter @hejbro/pg test:integration -- prepared-statement.bench (this it(), Docker-free, over 5 prior passes' saved data)",
		);
		const verdicts = Passes.map((pass) => {
			const baselineMedianMs = medianOf(pass.unnamedMediansMs);
			const verdict = decide({
				improvements: pass.improvementsMs,
				medianMs: baselineMedianMs,
			});
			console.log(
				`[per-pass] pass ${pass.name} (N=${pass.improvementsMs.length}, source=${pass.logFile}): baseline=${baselineMedianMs.toFixed(6)}ms, improvement median=${verdict.improvementMs.toFixed(6)}ms, relative=${((verdict.improvementMs / baselineMedianMs) * 100).toFixed(4)}%, shipWorthy=${verdict.shipWorthy}`,
			);
			SPREAD_ESTIMATOR_NAMES.forEach((name) => {
				const estimator = verdict.estimators[name];
				console.log(
					`[per-pass]   pass ${pass.name} estimator ${name}: spread=${estimator.spreadMs.toFixed(6)}ms threshold(2x)=${estimator.spreadThresholdMs.toFixed(6)}ms exceeds=${estimator.exceedsSpreadThreshold}`,
				);
			});
			return { name: pass.name, shipWorthy: verdict.shipWorthy };
		});
		console.log(
			`[per-pass] verdicts in pass order (A,B,C,D,E): ${JSON.stringify(verdicts.map((v) => v.shipWorthy))}`,
		);

		expect(verdicts).toHaveLength(Passes.length);
		// Not asserted as any particular pattern (same reasoning as the
		// pooled test above) -- printed so `measurement.md` can quote the
		// real, computed sequence rather than a hand-typed one.
	});
});

describe("prepared-statement bench / 4.2 compile cost, no I/O", () => {
	const app = schema("bench");
	const items = table(app, "items", { id: uuid().primaryKey() });
	const statement = select(items).where(
		eq(items.id, "00000000-0000-0000-0000-000000000000"),
	);

	it("reports the compile cost per execution", async () => {
		const recompiledSamples = await timeSequential(ITERATIONS, async () => {
			compile(statement);
		});

		const cached: CompileResult = compile(statement);
		const cachedReuseSamples = await timeSequential(ITERATIONS, async () => {
			void cached;
		});

		const recompiledStats = statsOf(recompiledSamples);
		const cachedStats = statsOf(cachedReuseSamples);

		console.log(
			"[4.2] command: pnpm --filter @hejbro/pg test:integration -- prepared-statement.bench",
		);
		console.log(
			`[4.2] recompile every call, n=${recompiledStats.n}: median=${recompiledStats.medianMs.toFixed(4)}ms spread=${recompiledStats.spreadMs.toFixed(4)}ms`,
		);
		console.log(
			`[4.2] reuse cached compile, n=${cachedStats.n}: median=${cachedStats.medianMs.toFixed(4)}ms spread=${cachedStats.spreadMs.toFixed(4)}ms`,
		);

		expect(recompiledStats.n).toBe(ITERATIONS);
		// A floor, not just a relative comparison to `cachedStats` (task
		// 4.2's own red proof: measuring a single compile outside the
		// timed loop instead of once per execution collapses the
		// recompile figure down to the same near-zero noise floor
		// `cachedStats` reports, which a merely relative "recompile >
		// cached" comparison would not reliably catch -- both sides
		// would be measuring the same near-nothing).
		expect(recompiledStats.medianMs).toBeGreaterThan(0.001);
		expect(cachedStats.medianMs).toBeLessThan(recompiledStats.medianMs);
	}, 30_000);
});
