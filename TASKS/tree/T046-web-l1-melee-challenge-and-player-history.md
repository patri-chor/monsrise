STATUS: OPEN
DOMAIN: tree

# T046 - Web L1 Melee Challenge and Player Battle History

> Domain: `tree` | Executor branch: `agent/tree`
> Integrate the continuously refreshed L1 lineage-probabilistic melee pool into the existing web **人机对战 / VS AI** entry as a playable player-vs-AI challenge. Preserve manual player team selection, manual deployment, real-time battle UI, and player history. This is not a background AI-vs-AI trainer and must not feed player outcomes back into training evidence, weights, tiers, or catalog selection.

## A. Preserve Authorized Training Policy

Current authorized strength policy remains:

```text
T3 -> T2: L3 >= 80%
T2 -> T1: L2 >= 85%
```

Do not restore 55%/60%/55%. Remove only any unapproved Top-1-per-root restriction: every formation meeting the authorized L2 strength threshold may be T1. Preserve the completed T0 role correction:

```text
T0 is immutable L2 anchor / L1 opponent catalog member
T0 is never an L1 learner
```

## B. Live Web-Consumable L1 Challenge Export

The browser cannot consume server filesystem-only product-training files directly. Extend the training cycle to publish a **read-only web artifact** whenever a new eligible L1 revision is built, e.g. a versioned JSON under a public/static web-served path.

The artifact must include only the data needed to play a challenge:

```text
schemaVersion
meleeRevision / manifest hash / generatedAt
base seed / deterministic sampler version
root T0 archetypes and uniform top-level probability
eligible opponent snapshots:
  member ID
  canonical fingerprint
  root T0 source
  formation/tree/team data required by web battle adapter
  frozen in-archetype weight
  provenance / origin kind
```

Requirements:

```text
web artifact is atomic/versioned and validates hash/schema before use
browser fetches latest artifact at VS AI entry time, with a stale-safe cached last valid revision fallback
same revision + sampling seed chooses deterministically
current player team must never be considered an L1 training member or write into this export
missing/invalid artifact fails visibly and safely; it never falls back to rule-random or arbitrary BattleAI generation
```

If client bundles require build/reload to consume a new static artifact, document the operational behavior. The artifact data itself must update independently of a client code rebuild.

## C. Replace Existing VS AI Opponent Selection Only

Existing web flow is currently:

```text
TeamEditorUI #lobbyAiModeBtn
-> creates a normal BattleAI
-> builds arbitrary team from all monsters
-> enters manual player preparation/battle
```

Replace the AI opponent generation portion only:

```text
click 人机对战 / VS AI
-> fetch/validate latest L1 challenge revision
-> sample root T0 archetype uniformly
-> sample opponent in root lineage by frozen weight
-> create web-compatible opponent strategy from selected snapshot
-> preserve player's selected team, manual preparation, and battle lifecycle
```

Do not launch a long-running headless training loop from the button.

Before player deployment, show concise in-game opponent identification appropriate to the existing UI:

```text
opponent display name / member ID
root T0 archetype
melee revision short hash
```

Do not expose internal training controls or raw JSON in the game UI.

The selected opponent must execute the selected snapshot's actual tree/strategy behavior through a web-compatible adapter. Do not silently replace it with generic `BattleAI.buildTeam`. Validate its team/tree/snapshot payload before battle; failure must return user to team editor with an actionable error and preserve the player team.

## D. Player History Is Separate From Training Evidence

Persist player-vs-L1 challenge history locally in the browser, e.g. localStorage `monsrise.l1ChallengeHistory.v1`. It is never appended to:

```text
product_training evidence JSONLs
melee strength evidence
formation tier transitions
L1 member weights
candidate training scores
```

Each completed player match records:

```text
record ID / completedAt
player team snapshot fingerprint (or stable anonymized local fingerprint)
selected opponent member ID / fingerprint / root T0 source
melee revision / manifest hash / sampling seed
player side
winner / draw / player outcome
round count or battle summary available from web engine
schema version
```

History must be bounded (for example latest 200 records), robust to schema upgrades, and removable from the UI with an explicit clear-history control. Player history should be visible through an existing or small dedicated in-game history view/panel, showing aggregate player W/D/L and recent matches grouped by root T0 archetype. It must not be styled as a marketing surface.

## E. Correct L1 Player Semantics

- T0 may appear as a sampled **opponent**.
- T1/T2/T3 snapshots may appear only if eligible in the current exported L1 catalog.
- Player battle is a challenge/experience record, not an L1 learner evaluation. Do not assign player team any T/L tier or L1 learner status.
- The web challenge follows the current frozen revision. A new training revision affects future VS AI entries only; an already started battle retains its selected snapshot.
- Keep P1/P2 coordinate/strategy semantics correct. If player side is fixed by current UI, record that accurately rather than inventing an alternate-side result.

## F. Verification

Add focused automated checks plus browser-level verification where available:

```text
web export matches a valid current L1 manifest and only contains eligible members
root selection is uniform and in-root selection honors frozen nonzero weights
same revision/seed is deterministic; invalid artifact does not choose generic/random AI
VS AI button preserves player manual team/preparation and starts a selected L1 snapshot opponent
selected opponent tree behavior is used, not generic all-monster BattleAI build
player history writes only local browser storage and never training artifacts
history fields are complete; bounded retention and clear control work
T0 appears only as opponent/anchor, never web L1 learner
authorized 80% / 85% policy is retained; Top-1-per-root cap absent
no apply/deploy/publish, no arena/rule-random/separation/self-play route
```

For the web GUI, build the affected web/client artifacts, then verify the existing DSH GUI page after refresh. Do not start a replacement web server. If HMR is claimed, verify the required watcher is running first.

## Acceptance

- [ ] Existing 人机对战 reliably launches a playable L1 challenge against a sampled current pool snapshot.
- [ ] Latest valid training revision is consumed on future entries without mixing player history into training.
- [ ] Player records survive reload locally and can be reviewed/cleared.
- [ ] T0/T1/T2/T3 permissions and authorized 80%/85% training policy remain correct.
- [ ] No automatic game-library integration or active formation replacement.

## Delivery

Write `TASKS/tree/T046.report.md` with web export revision/schema; root/member sample proof; web adapter call path; player-history schema and storage isolation proof; UI screenshots or browser verification results; build/reload operational notes; policy audit; test/check commands; and no-apply confirmation. Commit/push only `agent/tree`.
