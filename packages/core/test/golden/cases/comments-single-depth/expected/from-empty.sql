-- hejbro migration
-- + schema ddland [new]
-- + table ddland.comments [new]
-- + table ddland.posts [new]
-- + function ddland.comments_enforce_single_depth [new]
-- + trigger ddland.comments.comments_single_depth [new]

create schema "ddland";

create table "ddland"."comments" (
	"id" uuid not null default gen_random_uuid(),
	"post_id" uuid not null,
	"parent_id" uuid,
	"body" text not null,
	primary key ("id")
);

create table "ddland"."posts" (
	"id" uuid not null default gen_random_uuid(),
	"slug" text not null unique,
	"published_at" timestamp with time zone,
	primary key ("id")
);

create or replace function "ddland"."comments_enforce_single_depth"()
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
	select "ddland"."comments"."post_id" as "post_id", "ddland"."comments"."parent_id" as "parent_id" into parent_post_id, parent_parent_id from "ddland"."comments" where "ddland"."comments"."id" = new.parent_id;
	if parent_post_id is null then
		raise exception '부모 댓글을 찾을 수 없다 (parent_id=%)', new.parent_id;
	end if;
	if parent_parent_id is not null then
		raise exception '답글은 한 단계까지만 달 수 있다 (parent_id=%)', new.parent_id;
	end if;
	if parent_post_id <> new.post_id then
		raise exception '답글은 부모와 같은 글에 달아야 한다 (post_id=%, 부모의 post_id=%)', new.post_id, parent_post_id;
	end if;
	return new;
end;
$function$;

drop trigger if exists "comments_single_depth" on "ddland"."comments";

create trigger "comments_single_depth"
	before insert or update of "parent_id", "post_id" on "ddland"."comments"
	for each row execute function "ddland"."comments_enforce_single_depth"();