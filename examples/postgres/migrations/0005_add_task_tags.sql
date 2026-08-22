-- hejbro migration
-- + table app.task_tags [new]
-- parent-snapshot: sha256:0bdc80065c01a2baae3356c6a8c2bb153d33c809ce020a1efc6eb635cd58600e
-- snapshot: sha256:4fb0623cce0a72146a8e395b8284a2be10c4c8aa7702c11c43abb077fd7ac62a

create table "app"."task_tags" (
	"task_id" uuid not null,
	"tag_label" text not null,
	constraint "task_tags_pkey" primary key ("task_id")
);

grant select on all tables in schema "app" to "app_auditor";

grant select on all tables in schema "app" to "app_reader";

grant select, insert, update, delete on all tables in schema "app" to "app_writer";

alter table "app"."task_tags" add constraint "task_tags_task_id_fk" foreign key ("task_id") references "app"."tasks" ("id") on delete cascade;
