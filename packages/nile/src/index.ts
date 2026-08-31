/**
 * Public entry surface for `@hejbro/nile` (task 1.1/1.2, #563). The
 * preset bundle (`nilePreset`) is registrable from the moment this
 * package ships -- `kinds`/`validators` start empty (this group's own
 * job) and group 4 (#566) attaches the platform-refusal validators
 * additively, never by replacing this file's own export.
 */
export { nilePreset } from "./preset";
