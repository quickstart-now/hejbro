-- hejbro migration
-- + table app.task_tags [new]
-- parent-snapshot: sha256:c5d3fb87403e1fcc6846a7a660d93dd874c9242ecebcbb0d77d3a22f73a83f42
-- snapshot: sha256:903e4f0f5dfabe1f8110ff89fecc60cccb209ee9e472f55b07d86bce18b5a2d9

create table "app"."task_tags" (
	"task_id" uuid not null,
	"tag_label" text not null,
	constraint "task_tags_pkey" primary key ("task_id")
);

grant select on all tables in schema "app" to "app_auditor";

grant select on all tables in schema "app" to "app_reader";

grant select, insert, update, delete on all tables in schema "app" to "app_writer";

alter table "app"."task_tags" add constraint "task_tags_task_id_fk" foreign key ("task_id") references "app"."tasks" ("id") on delete cascade;
