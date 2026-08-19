-- hejbro migration
-- ~ function ddland.comments_enforce_single_depth [body changed]

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
		raise exception '부모 댓글을 찾을 수 없습니다 (parent_id=%)', new.parent_id;
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