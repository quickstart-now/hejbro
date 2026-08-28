-- hejbro migration
-- + table app.task_tags [new]
-- parent-snapshot: sha256:faa32666d414a8c6bd6bd8256650b264717bbcc6da7b169d8d6760008f3974e0
-- snapshot: sha256:cfc7d992c274fd00785a3c65ca161b983f3e93ea075f02f2ad4e17e21932fb08

create table "app"."task_tags" (
	"task_id" uuid not null,
	"tag_label" text not null,
	constraint "task_tags_pkey" primary key ("task_id")
);

grant select on all tables in schema "app" to "app_auditor";

grant select on all tables in schema "app" to "app_reader";

grant select, insert, update, delete on all tables in schema "app" to "app_writer";

alter table "app"."task_tags" add constraint "task_tags_task_id_fk" foreign key ("task_id") references "app"."tasks" ("id") on delete cascade;
