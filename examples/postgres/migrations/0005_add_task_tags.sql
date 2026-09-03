-- hejbro migration
-- + table app.task_tags [new]
-- parent-snapshot: sha256:5a435954c1ab476479edfb018a39f99a462c7fbeb0c618728512d13d0b5d53f2
-- snapshot: sha256:4ac9a1ec44291a7ded022df202921df38801b3d45d98cc3e623dfd4181c89761

create table "app"."task_tags" (
	"task_id" uuid not null,
	"tag_label" text not null,
	constraint "task_tags_pkey" primary key ("task_id")
);

grant select on all tables in schema "app" to "app_auditor";

grant select on all tables in schema "app" to "app_reader";

grant select, insert, update, delete on all tables in schema "app" to "app_writer";

alter table "app"."task_tags" add constraint "task_tags_task_id_fk" foreign key ("task_id") references "app"."tasks" ("id") on delete cascade;
