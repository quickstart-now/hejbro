-- hejbro migration
-- + table app.task_tags [new]
-- parent-snapshot: sha256:cb5a16fd5538b0f682f7e3ef60b9715085521c8f24d016fea110dc6e4a88f4d6
-- snapshot: sha256:f69dd8c5f5beb0c7bd031c9db670749f9cc795a395573894a7d080ca664f7f43

create table "app"."task_tags" (
	"task_id" uuid not null,
	"tag_label" text not null,
	constraint "task_tags_pkey" primary key ("task_id")
);

grant select on all tables in schema "app" to "app_auditor";

grant select on all tables in schema "app" to "app_reader";

grant select, insert, update, delete on all tables in schema "app" to "app_writer";

alter table "app"."task_tags" add constraint "task_tags_task_id_fk" foreign key ("task_id") references "app"."tasks" ("id") on delete cascade;
