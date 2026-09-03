import { count, desc, eq, over, rank, select } from "hejbro";
import { members, projects, tasks } from "./app.schema";

/**
 * A reporting query, declared and compiled from the user's seat (#474 3.2):
 * for every project, its owner's display name and its task count, ranked
 * by task count — a join (`.innerJoin`/`.leftJoin`), an aggregate
 * (`count`), and a window function (`over(rank(), ...)`) in one query,
 * every one of them already-exported surface. `related()` is
 * deliberately not used here: it is declaratively impossible on the
 * current example schema (see #474's own follow-up), and this scenario
 * does not depend on it.
 *
 * `projects` owns exactly one `members` row (`ownerId`, `not null`), so
 * the owner join is `innerJoin`; a project can have zero tasks, so the
 * task join is `leftJoin` (an inner join would silently drop projects
 * with no tasks from the report).
 */
export const projectTaskReport = select(
	{
		projectId: projects.id,
		projectName: projects.name,
		ownerName: members.displayName,
		taskCount: count(tasks.id),
		taskCountRank: over(rank(), { orderBy: [desc(count(tasks.id))] }),
	},
	projects,
)
	.innerJoin(members, eq(members.id, projects.ownerId))
	.leftJoin(tasks, eq(tasks.projectId, projects.id))
	.groupBy(projects.id, projects.name, members.displayName);
