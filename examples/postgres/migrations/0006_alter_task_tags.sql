-- hejbro migration
-- ~ table app.task_tags [column "tag_label" changed]
-- parent-snapshot: sha256:903e4f0f5dfabe1f8110ff89fecc60cccb209ee9e472f55b07d86bce18b5a2d9
-- snapshot: sha256:7432c8fa278805229b846587f6b3b5aec33bc47618668a2fc198460945815590

alter table "app"."task_tags" drop constraint "task_tags_pkey";

alter table "app"."task_tags" add constraint "task_tags_pkey" primary key ("task_id", "tag_label");
