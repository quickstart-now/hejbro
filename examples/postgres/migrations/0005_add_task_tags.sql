-- hejbro migration
-- + table app.task_tags [new]
-- parent-snapshot: sha256:a61bf4eeabff25fc69cb1cf000726a61520c24957f2fc53534d9074ff34ce578
-- snapshot: sha256:2ed61dceb2f146922c4e523dc04f28383075255c668ead883fbb77ada28f3405

create table "app"."task_tags" (
	"task_id" uuid not null,
	"tag_label" text not null,
	constraint "task_tags_pkey" primary key ("task_id")
);

alter table "app"."task_tags" add constraint "task_tags_task_id_fk" foreign key ("task_id") references "app"."tasks" ("id") on delete cascade;
