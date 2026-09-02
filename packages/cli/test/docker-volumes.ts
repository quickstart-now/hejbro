import { execFileSync } from "node:child_process";

/**
 * The volume names one container's own mounts carry -- read *before*
 * removal, since `docker inspect` on a container `rm -f` already
 * deleted answers nothing. A bind mount's own `.Name` is empty (it has
 * no volume identity of its own), so only real named/anonymous volumes
 * ever appear here.
 */
const mountedVolumeNames = (container: string): ReadonlyArray<string> =>
	execFileSync(
		"docker",
		["inspect", "--format", "{{range .Mounts}}{{.Name}} {{end}}", container],
		{ encoding: "utf-8" },
	)
		.trim()
		.split(/\s+/)
		.filter((name) => name.length > 0);

/**
 * `null` when `docker inspect` itself fails (a stopped/already-gone
 * container, a transient Docker error) -- never let that abort the
 * removal below (#709 R2: the whole point of this file is a cleanup
 * step that must not skip its own cleanup because a *different* step
 * failed first).
 */
const mountedVolumeNamesOrNull = (
	container: string,
): ReadonlyArray<string> | null => {
	try {
		return mountedVolumeNames(container);
	} catch {
		return null;
	}
};

const existingVolumeNames = (): ReadonlyArray<string> =>
	execFileSync("docker", ["volume", "ls", "-q"], { encoding: "utf-8" })
		.split("\n")
		.filter((name) => name.length > 0);

/**
 * #709: `docker rm -f <container>` (no `-v`) freed the container but
 * left the official `postgres` image's own declared
 * `VOLUME /var/lib/postgresql/data` behind as an orphaned anonymous
 * volume -- every integration witness's own `afterAll` did this, and
 * the accumulation (1,418 volumes, 84 GB) ate the shared Docker data
 * disk (round 4, D106). `-v` on `rm` frees the volume too; this checks
 * that it actually happened, since the flag's own success is silent —
 * the volume names this container's own mounts carried, read before
 * removal, must all be gone from `docker volume ls` right after.
 * Naming both the leftover volumes and the container on failure is
 * half this check's value: "what's left, and from where" is exactly
 * what `docker rm -f -v` itself never tells you.
 *
 * `docker inspect` runs *before* `rm`, so its own failure must never
 * skip the removal it precedes -- `mountedVolumeNamesOrNull` swallows
 * that one failure into `null`, but this function does not swallow it
 * a second time: `rm -f -v` still runs either way, and a `null` read
 * is reported afterward (not silently passed) as its own failure,
 * since the volume attribution this function exists to prove was
 * never actually checked.
 */
export const removeContainer = (container: string): void => {
	const mounted = mountedVolumeNamesOrNull(container);
	execFileSync("docker", ["rm", "-f", "-v", container], { stdio: "ignore" });
	if (mounted === null) {
		throw new Error(
			`docker inspect failed for container "${container}" before it was removed -- it was still removed (rm -f -v), but its volumes were never confirmed freed. Next: check \`docker volume ls -qf dangling=true\` by hand.`,
		);
	}
	if (mounted.length === 0) {
		return;
	}
	const remaining = new Set(existingVolumeNames());
	const stillPresent = mounted.filter((name) => remaining.has(name));
	if (stillPresent.length === 0) {
		return;
	}
	throw new Error(
		`docker rm -f -v "${container}" did not remove its own volume(s): ${stillPresent.join(", ")}. Next: check \`docker volume rm ${stillPresent.join(" ")}\` by hand.`,
	);
};
