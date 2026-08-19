# notes/

설계 과정에서 오너에게 설명된 배경 지식·판단 근거를 보존하는 폴더입니다.
스펙(`docs/specs/`)이 "무엇을 결정했는가"를 기록한다면, 여기는 "왜 그런
결정이 필요했는가"를 결정 당시의 설명 그대로 남깁니다. 블로그 등 외부
글에서 인용하는 것을 염두에 둔 기록입니다.

> **Language note.** This folder is written in Korean by explicit owner
> request (2026-08-19) — the notes are intended for quotation in
> Korean-language posts. It is a deliberate exception to the repository's
> "all GitHub-facing text in English" rule; that rule still applies
> everywhere else.

## 목차

| 노트 | 주제 | 관련 결정 |
|------|------|-----------|
| [alter default privileges](2026-08-19-alter-default-privileges.md) | 새로 만들어질 테이블에 자동으로 권한을 주는 문법이 왜 필요한가, Drizzle은 어떻게 하는가, hejbro의 grants UX와 순서 보장 | Phase 4 A5 (#5, #61) |
| [force row level security](2026-08-19-force-row-level-security.md) | 테이블 소유자는 RLS를 기본으로 우회한다 — 조용히 뚫리는 함정과 `force`의 역할 | Phase 4 A7a (#5, #61) |
| [security_invoker 뷰](2026-08-19-security-invoker-views.md) | 뷰는 만든 사람 권한으로 실행된다 — 뷰 하나로 RLS가 무효화되는 사고와 PG 15의 해법 | Phase 4 A7b (#5, #61) |

세 결정 모두 2026-08-19 Phase 4 brainstorm에서 오너 승인으로 확정되었다.
