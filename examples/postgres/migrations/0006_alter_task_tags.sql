-- hejbro migration
-- ~ table app.task_tags [column "tag_label" changed]
-- parent-snapshot: sha256:2ed61dceb2f146922c4e523dc04f28383075255c668ead883fbb77ada28f3405
-- snapshot: sha256:3136a801e3684b9c7861e43e480304cdd0587eed3c6622bed8ad56e769f89f63

alter table "app"."task_tags" drop constraint "task_tags_pkey";

alter table "app"."task_tags" add constraint "task_tags_pkey" primary key ("task_id", "tag_label");
