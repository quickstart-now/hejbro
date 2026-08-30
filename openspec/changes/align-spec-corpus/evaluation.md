# hejbro OpenSpec 스펙 corpus 외부 평가

> 평가자: 격리된 외부 스펙 평가자 (프로젝트 개발 맥락 없음).
> 평가 대상: `openspec/specs/` 아래 12개 capability의 `spec.md` 전량 —
> 12파일, 3,436행, Requirement 102개, Scenario 272개 (전수 직접 계수, 발주 명세와 일치).
> 격리 준수: 해당 디렉터리 밖의 소스·테스트·문서는 일절 읽지 않음.

## 종합 판정 (Verdict)

이 corpus는 **개별 요구사항 수준에서는 드물게 높은 수준**이다 — 대부분의 시나리오가 실패하는 테스트로 곧장 환원되고, 오류 코드·정확한 SQL 텍스트·종료 코드·제약 이름까지 고정하며, 적대적 입력과 알려진 미완결(unsoundness)까지 시나리오로 못박는다. 그러나 **corpus 수준에서는 유지보수 규율이 성장 속도를 따라가지 못하고 있다**. 구체적으로 세 가지다. (1) **비대칭**: 제품 소개의 헤드라인인 "선언 → 결정론적 마이그레이션 SQL 생성"이 스펙 무풍지대다 — `generate`·`verify`·뷰/트리거/권한/정책 선언·기본 테이블 선언·rename·마이그레이션 배너가 전부 미기술이고, 분량의 약 70%가 쿼리 계층에 몰려 있으며, 신규 스펙들은 이 미기술 앵커를 "the existing …"이라는 댕글링 참조로 계속 끌어다 쓴다. (2) **자립성 훼손**: 이슈 번호, 변경 ID(harden-query-surface group N), 측정 라벨(M1–M6), 결정 번호(D73/D94/D103), "renamed from"·"previously"·"today" 같은 변경-시점 서사가 요구사항 본문과 심지어 THEN 절 안까지 침투해, "지금 무엇을 하는가"가 아니라 "무엇이 어떻게 바뀌었는가"를 서술하는 대목이 반복된다. (3) **실질 모순 최소 2건**: json/jsonb 쓰기 표면에 대한 정면 모순(같은 파일 내 두 requirement가 서로를 인용하면서 반대 주장을 함), 그리고 인젝션 안전 요구사항의 "인라인 렌더링 값 전수 목록"이 이후 추가된 `offset`을 누락한 stale 상태 — 후자는 보안-critical한 열거의 부패라 특히 무겁다. 결론: 개별 조항의 필력·검증가능성은 신뢰할 만하나, corpus 전체를 하나의 정합적 계약으로 읽으려면 정리 작업(모순 해소·앵커 스펙 시드·이력 서사 분리)이 필요한 시점이다.

---

# 1부 — 분석

## A. 검증 가능성

**기준선은 매우 높다.** 시나리오 272개의 대다수가 관찰 가능한 산출물(컴파일된 SQL 텍스트, 명명된 오류 코드, 종료 코드, 타입체크 실패, 스냅샷 바이트)로 THEN을 명세한다. 명명된 오류 코드만 해도 `baseline-not-first`, `baseline-nothing-to-adopt`, `scalar-return-expects-expression`, `scalar-return-in-non-scalar-function`, `scalar-return-missing`, `statement-builder-unused`, `execute-expects-no-returning`, `concurrent-nested-transaction`, `savepoint-release-failed`, `claims-subject-missing` 등이며, 각각이 그대로 실패하는 테스트의 단언이 된다. 이 기준선 위에서 예외만 짚는다.

- **F1. 문서화-내용 요구사항은 검증 형식이 불명확하다.**
  `rls-execution-context/spec.md`, Requirement "The preset states what it cannot detect about the database":
  > "The preset's documentation SHALL state the failure this produces, **in both of its halves**"

  시나리오 "A mismatched context still admits where the role is the key"의 THEN도 "…which the preset's documentation warns about rather than prevents"로 끝난다. 문서의 특정 경고 문구 존재를 무엇으로 검증하는가(문서 파일의 문자열 매칭? 수동 리뷰?)가 열려 있다. 시나리오 "An invalid token surfaces at first use"도 절반은 데이터베이스(플랫폼)의 행동, 절반은 문서 내용에 대한 단언이다. 이 capability의 다른 요구사항들이 코드 행동으로 환원되는 것과 대비된다.

- **F2. THEN 절이 hejbro의 관찰 가능 행동이 아니라 Postgres의 행동·측정 인용을 단언하는 곳이 있다.**
  `query-builder/spec.md`, Scenario "A window function survives inside a recursive term":
  > "**THEN** the statement is accepted at parse time, as Postgres accepts it — whether the specific window construct's recursion terminates is a property of that construct (measured, M2: `row_number() over ()` does not), not something this builder refuses on Postgres's behalf"

  테스트 가능한 핵심("builder는 거부하지 않는다")은 존재하나, 종료하지 않는 재귀의 서술은 hejbro가 검증할 대상이 아니고 M2 라벨은 외부 참조다(→ F22). `query-type-inference`의 Scenario "Mismatched keys are rejected at compile time"의 THEN에도 "(measured, M6)"이 박혀 있다 — 관찰 가능 단언과 측정 근거 서사가 한 절에 섞여 있다.

- **F3. 검증 불가능한 정직성 절.** `driver-contract/spec.md`, Scenario "Capabilities are inspectable":
  > "**THEN** its declared capability set is readable and matches what the driver actually supports"

  "actually supports"는 일반적으로 테스트로 판정 불가능한 의미론적 조건이다(같은 파일의 tier-검증 요구사항이 이 문제를 부분적으로만 다룬다). 경미하나, THEN에 남길 문구는 아니다.

- **F4. 제품 계약이 아닌 리포지토리 내부 테스트 인프라를 명세하는 requirement가 있다.**
  `driver-contract/spec.md`, Requirement "Every declared tier's obligation is machine-verified in this repository"는 스스로 "This verification is repo-internal; it is not part of any package's published surface"라 말하면서, 테스트 러너의 모듈 앨리어싱과 타입체커 path mapping까지 규정한다:
  > "a test runner's own module aliasing for the specifier at test time, and the consuming package's own type-checker path mapping to the same single file for type-checking"

  이는 외부 관찰 가능한 제품 행동이 아니라 빌드 구성 처방이다. capability 스펙이 "제품이 무엇을 하는가"의 집합이라면 이 조항은 이질적이다. (단, 검증 도구 자체의 한계를 정직하게 명시한 부분은 미덕이다 — G6 참조.)

- **F5. 관찰 가능 행동 대신 구현 메커니즘을 서술하는 문장.**
  `query-builder/spec.md`, Requirement "Set operations combine selects into one visible statement":
  > "A key SET mismatch is caught by the type layer (`SetOpResult` resolving to `never`, group 3)"

  `SetOpResult`가 `never`로 해소된다는 것은 구현 방식이다. 관찰 가능 계약은 "fails to type-check"이며 그것은 별도로 명시되어 있으므로, 이 문장은 스펙이 아니라 설계 노트다. `SameKeys`-based, `SqlTypeFamily` 등 TS 내부 타입명 인용도 같은 계열이다(`query-type-inference`, Requirement "A recursive term is typed from its anchor").

## B. 명확성·모호성

- **F6. `order` vs `orderBy` — 한 requirement 안에서 두 이름이 섞인다.**
  `query-builder/spec.md`, Requirement "Select statements over declared tables"는 스테이지를 "optional `where`, `order`, `limit`"로 명명하고 "`order` SHALL accept `asc(column)`/`desc(column)`"라 쓰지만, 같은 단락에서 "a query's `orderBy` previously accepted only a bare column"이라 하고, corpus의 다른 모든 곳(thenable chain의 스테이지 목록, set-op의 "whole-set `orderBy`", window spec의 `orderBy`)은 `orderBy`다. 코어 빌더와 체인의 이름이 다른 것인지, 오기인지 판별 불가.

- **F7. "code"의 이중 사용.** `cli-commands/spec.md`는 hejbro 오류 코드(`baseline-not-first`)와 프로세스 종료 코드(zero/one/two)를 모두 "code"라 부른다. 특히:
  > "It SHALL fail with a distinct code from an ordinary difference."

  (empty declaration set에 대해) — 여기서 distinct한 것이 오류 코드인지 종료 코드인지 문면만으로는 갈린다(종료 코드라면 "two"와 겹치고, 오류 코드라면 코드명이 미명명). 또한 `baseline-nothing-to-adopt`에는 "non-zero exit code"가 명시되나 `baseline-not-first`에는 종료 코드 언급이 없다 — 비대칭.

- **F8. interval 구조체의 필드 계약이 미고정이다.**
  `query-type-inference/spec.md`, Requirement "Interval columns surface as a structured value":
  > "The value's fields SHALL map onto Postgres's own independent storage axes (a whole-months count, a whole-days count, and a sub-day duration with microsecond precision)"

  축은 명확하나 **프로퍼티 이름과 sub-day의 표현 단위**(microseconds 정수? {hours, minutes, …}?)가 어디에도 없다. 제약 이름·SQL 텍스트까지 고정하는 corpus의 다른 부분과 대비하면, 공개 읽기 타입의 형태가 미명세인 것은 눈에 띄는 공백이다. `driver-contract`와 `query-execution`이 이 변환을 반복 참조하므로 파급이 있다.

- **F9. "고정·전수 열거"라면서 실제 전수를 열거하지 않는다.**
  `driver-contract/spec.md`, Requirement "The capability set is exhaustive and statically checked":
  > "The driver capability set SHALL be a fixed, enumerated set of named capabilities (at minimum: interactive transactions, session state)"

  "fixed, enumerated"와 "at minimum"이 충돌한다. 현재 집합이 정확히 이 둘이라면 그렇게 말해야 하고(집합 확장은 스펙 변경으로), 더 있다면 열거가 빠진 것이다. exhaustiveness를 요구하는 조항 자체가 non-exhaustive하게 쓰였다.

- **F10. "the `related()` chain's `where`"의 지시 대상이 모호하다.**
  `query-builder/spec.md`, Requirement "Condition expressions reuse the declaration vocabulary"는 조건 위치 목록에 "the `related()` chain's `where`"를 포함하지만, Requirement "related() derives nested reads from declared foreign keys"는:
  > "v1 accepts only `true` per key and only direct (depth-1) relations"

  `true`만 받는다면 related 키에는 `where`가 없다. "related()를 호출한 체인의 (자체) where"라는 독해도 가능하나 그 경우 굳이 별도 항목으로 열거할 이유가 없어, 두 독해 사이에서 갈린다.

- **F11. "SHALL type as `bigint`" vs 시나리오의 "`bigint | null`".**
  `query-type-inference/spec.md`, Requirement "An aggregate's result type is the type it really returns"는 "`count()` SHALL type as `bigint`"라 쓰고, 그 시나리오는:
  > "**THEN** the field's type is `bigint | null`"

  `| null`은 같은 파일의 object-projection 전면 nullable 규칙에서 오지만, 이 requirement 안에서는 그 연결이 진술되지 않아 국소적으로 모순처럼 읽힌다. window 쪽 `rowNumber` requirement/시나리오도 동일 패턴.

- **F12. "v1"이라는 범위 표지가 미정의다.** "in v1" (`query-execution` 오류 전파), "v1 accepts only `true`" (`query-builder` related), "`.references()` takes no options in v1" (`table-declaration`). corpus 어디에도 v1이 무엇이고 언제 끝나는지 없다. 소개문의 버전 체계(0.x)와의 관계도 불명.

- **F13. `check`의 비교 축 전체 목록이 흩어져 있고 첫 열거가 불완전하다.**
  `cli-commands/spec.md`, Requirement "Declarations can be checked against a live database":
  > "`check` SHALL compare, per declared object: existence by identity, and for a column its type, its `notNull`, and its default."

  그러나 별도 requirement가 표현식 비교(check 제약·인덱스 술어·generated 컬럼)와 `NOT VALID` 강제 여부 비교를 추가하고, all-tables grant 비교 규칙도 따로 있다. "check가 비교하는 것의 전부"를 한 곳에서 읽을 수 없고, 첫 문장을 전수 목록으로 읽은 구현자는 표현식 비교를 빠뜨린다. (coverage-boundary requirement가 보고서 수준에서 이를 완화하지만, 스펙 독자 수준에서는 남는다.)

## C. 일관성 (모순 포함)

- **F14. [중대] json/jsonb 쓰기 표면 — 같은 파일의 두 requirement가 정면으로 모순되며, 틀린 쪽이 맞는 쪽을 인용한다.**
  `query-type-inference/spec.md`, Requirement "Insert and update input types follow the declaration":
  > "a `json`/`jsonb` column accepts any JSON-serializable value, which the query layer serializes"

  이며 Scenario "A json value is written without hand-serialization"이 "**WHEN** an insert or update writes a plain object to a `jsonb` column — **THEN** it type-checks"로 이를 확정한다. 그런데 같은 파일 Requirement "`$type` narrows the visible type; jsonb is unknown unless branded":
  > "The write side is not widened by the brand: a `json`/`jsonb` column, branded or not, accepts only an `Expr` (see the insert/update input-types requirement)."

  "accepts only an `Expr`"와 "accepts any JSON-serializable value"는 양립 불가능하고, 후자를 근거로 인용까지 한다. 같은 requirement의 Scenario "A brand narrows the write as well as the read"("written a value that is not a `T` → fails to type-check")도 branded jsonb가 값을 받는다는 전제라서 첫 인용과만 정합한다. json/jsonb 쓰기가 나중에 열리면서 `$type` requirement의 문장이 갱신되지 않은 stale로 추정된다. **참고**: "an array column whose element type is `json`, `jsonb` or `bytea` SHALL accept only an `Expr`"는 배열 원소에 대한 별개 규칙으로, 이 모순과 무관하게 유효하다 — 즉 스칼라/배열 구분이 모순을 해소해 주지도 않는다.

- **F15. [중대] 인젝션 안전 요구사항의 "인라인 렌더링 값 전수 목록"이 `offset`을 누락한다.**
  `query-builder/spec.md`, Requirement "Injection safety":
  > "The only *values* rendered inline are ones that are not caller-supplied text: a `limit`, which the builder has already validated as a non-negative integer, and the internal `default` marker a multi-row insert uses for a missing key."

  그런데 같은 파일 Requirement "Selects paginate and de-duplicate":
  > "`offset` … SHALL render inline after `limit` — never as a bind parameter, the same rule `limit` already follows"

  "The only values rendered inline"은 보안 검토의 기준선이 되는 전수 열거인데, offset이 추가되며 갱신되지 않았다. 실행 결과는 안전하더라도(offset 역시 non-negative integer 검증), 이 목록을 신뢰한 감사자는 offset 인라인을 스펙 위반으로 오판하거나, 반대로 목록의 전수성 자체를 불신하게 된다. 열거형 보안 조항의 부패는 우선 수선 대상이다.

- **F16. 체인의 "단일 어휘 위임" 원칙과 union 계열의 "독립 구현" 서술이 충돌한다.**
  `query-builder/spec.md`, Requirement "A thenable chain surface delegates to the single statement vocabulary":
  > "the query layer SHALL NOT build a second statement vocabulary of its own"

  vs 같은 파일, set-operation requirement:
  > "the query package's own chain surface (which builds its `union()` family independently, never routing through the core builder)"

  엄밀히는 전자의 스테이지 열거에 union이 없어 문면 모순은 아니지만, "제2 어휘 금지" 원칙과 "코어를 경유하지 않는 독립 구현"의 공존은 내부 맥락(D103) 없이는 정합적으로 읽히지 않는다. 원칙의 적용 범위(어떤 스테이지가 위임 대상인가)가 명시되어야 한다.

- **F17. `onConflictDoNothing`/`onConflictDoUpdate`는 스테이지 목록에만 존재하는 유령 기능이다.**
  `query-builder/spec.md`, thenable chain requirement의 스테이지 열거:
  > "(`where`/`orderBy`/`limit`/`innerJoin`/`leftJoin`/`returning`/`onConflictDoNothing`/`onConflictDoUpdate`)"

  corpus 전체에서 on-conflict는 이 한 줄뿐이다. 렌더링 형태, 대상 지정(컬럼/제약), `doUpdate`의 set 표면, 타입 등 아무것도 없다. "delegate directly to the corresponding core builder stage"라는데 코어 빌더 스펙(insert requirement)에도 on-conflict가 없다 — 위임의 원본이 미기술이다.

- **F18. 이후 추가된 어휘의 체인 표면 도달 여부가 불명확하다.**
  `query-execution/spec.md`에 "The chain declares CTEs too"가 **별도 requirement로 존재한다는 사실 자체**가, 체인 패리티는 자동이 아니고 명시가 필요함을 시사한다. 그렇다면 `offset`/`distinct`/`groupBy`/`having`/window/aggregate가 체인에도 있는지가 진술되어야 하는데, 해당 requirement들은 모두 "The builder SHALL provide…"라고만 한다. `with()`만 체인 패리티가 명시된 비대칭.

- **F19. 직렬화(코덱) 규칙의 소유처가 두 파일로 갈라져 있다.**
  formatVersion·additive-compact 규칙은 `snapshot-format`에 있으나, window 노드와 `with` 노드의 디코드 엄격성(absence = corruption) 규칙은 `query-builder`에 있다:
  > (query-builder, "A WITH survives serialization") "A stored `with` node missing its body or its entry list SHALL be rejected, not repaired: `with` is new in this format version…"

  한편 `snapshot-format`의 "A stored view body may declare CTEs"는 같은 `with` 노드의 formatVersion 불변만 다룬다. `SetOpNode` 디코드 관용성("deliberately lenient by an earlier, standing decision")도 query-builder에 서술된다. 같은 코덱의 계약이 capability 경계를 넘어 분산되어, 코덱 변경 시 어느 스펙을 고쳐야 하는지 판단이 이중화된다.

- **F20. plpgsql의 트리거-쿼리 거부 requirement는 반환-shape requirement의 한 사례를 중복 서술한다.**
  `plpgsql-function-bodies/spec.md`, Requirement "A body's return shape is decided by the declaration"이 이미 "SHALL accept exactly the shape the enclosing declaration's own `returns` can carry, and SHALL reject any other shape"로 트리거 케이스를 포괄하는데, Requirement "A trigger body returns a row, never a query"가 그 부분집합을 다시 규정한다. 게다가 후자의 본문이 현재 행동을 모호하게 만든다 (→ F26).

- **F21. FILTER/countWhere 부재 단락이 두 파일에 거의 동일하게 중복된다.**
  `query-builder` "Selects aggregate and group"과 `query-type-inference` "An aggregate's result type…"이 모두:
  > "the invented name `countWhere(expr)` covered that one use without generalizing to a real `FILTER` clause, and was removed rather than kept; a real `FILTER (WHERE …)` … is tracked as a follow-up, #501"

  같은 negative-space 사실의 이중 기록. #501이 착지하면 두 파일을 동시 수정해야 하며, 하나만 고치면 새 모순이 생긴다.

## D. 자립성

- **F22. 외부 참조 밀도가 높고, 일부는 THEN 절 안까지 침투했다.**
  corpus가 참조하는 외부 식별자: 이슈 번호 **#307, #326, #412, #433, #469, #470, #487, #489, #500, #501**; 변경 ID **harden-query-surface(group 1/2/3/7/8), add-array-ergonomics, add-body-statements**; 결정 번호 **D73, D94, D103**; 측정 라벨 **M1, M2, M3b-i, M3b-ii, M4, M6**. 어느 것도 corpus 안에서 해소되지 않는다. 완화 요인: 대부분 실측 내용(SQLSTATE `42804`/`42P19`, 재현 쿼리 형태)이 인라인으로 병기되어 있어 참조를 좇지 않아도 이해는 된다 — 이 점은 잘한 것이다. 그러나 관찰 가능 단언이어야 할 THEN 절에까지 침투한 사례가 있다:
  > (query-execution, Scenario "tx.execute resolves the same inferred types…") "**THEN** … at both `tx` creation sites (the previously tracked #326 asymmetry is closed)"

  > (query-type-inference, Scenario "A recursive term nullable where the anchor is not still compiles") "**THEN** … even though a null value from the recursive term can genuinely reach the result rows (measured, #500)"

- **F23. "무엇이 바뀌었는가"를 서술하는 변경-시점 서사가 요구사항 본문에 남아 있다.** 실례:
  > (query-execution, requirement 본문) "(Renamed from \"The chain surface is uniform…\": the requirement broadened — with #326 closed, uniformity covers `execute`'s own typing, not only the chain members.)"

  > (query-builder, select requirement) "a query's `orderBy` previously accepted only a bare column or direction, with no way to spell a nulls placement at all"

  > (table-declaration, generated/identity requirement) "(amended at group 2 close from the original confirmation-gated wording; the guard reuses the `unsupported-column-alter` diagnostic)"

  > (query-type-inference, recursive-term requirement) "closing the gap this requirement used to park at #487"

  > (query-builder, set-op requirement) "the exact review finding that added group 8 mid-flight"

  이들은 전부 "지금의 계약"이 아니라 "계약의 개정사"다. 스펙과 나란한 어딘가(변경 아카이브, 설계 문서)의 몫이다.

- **F24. snapshot-format은 상태 서술이 아니라 체인지로그다.**
  requirement 제목부터 "Snapshot format version 8 **records a view body's offset and distinct**" — v7 대비 델타를 말한다. 파일 전체(102행)가 프론티어 델타 3건(offset/distinct, `with` 노드, `nulls` 키)만 기록하고, **스냅샷이 무엇을 담는 형식인지는 어디에도 없다**. 격리된 구현자는 이 파일로 스냅샷 포맷을 재구성할 수 없다. "what the product does now"를 표방하는 corpus에서 가장 구조적인 "what changed" 위반 사례다.

- **F25. "the existing X" 계열 댕글링 참조 — 미기술 앵커에 기대는 참조망.** 수집한 사례:
  - `snapshot-format`: "SHALL fail with the existing newer-format diagnostic"; "the existing older-format diagnostic and its **pin-or-reset guidance**" — 두 진단의 내용·가이던스 문안 미기술.
  - `table-declaration`: "the existing confirmation mechanism keys on dropped NAMES" — 파괴적 변경 확인 메커니즘 자체가 미기술.
  - `query-execution`: "the existing rollback-failure path SHALL take over — that failure is about the connection" / "the existing savepoint-rollback-failure error is raised" — 그 기존 오류 경로 미기술.
  - `query-builder`: "SHALL keep failing with the existing foreign-column diagnostic" — 미기술.
  - `cli-commands`: "SHALL carry a hejbro error code and a `Next:` line, **like every other hejbro diagnostic**" — 범-corpus 진단 형식(코드 + Next: 라인)이 전제되나 그 형식의 스펙이 없음; "`baseline` SHALL accept only the flags a first migration can use" — `generate`의 플래그 표면이 미기술이라 정의역이 비어 있음; "same DDL, same banner hash chain", "`verify` accepts the chain" — 배너·해시 체인·verify 의미론 전부 미기술.
  - `rls-execution-context`: "(for example `authUidCached()` resolves to `claims.sub`)" — 어디에도 정의되지 않은 헬퍼 명.
  corpus가 "빈 디렉터리에서 자라는" 모델임을 Purpose들이 자인하므로 공백 자체는 설계지만, **신규 스펙이 미기술 앵커를 규범적 참조로 사용하는 순간 그 앵커는 사실상 스펙의 일부가 되면서도 검증·소유가 없는 그림자 계약**이 된다. 이 참조망은 corpus가 클수록 조용히 두꺼워진다.

- **F26. 변경-시점의 "today"가 main 스펙에 남아 현재 행동을 모호하게 만든다.**
  `plpgsql-function-bodies/spec.md`, Requirement "A trigger body returns a row, never a query":
  > "The shape check fires only for a scalar-returning declaration today, so a query returned from a trigger body renders `return query …` inside a `returns trigger` function — SQL Postgres rejects at CREATE"

  requirement 헤딩은 "SHALL fail at declaration time"인데 본문은 (제안 시점의 결함 상태를 근거로 쓴 문장이 그대로 동기화되어) "지금은 렌더링된다"로 읽힌다. 격리된 독자는 현재 제품이 거부하는지, 깨진 SQL을 내는지 판정할 수 없다.

- **F27. Neon 요구사항의 구현 지위가 표시되지 않는다.**
  제공된 제품 소개는 "프로바이더 프리셋(Supabase 우선, **Neon·Nile 예정**)"이라 한다. 그런데 `rls-execution-context`에는 Neon 전용 requirement 2개("The Neon preset fixes the authentication mode at construction", "The preset states what it cannot detect…" — `asAnonymous()`의 role `anonymous`까지 고정)가, `driver-contract`에는 Neon 시나리오 2개("Neon driver plugs in unchanged on its session path", "A preset driver's declared-false capability fails closed … on the Neon preset's one-shot driver")가 현재형 SHALL로 존재한다. "specs = 지금 제품이 하는 것"이라면 소개가 stale하거나, 스펙에 미출시 계약이 섞여 있거나 둘 중 하나다. 격리된 독자는 어느 쪽인지 판별할 수 없고, 이는 corpus의 진리 지위 자체를 흔든다.

- **F28. Purpose 섹션의 stale.**
  - `cli-commands` Purpose: "Currently covers `baseline`, the command that adopts a database…" — 실제로는 9개 requirement 중 6개가 `check`다. Purpose만 읽고 지나간 독자는 check 스펙의 존재를 놓친다.
  - `query-builder` Purpose: "build typed SQL statements (select, insert, update, delete)" — 파일의 절반 이상을 차지하는 set operation·window·CTE·재귀 CTE가 언급되지 않는다.

## E. Granularity·중복·형식

- **F29. 메가-requirement 3건 — 부분 수정 시 전체 재기술이 필요한 단위.**
  - `query-builder` "Set operations combine selects into one visible statement": 본문만 약 58행. 6개 결합자·렌더링·whole-set order/limit·**뷰 본문 유효성**·**스냅샷 라운드트립**(snapshot-format의 영토)·좌측 브랜치 네이밍·순서-mismatch 가드·가드의 3개 적용 지점·디코드 경로 면제까지 한 덩어리. 최소 3개 결정(결합·가드·직렬화)이 한 헤딩 아래 있다.
  - `query-type-inference` "A recursive term is typed from its anchor": 시나리오 포함 약 93행. 호환성 테스트·row type의 출처·nullability 관용과 그 잔여 unsoundness·brand 축 제외·방향성 타입 발산 미포착까지. 각각 독립 채택/개정 가능한 결정들이다.
  - `query-execution` "Result values are converted to their declared type": 24행 단일 단락에 스칼라 변환·원소별 배열 변환·notNullElements 위반·arrival-shape mismatch·전체-실패 원자성이 접속사로 이어져 있다.
  반대극(1–2 requirement 파일: value-utilities, function-declaration)은 Purpose가 성장 모델을 자기 서술하므로 문제 없다.
- **F30. 시나리오 사이에 requirement 산문이 끼어 있는 형식 이탈 2건.**
  - `plpgsql-function-bodies`, "A builder a body makes is a builder a body uses": Scenario "Of two builders…" 다음에 "The criterion is consumption, never syntax. …" 단락이 오고 그 뒤에 다시 Scenario 2개가 온다.
  - `query-execution`, "A failing savepoint release is recovered and reported": 첫 시나리오 뒤에 "If the recovery rollback itself fails, the existing rollback-failure path SHALL take over" 단락, 그 뒤에 두 번째 시나리오.
  `### Requirement:` 산문 → `#### Scenario:` 블록이라는 형식을 기계적으로 파싱하는 도구(또는 독자)는 이 단락들을 앞 시나리오에 오귀속하거나 유실한다. 특히 두 번째 사례의 끼인 단락은 SHALL을 담은 규범 문장이다.
- **F31. 한 시나리오에 WHEN/THEN 쌍이 두 벌.**
  `query-execution`, Scenario "Commit on success, rollback on throw"는 WHEN/THEN/WHEN/THEN 구조다. 두 개의 독립 시나리오(commit 경로, rollback 경로)를 한 블록에 담아, 시나리오=단일 검증 단위라는 계수·추적 관행과 어긋난다(corpus 내 유일 사례).

## F. 완결성·비대칭

- **F32. 분량·요구사항 모두 쿼리 계층에 집중되어 있고, 제품 소개의 헤드라인이 무풍지대다.**
  실측 분포(행 기준): 쿼리/실행 계층(query-builder 692 + query-type-inference 561 + query-execution 398 + driver-contract 359 + rls-execution-context 267 + typed-function-execution 77 + value-utilities 31) = **2,385행, 약 69%**. 선언·마이그레이션 측(table-declaration 224 + plpgsql 249 + function-declaration 51 + snapshot-format 102) = 626행(18%). CLI 425행(12%)조차 `baseline`과 `check` 두 명령뿐이다. Requirement 수로도 쿼리/실행이 102개 중 76개(75%).

  **스펙이 전혀 없는 제품 표면** (소개문이 선언하는 것 기준):
  - `generate` — 제품의 헤드라인("결정론적 마이그레이션 SQL 생성") 그 자체. 결정론 주장도 `compile()`(쿼리)과 스냅샷 바이트 안정성에만 스펙이 있고 마이그레이션 생성의 결정론은 미기술.
  - `verify` — 다른 스펙 4곳 이상에서 규범적으로 참조되면서 미기술 (예: query-builder set-op의 "hejbro verify hashes the parsed-and-re-rendered snapshot against its recorded value").
  - 기본 테이블/컬럼 선언(타입, notNull, default, PK, unique, 인덱스 일반) — table-declaration은 고급 5건(notNullElements, generated/identity, references, window 거부, 인덱스 소유)만 다룬다.
  - 뷰 선언(`defineView`는 query-builder에서 참조로만 등장), 트리거 선언(`defineTrigger`는 plpgsql 본문 스펙에서만), RLS **정책 선언**(실행 컨텍스트만 스펙됨), 권한(grant) 선언(check와 role 검증에서 참조로만), enum 선언(`pgEnum`은 타입 추론 스펙에서만).
  - rename 흐름(플래그·스냅샷 재작성 — window/CTE requirement가 "a rename SHALL rewrite/NOT rewrite…"로 참조하는 그 메커니즘), 파괴적 변경 확인, 마이그레이션 배너·해시 체인, 범용 진단 형식(코드 + `Next:`).

  **위험 판정**: 이 비대칭은 "소급 작성 금지, 변경이 닿을 때 스펙 생성"이라는 성장 모델의 산물로 보이며 그 자체는 일관된 정책이다. 그러나 세 가지 리스크가 이미 현실화 중이다. (1) **그림자 계약의 누적** — F25의 댕글링 참조망이 이 공백 위에 얹혀 있고, 미기술 앵커(generate/verify/진단 형식)의 행동이 바뀌어도 스펙 차원에서 아무것도 어긋나지 않는다. 가장 참조가 많은 개념이 가장 검증이 없는 역전 상태. (2) **노력 배분 신호의 왜곡** — 스펙 밀도를 보고 검증 노력을 배분하는 기여자는 쿼리 빌더를 과잉 검증하고 마이그레이션 엔진을 과소 검증하게 된다. 제품의 위험 프로파일(마이그레이션 SQL이 틀리면 데이터가 죽는다)과 정반대다. (3) **성장 모델의 맹점** — 가장 안정된 핵심일수록 변경이 닿지 않아 영원히 스펙이 없을 수 있다. 안정성이 미기술의 사유가 되는 구조는, corpus가 "제품 서술"로 쓰이는 순간(신규 기여자, 외부 감사, 본 평가 같은 격리 검증) 비용을 청구한다.

## G. 잘 쓰인 사례 (동일한 증거 기준)

- **G1. 종료 코드 삼분법과 그 근거** — `cli-commands`, check requirement:
  > "**zero** when everything compared agreed, **one** when any declared object is missing or differs, and **two** when the run could not answer — anything reported as not compared, or a declaration set that was empty. Two is never silence"

  관찰 가능(종료 코드), 근거 내장("'the database disagrees with you' and 'I could not find out' are different facts and a caller automating this needs to tell them apart"), 자동화 소비자 관점까지. requirement 작법의 모범.
- **G2. 적대적 경계 시나리오** — `query-builder`, Injection safety의 "A value that looks like a placeholder": "**WHEN** a compiled value is itself the text `$1`". 테스트 작성자가 놓치기 쉬운 정확한 경계 케이스를 스펙이 먼저 지목한다. `rls-execution-context`의 "**WHEN** a role name containing a double quote is applied"도 동급.
- **G3. 알려진 unsoundness의 시나리오化** — `query-type-inference`의 "A recursive term nullable where the anchor is not still compiles"와 "A same-family type divergence … is not caught"는 **한계를 통과 시나리오로 못박는다**. 과대 주장을 막고, 나중에 누군가 "고치면" 스펙이 먼저 알아챈다. negative-space를 스펙 자산으로 만드는 드문 관행이다(인용 표기 방식의 문제는 F22와 별개).
- **G4. 산출물의 정확한 고정** — `table-declaration`, notNullElements: 제약 이름 패턴(`<column>_no_null_elements`)과 표현식 원문:
  > "`array_position(\"app\".\"posts\".\"tags\", null) is null`"

  까지 고정해 골든 테스트로 직행 가능하다.
- **G5. 양방향 버전 스큐** — `snapshot-format`은 "구형 리더가 신형 스냅샷을"과 "신형 리더가 구형 스냅샷을" 읽는 두 방향 모두를 별개 시나리오로 갖는다. 스큐 스펙에서 흔히 한쪽이 빠진다.
- **G6. 검증 도구 자신의 한계 명시** — `driver-contract`, tier 검증:
  > "This is a deliberate limitation of what this verification observes, not an oversight it is expected to close."

  검증이 무엇을 보지 **못하는지**를 스펙이 스스로 말한다(F4의 배치 문제와는 별개의 미덕).
- **G7. capability 간 역할 분담의 정합** — set operation 하나를 query-builder(구성·렌더링·순서 가드), query-execution(좌측 브랜치 기준 변환), query-type-inference(키 호환성·좌측 키 채택), snapshot-format(어휘 추가·버전 불변)이 나눠 갖고, "좌측 브랜치" 규칙이 세 파일에서 동일하게 진술된다. 교차 검증한 상호 참조들은 정확했다(F19의 코덱 소유권 분산은 이 그림의 예외).

---

# 2부 — 개선안

각 제안은 독립 채택 가능하며, 하나가 하나의 결정이 되도록 잘랐다.

**P1. json/jsonb 쓰기 표면 모순 해소** — `query-type-inference`의 `$type` requirement에서 "a `json`/`jsonb` column, branded or not, accepts only an `Expr`" 문장을 현재 계약(JSON-serializable 값 수용)에 맞게 개정하거나, 반대가 진실이면 insert/update requirement와 그 시나리오를 개정.
- 왜: F14 — 같은 파일 내 정면 모순, 틀린 쪽이 맞는 쪽을 인용.
- 효과: 타입 표면의 단일 진실 회복; 이 조항으로 테스트를 쓰는 순간 발생할 충돌 제거.
- 비용·리스크: 문장 1–2개 수정. 어느 쪽이 진실인지 구현 확인 필요(스펙만으로 판정 불가).
- 우선순위: **high**

**P2. Injection safety의 인라인 값 전수 목록에 `offset` 반영** — "The only *values* rendered inline are …" 열거에 offset을 추가하거나, 열거 대신 규칙("builder가 non-negative integer로 검증한 행 수 값")으로 재기술.
- 왜: F15 — 보안-critical 전수 열거의 stale.
- 효과: 보안 감사 기준선 복원; 향후 인라인 값 추가 시 같은 부패 재발 방지(규칙형 채택 시).
- 비용·리스크: 최소. 규칙형 재기술 시 전수성의 강한 보증이 다소 약화되는 트레이드오프.
- 우선순위: **high**

**P3. 공유 앵커 계약의 스펙 시드** — 최소 2건: (a) hejbro 진단 형식(오류 코드 + `Next:` 라인 + 코드 네임스페이스) capability, (b) `generate`/`verify`/마이그레이션 배너·해시 체인의 최소 스펙(cli-commands 확장 또는 migration-generation capability 신설). "the existing X" 참조들이 이 두 곳으로 해소되게 한다.
- 왜: F25, F32 — 가장 참조가 많은 개념이 가장 검증이 없는 역전; 댕글링 참조망의 누적.
- 효과: 신규 스펙의 참조가 규범 문서에 닿음; baseline 스펙의 "flags a first migration can use" 같은 정의역 공백 해소.
- 비용·리스크: 소급 작성 금지 정책과의 조율 필요(참조되는 순간 이미 "변경이 닿은" 것으로 볼 여지가 있음). 시드 범위를 참조된 표면으로 한정하면 비용 통제 가능.
- 우선순위: **high**

**P4. 스펙 corpus의 구현 지위 정합 — Neon** — Neon requirement/시나리오가 출시된 행동이면 제품 소개(및 대외 서술)를 갱신하고, 미출시면 해당 조항을 changes(프론티어)로 이동하거나 지위 표기를 도입.
- 왜: F27 — "specs = 지금 하는 것"이라는 corpus의 진리 지위가 흔들림.
- 효과: 격리된 독자(신규 기여자·감사자)가 스펙을 현재 계약으로 신뢰 가능.
- 비용·리스크: 이동 시 rls-execution-context의 구조 재편 필요. 지위 표기 도입은 OpenSpec 형식 관례와의 정합 검토 필요.
- 우선순위: **high**

**P5. on-conflict 스펙 공백 해소** — `onConflictDoNothing`/`onConflictDoUpdate`의 계약(렌더링, 충돌 대상 지정, doUpdate의 set 표면, returning과의 상호작용, 타입)을 insert requirement 또는 독립 requirement로 작성. 미구현/미확정이면 스테이지 열거에서 제거.
- 왜: F17 — 이름만 존재하고 계약이 없는 표면.
- 효과: 스테이지 열거의 모든 항목이 검증 가능한 계약을 가짐.
- 비용·리스크: 스펙 1건 작성 분량. 이미 구현된 행동의 후행 기술이 되므로 성장 모델과의 정합 판단 필요.
- 우선순위: **medium**

**P6. 변경 이력·측정 서사의 요구사항 본문 분리** — "(Renamed from …)", "previously accepted", "amended at group 2 close", "used to park at #487", "added group 8 mid-flight", THEN 절 내 "(measured, #500)"/"#326 asymmetry is closed" 등을 본문에서 걷어내고, 실측 사실은 무라벨 서술("measured on postgres:17.11: …" 형태는 유지 가능)로, 개정사는 변경 아카이브로.
- 왜: F22, F23, F2 — 자립성 훼손의 최대 원천; THEN 절 오염.
- 효과: "지금 무엇을 하는가"만 남는 스펙; 격리 독해 가능성 회복.
- 비용·리스크: 대상이 많아 편집량이 큼(특히 query-type-inference recursive-term, query-builder set-op). 근거 소실 우려는 실측 내용의 인라인 유지로 상쇄.
- 우선순위: **medium**

**P7. snapshot-format의 상태 서술 재구성** — "version 8이 무엇을 추가했나"가 아니라 "스냅샷이 무엇인가"(파일 구조, 테이블/컬럼/뷰 스냅샷이 담는 필드, additive-compact 원칙, 버전 정책)를 서술하도록 재편. 델타 서술은 requirement가 아니라 변경 아카이브의 몫으로.
- 왜: F24 — corpus에서 가장 구조적인 체인지로그화 사례; 이 파일로 포맷 재구성 불가.
- 효과: 스냅샷을 소비·검증하는 모든 작업(diff, verify, 코덱)의 준거 확보; P3(b)와 시너지.
- 비용·리스크: 사실상 신규 작성에 가까운 분량. 소급 기술 정책과의 조율 필요.
- 우선순위: **medium**

**P8. 코덱 규칙의 단일 소유처 결정** — window/`with`/set-op 노드의 디코드 엄격성·관용성 규칙을 snapshot-format으로 이관(또는 반대 방향으로 통일)하고, 남는 쪽에는 한 줄 교차 참조만.
- 왜: F19 — 같은 코덱의 계약이 두 capability에 분산.
- 효과: 코덱 변경 시 수정 지점 단일화; capability 경계의 명료화.
- 비용·리스크: 이동 편집. 어느 쪽이 소유하는가 자체가 owner 결정 사항.
- 우선순위: **medium**

**P9. 메가-requirement 분할** — (a) query-builder set-op을 결합·렌더링 / 순서-mismatch 가드 / 뷰·직렬화의 3개로, (b) query-type-inference recursive-term을 호환성 테스트 / row type 출처 / 알려진 한계(잔여 unsoundness) 의 3개로, (c) query-execution 결과 변환을 스칼라 / 배열 / 실패 원자성으로 분할.
- 왜: F29 — 부분 개정 시 전체 재기술 강제; 리뷰·diff 단위 비대.
- 효과: 개정·채택 단위가 결정 단위와 일치; 시나리오-요구사항 대응 명확화.
- 비용·리스크: 헤딩 재편으로 기존 참조(변경 문서의 delta가 requirement 헤딩을 키로 쓴다면)가 깨질 수 있음 — 분할 시점을 다음 개정과 맞추면 완화.
- 우선순위: **medium**

**P10. plpgsql 트리거-쿼리 requirement 정리** — "A trigger body returns a row, never a query"에서 "The shape check fires only for a scalar-returning declaration today, so … renders `return query …`" 문장을 제거하고, 반환-shape requirement("SHALL reject any other shape")와의 관계(사례 명세인지 독립 계약인지)를 명시하거나 병합.
- 왜: F26, F20 — 현재 행동이 모호해지는 "today" 서사 + 부분 중복.
- 효과: 현재 계약의 단일하고 명확한 진술.
- 비용·리스크: 최소.
- 우선순위: **medium**

**P11. interval 구조체의 필드 계약 고정** — 프로퍼티 이름과 sub-day 표현(단위·타입)을 requirement에 명시.
- 왜: F8 — 공개 읽기 타입의 형태가 미명세; 3개 capability가 이 값에 의존.
- 효과: 드라이버·변환·타입 추론이 같은 형태를 준거로 검증 가능.
- 비용·리스크: 최소(이미 구현된 형태의 전사). `[design]`급 계약 확정이므로 owner 확인 필요.
- 우선순위: **medium**

**P12. 체인 표면 패리티 규칙의 일반화** — "코어 빌더가 제공하는 어휘는 체인에도 동일하게 존재한다"를 일반 규칙으로 명시하거나, 반대로 체인 도달 여부를 각 requirement에 개별 명시. 아울러 "no second statement vocabulary" 원칙과 union 계열 독립 구현의 관계(원칙의 적용 범위)를 한 문장으로 정리.
- 왜: F18, F16 — with()만 패리티가 명시된 비대칭; 원칙과 예외의 긴장.
- 효과: 새 어휘 추가 시 체인 패리티 누락이 스펙 위반으로 잡힘.
- 비용·리스크: 일반 규칙화는 실제로 패리티가 성립하는지 전수 확인이 선행되어야 함.
- 우선순위: **medium**

**P13. 용어·표기 통일** — (a) `order`/`orderBy` 단일화(query-builder 첫 requirement), (b) "code"를 "error code"/"exit code"로 구별 표기하고 `baseline-not-first`의 종료 코드 명시, (c) check의 비교 축 전수 목록을 한 곳에 통합, (d) "v1"의 정의 또는 제거.
- 왜: F6, F7, F13, F12.
- 효과: 격리 독해 시 이중 해석 제거.
- 비용·리스크: 최소.
- 우선순위: **low**

**P14. FILTER/countWhere 부재 단락의 단일화** — 한 파일(query-builder가 자연스러움)에만 두고 다른 파일은 한 줄 참조로.
- 왜: F21 — 후속(#501) 착지 시 이중 수정 강제.
- 효과: negative-space 사실의 단일 소유.
- 비용·리스크: 최소.
- 우선순위: **low**

**P15. 구조 형식 정리** — (a) 시나리오 사이에 끼인 requirement 산문 2건(plpgsql builder-consumption, query-execution savepoint-release)을 시나리오 앞으로 이동, (b) "Commit on success, rollback on throw"의 이중 WHEN/THEN을 두 시나리오로 분할.
- 왜: F30, F31 — 형식 기반 도구·독자의 오귀속 위험; 특히 끼인 단락 하나는 SHALL 문장.
- 효과: requirement 산문 → 시나리오 블록이라는 형식 불변식 회복.
- 비용·리스크: 최소.
- 우선순위: **low**

**P16. Purpose 최신화** — cli-commands("Currently covers `baseline`" → check 포함), query-builder(set op·window·CTE 반영).
- 왜: F28.
- 효과: 파일 첫 화면의 정확성 — 스펙 탐색의 진입점 품질.
- 비용·리스크: 최소. Purpose가 계속 stale해지는 구조라면 "Purpose는 requirement 목록을 요약하지 않는다" 같은 관례 결정이 더 나을 수 있음(그 경우 이 제안은 그 관례로 대체).
- 우선순위: **low**

**P17. driver capability set의 전수 열거** — "at minimum: interactive transactions, session state"를 현재 집합의 정확한 열거로 교체(확장은 스펙 변경으로 흡수).
- 왜: F9 — exhaustive를 요구하는 조항의 non-exhaustive 표기.
- 효과: "빠짐없이 선언"의 판정 기준이 스펙 안에서 닫힘.
- 비용·리스크: 최소.
- 우선순위: **low**

**P18. 문서화-내용 요구사항의 검증 형식 명시** — Neon preset의 경고 문서 요구(F1)에 대해, 검증 수단(해당 문서 위치·필수 요소)을 명시하거나 시나리오를 코드 행동(예: 오류 메시지가 원인 도달 경로를 안내)으로 환원.
- 왜: F1 — corpus에서 유일하게 테스트로 환원이 불투명한 시나리오군.
- 효과: "정의된 완료"의 회복.
- 비용·리스크: 문서를 계약 표면으로 승격하는 데 따른 유지 비용.
- 우선순위: **low**

---

## 요약 수치

- 평가 대상: 12 파일 / 3,436행 / Requirement 102 / Scenario 272 (전수 계수 일치)
- 발견: **32건** (F1–F32; 중대 모순 2건 — F14, F15 / 구조적 4건 — F24, F25, F27, F32) + 모범 사례 **7건** (G1–G7)
- 제안: **18건** (high 4 / medium 8 / low 6)
