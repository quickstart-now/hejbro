-- hejbro migration
-- ~ table app.task_tags [column "tag_label" changed]
-- parent-snapshot: sha256:cfc7d992c274fd00785a3c65ca161b983f3e93ea075f02f2ad4e17e21932fb08
-- snapshot: sha256:9921dbfb1a4510b6e445d93fe644c1b56a16cce7c886633db7c9d79dac09f43e

alter table "app"."task_tags" drop constraint "task_tags_pkey";

alter table "app"."task_tags" add constraint "task_tags_pkey" primary key ("task_id", "tag_label");
