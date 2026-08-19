# force row level security — 소유자는 RLS를 기본으로 우회한다

> Phase 4 범위 결정 A7a의 배경 설명. 2026-08-19 오너 승인으로
> `rls.enabled(…, { force: true })` 옵션이 Phase 4에 포함되었다.

## RLS가 적용되지 *않는* 사람들

`alter table posts enable row level security`로 RLS를 켜면 정책이
모두에게 적용될 것 같지만, Postgres에는 예외가 세 부류 있다:

1. **슈퍼유저** — 항상 우회
2. **`BYPASSRLS` 속성을 가진 롤** — 항상 우회 (Supabase의
   `service_role`이 이것)
3. **테이블 소유자(owner)** — ⚠️ **기본값으로 우회**

1·2번은 의도적으로 부여하는 속성이라 놀랍지 않다. 문제는 3번이다 —
아무 설정도 하지 않았는데 기본으로 뚫려 있다.

## 조용히 뚫리는 시나리오

```sql
-- 앱 전용 롤 app_user로 테이블을 만들었다 (= app_user가 소유자)
create table tenants_data (/* … */);
alter table tenants_data enable row level security;
create policy tenant_isolation on tenants_data
  using (tenant_id = current_setting('app.tenant_id')::uuid);
```

백엔드 서버가 `app_user`로 접속해서 쿼리하면 — **정책이 통째로
무시되고 전 테넌트의 데이터가 다 보인다.** 소유자이기 때문이다.
테스트에서는 별도 롤로 확인해서 "RLS 잘 되네"라고 믿었는데 프로덕션
커넥션이 소유자면 조용히 뚫린다. 에러도 경고도 없다.

해결은 한 줄이다:

```sql
alter table tenants_data force row level security;
-- 이제 소유자에게도 정책이 적용된다 (슈퍼유저·BYPASSRLS는 여전히 우회)
```

## hejbro에서의 표면

```ts
rls: rls.enabled({
	select: rls.policy("tenant_isolation") /* … */,
}, { force: true })
```

방출되는 SQL은 `alter table … force row level security` 한 구절이
추가될 뿐이다. 옵션을 나중에 끄면 diff가 `no force`를 방출한다.

## 어느 환경에서 중요한가 — 솔직한 평가

**Supabase에서는 이 함정을 만날 조건이 좁다.** Supabase는 테이블
소유자가 `postgres`이고 API 요청은 `anon`/`authenticated`로 들어오니,
소유자 우회 경로를 일반 유저가 탈 일이 없다.

이 옵션이 진짜 빛나는 곳은 **직접 커넥션으로 앱 롤이 테이블을
소유하는 환경** — Neon·Nile이나 셀프호스팅 Postgres다. hejbro core는
generic Postgres를 표방하고 Neon·Nile 프리셋이 로드맵에 있으므로,
RLS kind를 새로 만드는 Phase 4 시점에 boolean 옵션 하나로 넣는 것이
가장 싸다는 판단으로 포함되었다.
