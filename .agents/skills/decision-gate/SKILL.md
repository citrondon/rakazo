---
name: decision-gate
description: Decide whether a classifier, router, ranker, or triage helper earns a place in the codebase, and keep a written kill list of what it had to beat. Use when proposing or reviewing a model-backed or heuristic decision, adding a routing, ranking, or triage step, or replacing an existing heuristic with a learned call.
---

# Gate a decision before it ships

A decision helper — a router that picks a skill or a tool, a ranker that orders
candidates, a triage that labels an event — is a hypothesis: that it beats the
code we could have written instead. This is how that hypothesis is tested here,
and how it is killed when it loses.

The helper never owns correctness. It returns a hint that code validates, or it
changes nothing. A timeout, an error, a malformed answer, or a low-confidence
answer leaves the request exactly as it was.

## Eligibility

All three must hold, or stop and do not build it.

1. Someone knowledgeable makes this call in about a second, given the state.
2. The state is already in hand and becomes a typed question — one option from a
   known set, a position on a scale, or a yes/no.
3. Being wrong is cheap. The answer is a hint, or code validates it. It is never
   authority over whether work is correct.

## The bar

Eligibility ships nothing on its own. Two measurements must clear:

- **L1, the case file.** Score it on real examples we own: hits, wrong picks,
  misses, latency, cost. No corpus, no ship.
- **L2, the agent.** With the helper on, does the agent actually do better?
  Passing L1 is not passing L2.

Both baselines must lose to it:

- the **dumb heuristic** it replaces, and
- **chance**.

Beating chance is not winning. The reference record has a ranker that beat chance
(31% against 30%) and still died because a path heuristic scored 33%.

## Shipping it

Every winner ships behind its own flag and stays **off** until it wins. Every
loser is killed and recorded. The kill list is a deliverable, not a footnote:
name the candidate, the numbers, and why it died, so nobody rebuilds it.

Price a candidate before proposing it — per-decision cost, plus the corpus run
and the L2 run.

## Known traps

- **Confidence is calibrated across a group, not per answer.** A hard-scored rule
  can still be a false positive, and an average confidence measured at chance
  means the signal is not in the state. Threshold tuning does not create signal
  that is not there.
- **Assertion reads as evidence.** A bare "all tests pass" scores high on whether
  a claim was made, not on whether anything ran. Never let a helper judge a
  completion claim.
- **More options degrade the choice.** Past roughly 30 options a picker
  approaches chance, so treat a large catalog as a narrowing problem first.

## Where this lands here

- Pure predicates are the baseline. `packages/core/src/trigger-filter.ts` and
  `trigger-engine.ts` narrow events with deterministic code; a learned variant
  must beat them on a corpus we own.
- Anything that picks a model, a skill, or a tool subset — see
  `packages/adapters/src/model-selection.ts` — is a router and needs this gate.
- The helper belongs behind a provider-neutral interface, off by default, with a
  deterministic offline conformance test and no provider-specific environment
  variable. That is the adapter contract in `AGENTS.md`, restated here only so
  the gate is readable in one place.

## Provenance

The gate, the baselines, and the traps are taken from `emirbartu/jev-for-all`
("When Jev wins"), the measured field record for TypeSafe's System One decision
model. The plugin itself is not adopted: it wires OpenCode hooks, and we run
Cline, so nothing in it installs here. The method is provider-neutral, and the
method is what transfers.
