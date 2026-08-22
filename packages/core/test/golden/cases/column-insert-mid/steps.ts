import type { HejbroInput } from "../../../../src/index";
import {
	defineFunction,
	defineView,
	eq,
	integer,
	now,
	select,
	table,
	text,
	timestamptz,
	update,
	uuid,
} from "../../../../src/index";
import { app } from "./declarations";

// D81 acceptance case (#261). Step 0 (from-empty.sql) is this case's own
// *first* migration -- projects/archive_project/projects_v created fresh,
// so declaration order and physical order coincide (nothing to inherit
// from a parent yet). Steps 1-2 are what the case exists to prove: once a
// parent snapshot exists, a column inserted *mid-declaration* lands last
// in the table's physical order -- and archive_project's `returning` list
// and projects_v's `select` list follow that physical order, not
// declaration order, because both are re-resolved at snapshot-build time
// (D81), not frozen at DSL time the way they were before #261's fix.

// Step 0: initial -- projects(id, title, archivedAt), archive_project, projects_v.

const projectsV1 = table(app, "projects", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
	archivedAt: timestamptz(),
});

const archiveProjectV1 = defineFunction(
	"app",
	"archive_project",
	{ args: { projectId: uuid() }, returns: projectsV1 },
	(ctx, { projectId }) => {
		ctx.return(
			update(projectsV1)
				.set({ archivedAt: now() })
				.where(eq(projectsV1.id, projectId))
				.returning(),
		);
	},
);

const projectsVV1 = defineView(app, "projects_v", select(projectsV1));

const initial: ReadonlyArray<HejbroInput> = [
	app,
	projectsV1,
	archiveProjectV1,
	projectsVV1,
];

// Step 1: insertDescriptionMid -- `description` declared *between* `title`
// and `archivedAt`; the physical table already has `archived_at` before
// it (D81: existing columns keep the parent's order), so it's added last.

const projectsV2 = table(app, "projects", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
	description: text(),
	archivedAt: timestamptz(),
});

const archiveProjectV2 = defineFunction(
	"app",
	"archive_project",
	{ args: { projectId: uuid() }, returns: projectsV2 },
	(ctx, { projectId }) => {
		ctx.return(
			update(projectsV2)
				.set({ archivedAt: now() })
				.where(eq(projectsV2.id, projectId))
				.returning(),
		);
	},
);

const projectsVV2 = defineView(app, "projects_v", select(projectsV2));

const insertDescriptionMid: ReadonlyArray<HejbroInput> = [
	app,
	projectsV2,
	archiveProjectV2,
	projectsVV2,
];

// Step 2: insertLevelAppendNote -- `level` declared between `description`
// and `archivedAt`, `note` declared after `archivedAt`. Both are new to
// the parent, so both append, in declaration order between themselves
// (level, then note) -- which `diffByKey`'s alphabetical `added` order
// also happens to produce here, so the emitted `add column` order matches
// the snapshot order.

const projectsV3 = table(app, "projects", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
	description: text(),
	level: integer(),
	archivedAt: timestamptz(),
	note: text(),
});

const archiveProjectV3 = defineFunction(
	"app",
	"archive_project",
	{ args: { projectId: uuid() }, returns: projectsV3 },
	(ctx, { projectId }) => {
		ctx.return(
			update(projectsV3)
				.set({ archivedAt: now() })
				.where(eq(projectsV3.id, projectId))
				.returning(),
		);
	},
);

const projectsVV3 = defineView(app, "projects_v", select(projectsV3));

const insertLevelAppendNote: ReadonlyArray<HejbroInput> = [
	app,
	projectsV3,
	archiveProjectV3,
	projectsVV3,
];

export const steps: ReadonlyArray<ReadonlyArray<HejbroInput>> = [
	initial,
	insertDescriptionMid,
	insertLevelAppendNote,
];
