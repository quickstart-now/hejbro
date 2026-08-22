-- hejbro migration
-- ~ table app.task_tags [column "tag_label" changed]
-- parent-snapshot: sha256:4fb0623cce0a72146a8e395b8284a2be10c4c8aa7702c11c43abb077fd7ac62a
-- snapshot: sha256:98efec4dcbdf38a9f9636b413e4d5f251710b123e09e829b9c4b8d5b3e79670e

alter table "app"."task_tags" drop constraint "task_tags_pkey";

alter table "app"."task_tags" add constraint "task_tags_pkey" primary key ("task_id", "tag_label");
