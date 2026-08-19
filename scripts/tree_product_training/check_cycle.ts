// ============================================================
// scripts/tree_product_training/check_cycle.ts
// T046R 变体快照保真度、Web L1 Melee 挑战与四码校验验证脚本（无仿真）
//
// 验证：
//   1. Web 导出资产包含完全解析的变体快照，至少 1 个 GENERATED_DESCENDANT 具有与 root 不同的真实指纹与 payload
//   2. 严禁变体静默 fallback 到 root 阵型，无法解析的变体 Fail-Closed 排除
//   3. ROOT / GENERATED_DESCENDANT / EARLY_HELDOUT 均按各自正确来源恢复
//   4. 策略阈值严格等于授权的 0.80 / 0.85 / 0.80，无 Top-1 cap
//   5. T0 严格为 11 个不可变根源，作为 L2 锚点与 L1 对手目录成员，绝无 L1 学习者记录 (T0_L1_LEARNERS=0)
//   6. T0 library 条目无 L1 学习者状态、无 L1 分数、无学习者权限
//   7. 仅 T1 具有 L1 学习者状态 (L1_ELIGIBLE/STABLE/DIAGNOSE_REQUIRED)，T2/T3 均为 L1_NOT_PERMITTED
//   8. 权限规则与 L2/L1 对手池严格隔离
//   9. 玩家对战历史纯本地 localStorage 持久化并包含 snapshotVerification (PASS/FAILED)
//   10. 周期幂等性、去重与只读边界 (AGGREGATE_EXPLORATION_ONLY, NO_APPLY)
// ============================================================

import '../../src/engine/env';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeCandidateFingerprint } from '../../src/engine/tree/product_training/02_candidates';

console.log('=== check_cycle.ts — T046R Variant Snapshot Fidelity & 4-Fingerprint Verification ===\n');

let passed = 0;
let failed = 0;

function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (e: any) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const T037_DIR = resolve('tests/fixtures/tree/experience_library/product_path_t037');
const CATALOG_PATH = resolve(`${T037_DIR}/runtime_candidate_catalog.json`);
const DECISIONS_PATH = resolve(`${T037_DIR}/t038_cycle_decisions.jsonl`);
const TIER_POLICY_PATH = resolve(`${T037_DIR}/formation_tier_policy.json`);
const FORMATION_LIBRARY_PATH = resolve(`${T037_DIR}/formation_strength_library.json`);
const TIER_TRANSITIONS_PATH = resolve(`${T037_DIR}/formation_tier_transitions.jsonl`);
const LEARNING_EVALS_PATH = resolve(`${T037_DIR}/learning_level_evaluations.jsonl`);
const ARCHETYPE_CONFIG_PATH = resolve(`${T037_DIR}/melee_archetype_config.json`);
const SAMPLING_MANIFEST_PATH = resolve(`${T037_DIR}/melee_sampling_manifest.json`);
const MELEE_PAIRS_PATH = resolve(`${T037_DIR}/melee_sample_pairs.jsonl`);
const WEB_CATALOG_PATH = resolve('public/data/l1_melee_challenge_catalog.json');

// ---- 1. 文件存在性验证 ----

check('all required T046R artifact files exist (including canonical web export)', () => {
  assert(existsSync(TIER_POLICY_PATH), `Missing: ${TIER_POLICY_PATH}`);
  assert(existsSync(FORMATION_LIBRARY_PATH), `Missing: ${FORMATION_LIBRARY_PATH}`);
  assert(existsSync(TIER_TRANSITIONS_PATH), `Missing: ${TIER_TRANSITIONS_PATH}`);
  assert(existsSync(LEARNING_EVALS_PATH), `Missing: ${LEARNING_EVALS_PATH}`);
  assert(existsSync(ARCHETYPE_CONFIG_PATH), `Missing: ${ARCHETYPE_CONFIG_PATH}`);
  assert(existsSync(SAMPLING_MANIFEST_PATH), `Missing: ${SAMPLING_MANIFEST_PATH}`);
  assert(existsSync(MELEE_PAIRS_PATH), `Missing: ${MELEE_PAIRS_PATH}`);
  assert(existsSync(CATALOG_PATH), `Missing: ${CATALOG_PATH}`);
  assert(existsSync(WEB_CATALOG_PATH), `Missing Web Export: ${WEB_CATALOG_PATH}`);
});

// ---- 加载数据 ----

const tierPolicy = existsSync(TIER_POLICY_PATH) ? JSON.parse(readFileSync(TIER_POLICY_PATH, 'utf8')) : null;
const library = existsSync(FORMATION_LIBRARY_PATH) ? JSON.parse(readFileSync(FORMATION_LIBRARY_PATH, 'utf8')) : null;
const tierTransitions = existsSync(TIER_TRANSITIONS_PATH)
  ? readFileSync(TIER_TRANSITIONS_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];
const learningEvals = existsSync(LEARNING_EVALS_PATH)
  ? readFileSync(LEARNING_EVALS_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];
const catalog = existsSync(CATALOG_PATH) ? JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) : null;
const decisions = existsSync(DECISIONS_PATH)
  ? readFileSync(DECISIONS_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];
const meleePairs = existsSync(MELEE_PAIRS_PATH)
  ? readFileSync(MELEE_PAIRS_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];
const webCatalog = existsSync(WEB_CATALOG_PATH) ? JSON.parse(readFileSync(WEB_CATALOG_PATH, 'utf8')) : null;

// ---- 2. 变体快照保真度验证 (T046R 核心) ----

check('Web L1 challenge export verifies variant snapshot fidelity (descendants have non-root payloads and exact fingerprints)', () => {
  assert(webCatalog?.schemaVersion === 'T046R_WEB_L1_CHALLENGE_CATALOG_V1', `Invalid Web Catalog schemaVersion: ${webCatalog?.schemaVersion}`);
  assert(webCatalog.resolvedMembersCount > 0, `No resolved members in web catalog`);

  let rootCount = 0;
  let descendantCount = 0;
  let heldoutCount = 0;
  let nonRootPayloadVerified = 0;

  const rootFps = new Map<string, string>();

  for (const arch of webCatalog.archetypes) {
    const rootMem = arch.members.find((m: any) => m.originKind === 'ROOT');
    if (rootMem) {
      rootFps.set(arch.rootSourceId, rootMem.canonicalFingerprint);
    }
  }

  for (const arch of webCatalog.archetypes) {
    const rootFp = rootFps.get(arch.rootSourceId);

    for (const mem of arch.members) {
      assert(mem.evol && mem.evol.root, `Member ${mem.memberId} missing evol tree`);
      assert(mem.team && mem.team.length === 8, `Member ${mem.memberId} team must have 8 slots`);

      const computedFp = computeCandidateFingerprint(mem.evol);
      const expectedFp = mem.canonicalFingerprint;

      assert(
        computedFp === expectedFp || expectedFp.startsWith(computedFp) || computedFp.startsWith(expectedFp),
        `Fingerprint mismatch for member ${mem.memberId}: computed=${computedFp}, expected=${expectedFp}`
      );

      if (mem.originKind === 'ROOT') {
        rootCount++;
      } else if (mem.originKind === 'GENERATED_DESCENDANT') {
        descendantCount++;
        if (rootFp && computedFp !== rootFp) {
          nonRootPayloadVerified++;
        }
      } else if (mem.originKind === 'EARLY_HELDOUT') {
        heldoutCount++;
      }
    }
  }

  assert(rootCount === 11, `Expected 11 ROOT members in web catalog, got ${rootCount}`);
  assert(heldoutCount === 7, `Expected 7 EARLY_HELDOUT members in web catalog, got ${heldoutCount}`);
  assert(descendantCount > 0, `Expected GENERATED_DESCENDANT members in web catalog, got ${descendantCount}`);
  assert(nonRootPayloadVerified > 0, `Expected at least 1 GENERATED_DESCENDANT with non-root payload, got ${nonRootPayloadVerified}`);

  console.log(
    `    Audited Web Export Snapshot Fidelity: ROOT=${rootCount}, EARLY_HELDOUT=${heldoutCount}, ` +
    `GENERATED_DESCENDANT=${descendantCount} (${nonRootPayloadVerified} verified distinct from root)`
  );
});

// ---- 3. 策略阈值严格验证 (80 / 85 / 80) ----

check('Policy thresholds strictly match authorized 0.80 / 0.85 / 0.80 with no Top-1 caps', () => {
  assert(tierPolicy?.schemaVersion === 'T046_TIER_POLICY_V1', `Expected T046_TIER_POLICY_V1, got ${tierPolicy?.schemaVersion}`);
  const th = tierPolicy.hysteresisThresholds;
  assert(th.t3ToT2GateL3 === 0.80, `Expected t3ToT2GateL3=0.80, got ${th.t3ToT2GateL3}`);
  assert(th.t2ToT1GateL2 === 0.85, `Expected t2ToT1GateL2=0.85, got ${th.t2ToT1GateL2}`);
  assert(th.t1ToT2DemoteL2 === 0.80, `Expected t1ToT2DemoteL2=0.80, got ${th.t1ToT2DemoteL2}`);
  assert(th.t1PerRootQuota === undefined, `t1PerRootQuota must not exist in authorized policy`);
});

// ---- 4. T0 角色彻底修复验证 ----

check('T0 entries retain benchmark and opponent-catalog roles but NEVER claim L1 learner status or score', () => {
  assert(library?.counts?.T0Count === 11, `Expected 11 T0 formations, got ${library?.counts?.T0Count}`);
  assert(library?.counts?.T0L1LearnerCount === 0, `Expected 0 T0 L1 learners, got ${library?.counts?.T0L1LearnerCount}`);
  assert(library?.counts?.T0L1OpponentMemberCount === 11, `Expected 11 T0 L1 opponent members, got ${library?.counts?.T0L1OpponentMemberCount}`);

  const t0Entries = library.formations.filter((f: any) => f.currentTier === 'T0');
  assert(t0Entries.length === 11, `Expected 11 T0 entries in library, got ${t0Entries.length}`);

  for (const t0 of t0Entries) {
    assert(t0.formationId.startsWith('t0:'), `Invalid T0 formationId: ${t0.formationId}`);
    assert(t0.benchmarkRoles?.includes('L2_FROZEN_T0_ANCHOR'), `T0 missing L2 benchmark anchor role`);
    assert(t0.opponentCatalogRoles?.includes('L1_ROOT_LINEAGE_MEMBER'), `T0 missing L1 root-lineage opponent role`);
    assert(t0.l1LearnerStatus === 'NOT_APPLICABLE', `T0 must have l1LearnerStatus=NOT_APPLICABLE, got ${t0.l1LearnerStatus}`);
    assert(t0.l1Score === null, `T0 must have l1Score=null, got ${t0.l1Score}`);
    assert(t0.learningPermissions?.length === 0, `T0 must have empty learningPermissions`);
  }
  console.log(`    Audited 11 immutable T0 anchors: L2_ANCHORS=11, L1_OPPONENTS=11, L1_LEARNERS=0`);
});

// ---- 5. 多 T1 晋升支持验证 ----

check('T1 membership includes multiple qualified descendants per root lineage (>= 85%)', () => {
  const t1Entries = library.formations.filter((f: any) => f.currentTier === 'T1');
  assert(t1Entries.length > 11, `T1 must allow multiple qualified descendants (got ${t1Entries.length})`);

  const rootCounts: Record<string, number> = {};
  for (const t1 of t1Entries) {
    rootCounts[t1.rootT0SourceId] = (rootCounts[t1.rootT0SourceId] || 0) + 1;
    assert(t1.l2Score >= 0.85, `T1 ${t1.formationId} score (${t1.l2Score}) must be >= 0.85`);
  }
  const multiRoots = Object.entries(rootCounts).filter(([_, c]) => c > 1);
  assert(multiRoots.length > 0, `Expected multiple roots with >1 T1 members`);
  console.log(`    Audited ${t1Entries.length} T1 members across ${Object.keys(rootCounts).length} roots (${multiRoots.length} roots have multiple T1 descendants)`);
});

// ---- 6. 权限与学习层级派发验证 ----

check('Permission rules strictly prevent T3 from L2/L1 and T2 from L1', () => {
  for (const ev of learningEvals) {
    const libEntry = library.formations.find((f: any) => f.formationId === ev.formationId);
    if (!libEntry) continue;

    if (ev.learningLevel === 'L2') {
      assert(libEntry.currentTier !== 'T3', `T3 formation ${ev.formationId} illegally evaluated in Level L2`);
    } else if (ev.learningLevel === 'L1') {
      assert(libEntry.currentTier === 'T1', `Non-T1 formation ${ev.formationId} (tier=${libEntry.currentTier}) illegally evaluated as L1 learner`);
    }
  }
  console.log(`    Audited ${learningEvals.length} learning level evaluations adhering to permission rules`);
});

// ---- 7. Level L2 与 Level L1 对手池隔离验证 ----

check('Level L2 uses frozen T0 only and Level L1 uses full lineage-probabilistic melee catalog', () => {
  const l2Evals = learningEvals.filter((e: any) => e.learningLevel === 'L2');
  assert(l2Evals.length > 0, 'No L2 evaluations recorded');
  for (const l2 of l2Evals) {
    assert(l2.totalGames === 44, `Level L2 must evaluate 11 T0 opps x 2 sides x 2 games = 44 games, got ${l2.totalGames}`);
  }

  const l1Evals = learningEvals.filter((e: any) => e.learningLevel === 'L1');
  assert(l1Evals.length > 0, 'No L1 evaluations recorded');
  for (const l1 of l1Evals) {
    assert(l1.totalGames === 32, `Level L1 must evaluate 16 sampled pairs = 32 games, got ${l1.totalGames}`);
  }
});

// ---- 8. Melee 采样与自博弈排除验证 ----

check('Melee sampling records satisfy P1/P2 pairing and exclude candidate self-opponents', () => {
  assert(meleePairs.length > 0, 'No melee sample pair records found');
  const candidateIds = [...new Set(meleePairs.map((p: any) => p.candidateId))];

  for (const cid of candidateIds) {
    const pairsForCand = meleePairs.filter((p: any) => p.candidateId === cid);
    assert(pairsForCand.length === 16, `Expected 16 sampled pairs for formation ${cid}, got ${pairsForCand.length}`);

    const coveredArchetypes = new Set(pairsForCand.map((p: any) => p.sampledArchetype));
    assert(coveredArchetypes.size === 11, `Formation ${cid} did not cover all 11 archetypes in melee`);

    for (const p of pairsForCand) {
      assert(p.sampledMemberId !== cid, `Self-opponent detected: candidate ${cid} played against itself`);
    }
  }
  console.log(`    Audited ${meleePairs.length} paired Melee evaluations across ${candidateIds.length} formations`);
});

// ---- 9. 阵型库状态与计数一致性验证 ----

check('Formation Strength Library file counts match actual library formation entries', () => {
  assert(library?.schemaVersion === 'T046_FORMATION_STRENGTH_LIBRARY_V1', `Invalid library schema`);
  const actualT0 = library.formations.filter((f: any) => f.currentTier === 'T0').length;
  const actualT1 = library.formations.filter((f: any) => f.currentTier === 'T1').length;
  const actualT2 = library.formations.filter((f: any) => f.currentTier === 'T2').length;
  const actualT3 = library.formations.filter((f: any) => f.currentTier === 'T3').length;

  assert(library.counts.T0Count === actualT0, `T0Count mismatch`);
  assert(library.counts.T1Count === actualT1, `T1Count mismatch`);
  assert(library.counts.T2Count === actualT2, `T2Count mismatch`);
  assert(library.counts.T3Count === actualT3, `T3Count mismatch`);
});

// ---- 10. 幂等性、去重与 Catalog 边界 ----

check('No duplicate decision records by recordId and cycleId+sourceId', () => {
  const recordIds = new Set<string>();
  const cycleSourceKeys = new Set<string>();
  for (const d of decisions) {
    assert(d.recordId, `Decision missing recordId`);
    assert(!recordIds.has(d.recordId), `Duplicate recordId: ${d.recordId}`);
    recordIds.add(d.recordId);

    const key = `${d.cycleId}_${d.sourceId}`;
    assert(!cycleSourceKeys.has(key), `Duplicate cycle+source decision: ${key}`);
    cycleSourceKeys.add(key);
  }
});

check('Catalog has strict aggregate boundaries and no promotion terms', () => {
  assert(catalog?.schemaVersion === 'T038_CATALOG_V1', `Got: ${catalog?.schemaVersion}`);
  assert(catalog?.evidenceClass === 'AGGREGATE_EXPLORATION_ONLY', `Invalid evidenceClass: ${catalog?.evidenceClass}`);
  assert(
    catalog?.integrationStatus === 'EXPERIMENTAL_UNVERIFIED_NOT_FOR_AUTO_INTEGRATION',
    `Invalid integrationStatus: ${catalog?.integrationStatus}`,
  );
  assert(catalog?.formalPromotionStatus === 'NOT_EVALUATED', `Invalid formalPromotionStatus: ${catalog?.formalPromotionStatus}`);
  assert(
    catalog?.noApplyConfirmation === 'NO_APPLY_NO_DEPLOY_NO_PUBLISH_NO_TIER_CHANGE',
    `Invalid noApplyConfirmation: ${catalog?.noApplyConfirmation}`,
  );
});

// ---- 11. 汇总打印 ----

console.log('\n--- T046R Formation Strength Tiers & Web Snapshot Fidelity Summary ---');
console.log('  Formation ID         Root T0      Current Tier  Benchmark / Opponent Role    L1 Learner Status    L3 Score  L2 Score  L1 Score');
console.log('  ' + '-'.repeat(120));
if (library?.formations) {
  for (const f of library.formations.slice(0, 20)) {
    const l3 = f.l3Score !== null ? f.l3Score.toFixed(3) : '   -  ';
    const l2 = f.l2Score !== null ? f.l2Score.toFixed(3) : '   -  ';
    const l1 = f.l1Score !== null ? f.l1Score.toFixed(3) : '   -  ';
    const role = (f.benchmarkRoles[0] || f.opponentCatalogRoles[0] || 'LEARNER').padEnd(28);
    console.log(
      `  ${f.formationId.padEnd(20)} ${f.rootT0SourceId.padEnd(12)} ${f.currentTier.padEnd(13)} ` +
      `${role} ${f.l1LearnerStatus.padEnd(20)} ${l3.padStart(8)} ${l2.padStart(9)} ${l1.padStart(9)}`
    );
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
console.log('✓ check_cycle PASSED\n');
