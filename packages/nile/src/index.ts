/**
 * Public entry surface for `@hejbro/nile` (task 1.1/1.2, #563). The
 * preset bundle (`nilePreset`) is registrable from the moment this
 * package ships -- `kinds`/`validators` start empty (this group's own
 * job) and group 4 (#566) attaches the platform-refusal validators
 * additively, never by replacing this file's own export.
 *
 * `nileDriver` (group 2, #564) and `asTenant` (group 3, #565) join here
 * additively -- found missing at G6's own doc-snippet compile gate
 * (`packages/skills/test/snippet-compile.test.ts`): neither group's own
 * task list named this file, so the decorator and the context builder
 * existed in `src/` but were never reachable from outside the package.
 * Without this, `@hejbro/nile` shipped a registrable preset with no way
 * to actually build a driver or a context against it.
 */

export { asTenant } from "./context";
export { nileDriver } from "./driver";
export { nilePreset } from "./preset";
