-- hejbro migration
-- + table app.post_tags [new]

create table "app"."post_tags" (
	"post_id" uuid not null,
	"tag_slug" text not null,
	constraint "post_tags_pkey" primary key ("post_id")
);

alter table "app"."post_tags" add constraint "post_tags_post_id_fk" foreign key ("post_id") references "app"."posts" ("id");