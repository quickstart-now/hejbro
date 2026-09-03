-- hejbro migration
-- hejbro: 0.0.0
-- + table app.task_labels [new]
-- + rls app.task_labels [new]
-- + policy app.task_labels.task_labels_read_all [new]
-- + policy app.task_labels.task_labels_write_all [new]
-- parent-snapshot: sha256:ae787cd5c618628c49cefa555f95e53be583460f309e47ee1776f2fa8ac9d6ce
-- snapshot: sha256:22797d90405a12af7a8436bd80cc6ce64e3e6fe15389d6a32e2645ba085f59c4

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
