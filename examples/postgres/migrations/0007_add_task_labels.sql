-- hejbro migration
-- hejbro: 0.0.0
-- + table app.task_labels [new]
-- + rls app.task_labels [new]
-- + policy app.task_labels.task_labels_read_all [new]
-- + policy app.task_labels.task_labels_write_all [new]
-- parent-snapshot: sha256:7432c8fa278805229b846587f6b3b5aec33bc47618668a2fc198460945815590
-- snapshot: sha256:9daab0d9595c0e4be815c3942a8a5548e610665af5b537f66df2d5decc0b1dda

create table "app"."task_labels" (
	"id" uuid not null default gen_random_uuid(),
	"task_id" uuid not null,
	"label" text not null,
	constraint "task_labels_pkey" primary key ("id")
);

grant select on all tables in schema "app" to "app_auditor";

grant select on all tables in schema "app" to "app_reader";

grant select, insert, update, delete on all tables in schema "app" to "app_writer";

alter table "app"."task_labels" enable row level security;

drop policy if exists "task_labels_read_all" on "app"."task_labels";

create policy "task_labels_read_all" on "app"."task_labels" for select to "app_reader" using (true);

drop policy if exists "task_labels_write_all" on "app"."task_labels";

create policy "task_labels_write_all" on "app"."task_labels" for all to "app_writer" using (true) with check (true);

alter table "app"."task_labels" add constraint "task_labels_task_id_fk" foreign key ("task_id") references "app"."tasks" ("id") on delete cascade;
