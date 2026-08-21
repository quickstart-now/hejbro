-- hejbro migration
-- + schema app [new]
-- + table app.comments [new]
-- + table app.posts [new]
-- + function app.comments_enforce_single_depth [new]
-- + trigger app.comments.comments_single_depth [new]

create schema "app";

create table "app"."comments" (
	"id" uuid not null default gen_random_uuid(),
	"post_id" uuid not null,
	"parent_id" uuid,
	"body" text not null,
	primary key ("id")
);

create table "app"."posts" (
	"id" uuid not null default gen_random_uuid(),
	"slug" text not null unique,
	"published_at" timestamp with time zone,
	primary key ("id")
);

create or replace function "app"."comments_enforce_single_depth"()
returns trigger
language plpgsql
as $function$
declare
	parent_post_id uuid;
	parent_parent_id uuid;
begin
	if new.parent_id is null then
		return new;
	end if;
	select "app"."comments"."post_id" as "post_id", "app"."comments"."parent_id" as "parent_id" into parent_post_id, parent_parent_id from "app"."comments" where "app"."comments"."id" = new.parent_id;
	if parent_post_id is null then
		raise exception 'Parent comment not found (parent_id=%)', new.parent_id;
	end if;
	if parent_parent_id is not null then
		raise exception 'Replies can only be nested one level deep (parent_id=%)', new.parent_id;
	end if;
	if parent_post_id <> new.post_id then
		raise exception 'A reply must belong to the same post as its parent (post_id=%, parent''s post_id=%)', new.post_id, parent_post_id;
	end if;
	return new;
end;
$function$;

drop trigger if exists "comments_single_depth" on "app"."comments";

create trigger "comments_single_depth"
	before insert or update of "parent_id", "post_id" on "app"."comments"
	for each row execute function "app"."comments_enforce_single_depth"();