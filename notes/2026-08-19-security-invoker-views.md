# security_invoker 뷰 — 뷰 하나로 RLS가 무효화되는 사고

> Phase 4 범위 결정 A7b의 배경 설명. 2026-08-19 오너 승인으로
> `defineView(…, { securityInvoker: true })` 옵션이 Phase 4에
> 포함되었다.

## 뷰는 "만든 사람"으로 실행된다

Postgres 뷰는 기본적으로 **뷰 소유자의 권한과 RLS 컨텍스트로**
실행된다(definer 의미론). 여기에 "테이블 소유자는 RLS를 기본으로
우회한다"는 규칙(→ [force row level
security](2026-08-19-force-row-level-security.md) 노트)이 결합하면
이런 폭탄이 된다:

```sql
-- posts에 RLS: 공개 글만 anon에게 보임 (정성껏 잘 설정했다)
alter table posts enable row level security;
create policy read_published on posts for select to anon
  using (published_at is not null);

-- 관리자(postgres)가 편의용 뷰를 하나 만들었다
create view recent_posts as
  select * from posts order by created_at desc limit 10;
grant select on recent_posts to anon;
```

이제 `anon`이 `posts`를 직접 조회하면 공개 글만 보이지만,
**`recent_posts`를 조회하면 비공개 글까지 전부 보인다.** 뷰가
소유자(postgres = posts의 소유자 = RLS 우회) 권한으로 실행되기
때문이다. 테이블에 걸어둔 RLS가 뷰 하나로 무효화됐다.

## Supabase에서 가장 유명한 사고 유형

Supabase 환경의 구조 — 테이블 소유자는 `postgres`, 뷰도 `postgres`가
생성, PostgREST가 뷰를 자동으로 API에 노출 — 가 정확히 이 폭탄의
조립 설명서다. 실제로 하도 자주 터져서 Supabase가 대시보드에
"Security Definer View" 보안 경고 린터를 내장했을 정도다.

Postgres 15에서 공식 해결책이 나왔다:

```sql
create view recent_posts with (security_invoker = true) as /* … */;
-- "조회하는 사람의 권한·RLS로 실행" → anon에게는 공개 글만
```

## hejbro에서의 표면

```ts
export const recentPosts = defineView(ddland, "recent_posts",
	select(posts).where(/* … */),
	{ securityInvoker: true });
```

방출: `create view … with (security_invoker = true) as …`. 옵션
토글은 `create or replace`로 처리 가능한 변경이라 diff 비용도 없다.

## 왜 기본값을 true로 강제하지 않는가

"이렇게 위험하면 hejbro가 기본값을 `true`로 강제하지 그래?"라는
질문이 자연스럽다. 결론은 **core는 중립(명시 옵션), Supabase
프리셋이 'RLS 테이블 위 뷰에 securityInvoker 없음 → 경고'를
담당**하는 분담이다.

- definer 의미론이 필요한 정당한 뷰도 있다 — 제한된 데이터의 집계만
  노출하는 뷰가 대표적이다.
- Postgres 15 미만에는 이 문법 자체가 없다. generic core가
  일방적으로 강제하면 하위 버전 사용자가 깨진다.
- provider의 의견은 프리셋에 담는다는 설계 원칙(스펙 §4.1)과도
  일치한다. 프리셋 경고는 Phase 6(Supabase preset)의 sub-issue로
  연결되어 있다.
