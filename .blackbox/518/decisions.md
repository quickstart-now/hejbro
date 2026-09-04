# Decisions — quickstart-now/hejbro#518

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="d1"></a>
## D1 — Owner input

_owner · 2026-08-30T00:00Z_

The owner opened by checking a premise: "When I said to use openspec,
did you take that to mean dd-openspec? What I meant was
https://github.com/Fission-AI/openspec — let's pin this down." After the
assistant verified the repo runs the actual Fission-AI tool (installed
CLI 1.10.0; the `/opsx` command files call the CLI with
`allowed-tools: Bash(openspec:*)`; `openspec/config.yaml` uses
`schema: spec-driven`) and that the personal dd-openspec skill is a
convention layer on top rather than a substitute, the owner accepted
this and raised the real question: "I've been wondering whether mixing
superpowers brainstorming in is actually efficient."

Asked what to clarify, the owner stated a target model: "OpenSpec
produces the spec; Superpowers takes the produced spec and generates
code TDD-first; review must run against the OpenSpec spec. The actual
implementation should be wired to Superpowers only. And when spec and
implementation diverge too far, the spec itself is judged wrong — re-run
the loop, or take some other corrective measure."

Mid-analysis the owner added: "I understand team matters are also inside
openspec — compare that with the team-up I use." Then the owner quoted
the OPSX doc's philosophy (actions, not phases; dependencies are
enablers; proposal → specs → design → tasks → implement) pointing at
docs/opsx.md, and declared: "I don't want to do it the legacy way."

