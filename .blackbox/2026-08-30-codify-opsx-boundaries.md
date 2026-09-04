Refs:
- openspec/config.yaml @ blob 9512d6568b30fc0f95e19771ec9ac51bf5f6b069
- CLAUDE.md @ blob 7b04b7e9f9e58c6cd8188c4fdb631e2750cee179

# Codify OPSX layer boundaries and divergence tripwires

## Owner input

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

## Decisions as settled

Settled serially, one AskUserQuestion each, background first:

- **D1 — layer boundaries** (settled by the owner's model statement):
  spec layer = OpenSpec only; execution layer = superpowers only (TDD
  everywhere; the bounded path of superpowers:brainstorming for
  `[design]` tasks); orchestration = team-up, never superpowers'
  subagent skills. superpowers:brainstorming's architectural path (its
  own spec docs under docs/superpowers/specs/ plus the writing-plans
  skill) is banned here — a second spec chain is a second truth.
  Measured basis: docs/superpowers/ has never existed in this repo, so
  the ban codifies practice.
- **D2 — divergence detection, execution + review dual** (owner picked
  the recommended option): three execution tripwires — a red test cannot
  be derived from the spec scenario; going green would contradict
  another delta scenario; settling a `[design]` detail would alter the
  approved contract — plus a review-stage obligation to read delta spec
  scenarios against the implementation. No numeric threshold was
  invented; the trigger set is deliberately concrete.
- **D3 — codification location, config.yaml + personal skill dual**
  (owner picked the recommended option): config.yaml carries the
  tool-injection grain (the CLI injects rules into every artifact and
  operation instruction), the dd-openspec skill carries the
  session-behavior grain, CLAUDE.md gets a one-line pointer. The skill
  side landed the same day in the skill's own blackbox
  (2026-08-30-layer-boundaries-and-divergence.md there).

## What this change lands

`openspec/config.yaml` apply guidance gains three lines: the divergence
tripwires, the repair heuristic (intent unchanged → update the artifacts
in place, any-direction ripple, and continue the same apply; intent
changed or scope exploded → a new change — OPSX's own "update preserves
context, new change provides clarity"), and the spec-bound review rule
(`openspec show --diff`, available from CLI 1.11.0, renders each delta
requirement against the main-spec requirement it replaces). CLAUDE.md's
opsx line is rephrased from phase language ("propose → approve →
implement → archive") to fluid-action language with the gate named as
authority, and a layer-boundaries pointer line is added.

## Rationale and internal processing

The owner's pipeline model was the structure the existing mixture
already aimed at; what was missing was written boundaries and an
operable divergence trigger. The sensed inefficiency was latent, not
realized: per-session re-adjudication between overlapping skills
(superpowers' session injection demands brainstorming before any
creative work), plus the drift risk that a literal architectural-path
reading would one day produce a competing artifact chain. "Not the
legacy way" reframed the owner's earlier "re-run the loop" into
repair-in-place: OPSX's fluid model makes mid-apply artifact repair the
native corrective move, so no loop restart exists to ceremonialize.

Verified before proposing: the Fission-AI CLI command surface has no
team feature (the repo's team rules are the owner's own composition;
config.yaml and dd-openspec define a team's existence and lifespan,
team-up its internal operation); changelog 1.7.0 states the default core
profile never generates /opsx:new and /opsx:continue, so this repo's six
commands are the complete current profile, not a legacy remnant; 1.11.0
adds `status --all` and `show --diff`. This change is docs/config only —
no externally observable contract moves, so the plain cycle applies (no
OpenSpec change proposal), and no changeset is required.
