-- hejbro migration
-- ~ trigger app.comments.comments_single_depth [trigger changed; recreating]

drop trigger "comments_single_depth" on "app"."comments";

create trigger "comments_single_depth"
	before insert on "app"."comments"
	for each row execute function "app"."comments_enforce_single_depth"();