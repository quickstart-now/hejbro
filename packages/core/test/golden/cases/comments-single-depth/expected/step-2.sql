-- hejbro migration
-- + trigger ddland.comments.comments_single_depth [new]
-- - trigger ddland.comments.comments_single_depth [dropped]

drop trigger if exists "comments_single_depth" on "ddland"."comments";

create trigger "comments_single_depth"
	before insert on "ddland"."comments"
	for each row execute function "ddland"."comments_enforce_single_depth"();

drop trigger if exists "comments_single_depth" on "ddland"."comments";