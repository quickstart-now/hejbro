-- hejbro migration
-- hejbro: 0.1.1
-- + table app.task_status_audit [new]
-- + function app.audit_task_status_change [new]
-- + trigger app.tasks.audit_task_status_change [new]
-- parent-snapshot: sha256:bd8cf44733d36714c684932d8a182fe79fc07b0795d4ce3b847fabad19655840
-- snapshot: sha256:c794384bce2cba28686a600c9b07db61386a1062033c35c832ae2400e4bc6575

create table "app"."task_status_audit" (
	"id" uuid not null default gen_random_uuid(),
	"task_id" uuid not null,
	"old_status" text not null,
	"new_status" text not null,
	"changed_at" timestamp with time zone not null default now(),
	constraint "task_status_audit_pkey" primary key ("id")
);

grant select on all tables in schema "app" to "app_auditor";

grant select on all tables in schema "app" to "app_reader";

grant select, insert, update, delete on all tables in schema "app" to "app_writer";

create or replace function "app"."audit_task_status_change"()
returns trigger
language plpgsql
as $function$
begin
	insert into "app"."task_status_audit" ("task_id", "old_status", "new_status") values (new.id, old.status, new.status);
	return new;
end;
$function$;

drop trigger if exists "audit_task_status_change" on "app"."tasks";

create trigger "audit_task_status_change"
	after update of "status" on "app"."tasks"
	for each row execute function "app"."audit_task_status_change"();
