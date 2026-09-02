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
 * Not shared with `packages/cli/test/docker-volumes.ts`'s own copy --
 * a test-only fix has no reason to add a new workspace dependency
 * between two otherwise-unrelated packages.
 */
export const removeContainer = (container: string): void => {
	const mounted = mountedVolumeNames(container);
	execFileSync("docker", ["rm", "-f", "-v", container], { stdio: "ignore" });
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
