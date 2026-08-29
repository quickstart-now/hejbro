import type { HejbroInput } from "../../../../src/index";
import { app, auditLog, auditPosts, posts } from "./declarations";

// Step 0: from empty — posts, audit_log, and the audit_posts trigger,
// whose body executes an insert for its side effect (#426) before
// returning the trigger row.

const fromEmpty: ReadonlyArray<HejbroInput> = [
	app,
	posts,
	auditLog,
	auditPosts,
];

export const steps: ReadonlyArray<ReadonlyArray<HejbroInput>> = [fromEmpty];
