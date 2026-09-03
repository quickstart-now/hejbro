-- hejbro migration
-- + schema app [new]
-- + table app.posts [new]
-- + table app.comments [new]

create schema "app";

create table "app"."posts" (
	"id" uuid not null default gen_random_uuid(),
	"status" text not null,
	"slug" text not null,
	constraint "posts_pkey" primary key ("id"),
	constraint "posts_status_check" check ("posts"."status" in ('draft', 'published')),
	constraint "posts_slug_format_check" check ("posts"."slug" ~ '^[a-z0-9-]+$')
);

create table "app"."comments" (
	"id" uuid not null default gen_random_uuid(),
	"post_id" uuid not null,
	"parent_id" uuid,
	"body" text not null,
	constraint "comments_pkey" primary key ("id"),
	constraint "comments_body_length_check" check (length("comments"."body") > 0)
);

alter table "app"."comments" add constraint "comments_parent_id_fk" foreign key ("parent_id") references "app"."comments" ("id") on delete cascade;

alter table "app"."comments" add constraint "comments_post_id_fk" foreign key ("post_id") references "app"."posts" ("id") on delete set null on update cascade;
