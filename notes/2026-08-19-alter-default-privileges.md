# alter default privileges — 미래의 테이블에 미리 권한을 주는 문법

> Phase 4 범위 결정 A5의 배경 설명. 2026-08-19 오너 승인으로
> `grant()` DSL의 default privileges 지원이 Phase 4에 포함되었다.

## 일반 grant의 한계

Postgres에서 권한 부여는 보통 이렇게 한다:

```sql
grant select on all tables in schema ddland to anon;
```

그런데 이 명령의 `all tables`는 **실행 시점에 존재하는 테이블**만
의미한다. 다음 주에 `new_table`을 새로 만들면 `anon`은 그 테이블을
읽을 수 없다. 매번 grant를 다시 실행해야 한다.

실전에서 이 함정은 "새 테이블을 만들었는데 API가 조용히 빈 응답이나
권한 오류를 낸다"로 나타난다. 에러 메시지가 원인을 가리켜주지 않아서
디버깅이 오래 걸리는 부류다.

## 해법: 권한의 기본값을 설정한다

```sql
alter default privileges in schema ddland
  grant select on tables to anon;
```

의미는 "**앞으로 ddland 스키마에 새로 만들어지는 테이블에는 자동으로
anon에게 select 권한을 줘라**". 일종의 권한 기본값 설정이다.

그래서 스키마 단위로 권한을 관리할 때는 두 문법이 짝으로 있어야
완결된다:

- `grant … on all tables in schema …` — **지금 있는** 테이블 커버
- `alter default privileges … grant … on tables …` — **앞으로 생길** 테이블 커버

Supabase 문서·템플릿이 이 두 줄을 세트로 안내하는 이유가 이것이다.
원리를 몰라도 복사해서 넣게 되는 문법이지만, 빼먹으면 위의 함정이
그대로 돌아온다.

## Drizzle은 어떻게 하는가

Drizzle의 권한 관련 지원은 두 층으로 나뉜다:

1. **RLS(정책·롤)는 지원** — drizzle-orm 0.36부터 `pgRole`,
   `pgPolicy`, `enableRLS()`로 선언할 수 있다.
2. **GRANT와 `alter default privileges`는 미지원** — drizzle-kit의
   마이그레이션 시스템은 스키마 변경만 다루고 권한 부여는 관리하지
   않는다. 공식 답변과 Neon 가이드 모두 "빈 커스텀 마이그레이션
   파일을 만들어 raw SQL로 직접 쓰라"는 우회법을 안내한다.

즉 Drizzle 사용자는 grants가 필요한 순간 선언 시스템 밖으로 나가
SQL을 손으로 관리해야 하고, 이후의 변경 추적·diff도 되지 않는다.

- Drizzle RLS 문서: <https://orm.drizzle.team/docs/rls>
- drizzle-orm 0.36 릴리스: <https://github.com/drizzle-team/drizzle-orm/releases/tag/0.36.0>
- Neon의 우회법 안내: <https://neon.com/docs/guides/rls-query-execution>
- Drizzle 팀의 grants 질문 답변: <https://www.answeroverflow.com/m/1329792259771600938>

## hejbro의 UX — 선언 그래프와 colocate 원칙

hejbro도 Drizzle처럼 모든 선언이 `export const`이고, 문자열이 아니라
객체 참조로 연결된다:

```ts
// Drizzle과 같은 감각의 선언 그래프
export const ddland = schema("ddland");

export const posts = table(ddland, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	slug: text().notNull().unique(),
	publishedAt: timestamptz(),
}, (t) => ({
	// ① 테이블에 속하는 것(RLS 정책)은 테이블 선언 안에
	rls: rls.enabled({
		select: rls.policy("anyone can read published")
			.for("select").to("anon", "authenticated")
			.using(isNotNull(t.publishedAt)),
	}),
}));

// ② 함수에 속하는 것(execute 권한)은 함수 선언 안에
export const publishPost = defineFunction("ddland", "publish_post", {
	args: { postId: uuid() },
	security: "definer",
	grants: ["authenticated"],
}, /* … */);

// ③ 스키마에 속하는 것만 스키마 객체를 앵커로
export const ddlandGrants = grant(ddland).usage.to("authenticated", "anon");
```

원칙은 "**grant는 대상 객체가 있는 곳에 붙는다**"이다. 함수 하나의
권한은 `defineFunction`의 `grants:` 옵션에, 테이블 하나의 RLS는
`table()` 선언 안에 colocate된다.

그런데 `grant usage on schema`, `grant … on all tables in schema`,
`alter default privileges in schema`는 SQL 의미 자체가 특정 테이블의
속성이 아니라 **스키마의 속성**이다. "이 스키마의 모든/미래 테이블"에
대한 규칙이라 어느 한 테이블 선언에 붙일 자리가 없고, 그래서 앵커가
스키마 객체(`grant(ddland)`)다. 이걸 `posts` 테이블 안에 넣으면
오히려 "posts에 선언했는데 comments에도 적용되는" 이상한 UX가 된다.

파일 분리는 필수가 아니다 — 선언은 객체 참조로 연결된 그래프라서
테이블과 grant를 한 파일에 둬도 된다.

## 순서 문제 — 유저가 순서를 생각할 필요가 없어야 한다

마이그레이션 순서가 틀리면 적용이 안 되는 사고는 두 층에서 생기고,
hejbro는 둘 다 명시적으로 처리한다:

**파일 간 순서.** 파일명이 Supabase 스타일 타임스탬프
(`YYYYMMDDHHMMSS_slug.sql`)가 기본이다(스펙 D14). 이 결정 자체가
drizzle 기본 프리픽스와 supabase CLI의 적용 순서가 어긋났던 실제
사고를 근거로 내려졌다. 적용은 기존 파이프라인(supabase CLI 등)이
파일명 순으로 하고(D12), hejbro는 그 순서와 호환되는 이름을 만든다.

**파일 안 순서.** diff 엔진이 object kind 간 의존성을 위상 정렬한다.
create/alter는 의존성 순서(schema → table → view → … → grant는 참조
대상들 뒤), drop/revoke는 그 **역순**(테이블을 지우기 전에 revoke가
먼저)이다. 같은 kind 안에서는 identity 바이트 순으로 정렬되어, 같은
선언이면 항상 바이트 단위로 동일한 SQL이 나온다. 손으로 쓸 때처럼
grant를 테이블 생성 앞에 잘못 놓는 실수가 구조적으로 불가능하다.

보너스로, `grant … on all tables`는 실행 시점의 테이블에만 적용되는
문법인데 같은 파일에서 항상 테이블 생성 **뒤에** 배치되므로 그
마이그레이션에서 만든 테이블까지 정확히 커버되고, 그 이후에 생길
테이블은 default privileges가 커버한다.

## 변경은 델타로

선언을 고치면 diff 엔진이 차이만 방출한다:

- `.tables("select")` → `.tables("select", "insert")` 수정
  → 다음 마이그레이션에 `grant insert …` 한 줄만
- role 하나 제거 → `revoke … from <role>` 방출
- 선언 자체 삭제 → 해당 권한 전체 revoke

"지금 DB가 어떤 grant 상태더라?"를 기억할 필요 없이 **선언 파일이 곧
원하는 최종 상태**이고, 거기까지의 경로는 hejbro가 계산한다.

## 결정

Phase 4의 acceptance 기준은 "dd.land의 `sql/grants.ts` 상당을
선언적으로 표현할 수 있어야 한다"인데, 그 원문에 `alter default
privileges` 문장이 2건 실재한다. 지원 범위는 dd.land가 쓰는
부분집합(`in schema … grant … on tables to <role>`, revoke 델타
포함)으로 한정하고, owner/for-role 변형 등 전체 문법은 범위 밖으로
둔다. — 2026-08-19 오너 승인.
