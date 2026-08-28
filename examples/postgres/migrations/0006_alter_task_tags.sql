-- hejbro migration
-- ~ table app.task_tags [column "tag_label" changed]
-- parent-snapshot: sha256:4ac9a1ec44291a7ded022df202921df38801b3d45d98cc3e623dfd4181c89761
-- snapshot: sha256:ae787cd5c618628c49cefa555f95e53be583460f309e47ee1776f2fa8ac9d6ce

alter table "app"."task_tags" drop constraint "task_tags_pkey";

alter table "app"."task_tags" add constraint "task_tags_pkey" primary key ("task_id", "tag_label");
