-- hejbro migration
-- ~ table app.task_tags [column "tag_label" changed]
-- parent-snapshot: sha256:f69dd8c5f5beb0c7bd031c9db670749f9cc795a395573894a7d080ca664f7f43
-- snapshot: sha256:c1217289b04e0954b7f107e41de0474732f18cb653e82861f30ffb5137c9e0d4

alter table "app"."task_tags" drop constraint "task_tags_pkey";

alter table "app"."task_tags" add constraint "task_tags_pkey" primary key ("task_id", "tag_label");
