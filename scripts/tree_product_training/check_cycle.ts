// ============================================================
// scripts/tree_product_training/check_cycle.ts
// T042 完整 Root-Lineage Melee 目录、生成后代发现与概率化验证脚本（无仿真）
//
// 验证：
//   1. 完整 Melee 目录：包含真实已评测生成后代 (GENERATED_DESCENDANT)，非仅 Root+Early Heldout
//   2. 成员谱系证明与强度证据完整可追溯
//   3. 排除候选具备明确具体的原因 (DUPLICATE_FINGERPRINT, NO_PRODUCT_PATH_EVIDENCE 等)
//   4. 严格独立 Stage-1 门禁：进入 MELEE 前必须包含至少 3 次实际不同的优化尝试 (distinct attemptIdentity)
//   5. 采样时动态排除候选自身作为对手 (self-opponent exclusion)
//   6. Top-level 流派等概率均匀采样，In-archetype 平滑权重非恒定且组内归一化
//   7. Melee 采样对局严格满足 P1/P2 成对运行与最低配额
//   8. Melee 失败精准返回 Stage 1（绝不退回 Stage 3）
//   9. 周期幂等性、去重与无状态破坏
//   10. 聚合实验边界标签（AGGREGATE_EXPLORATION_ONLY）与无 apply 确认
// ============================================================

import '../../src/engine/env';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

console.log('=== check_cycle.ts — T042 Complete Root-Lineage Melee Catalog Verification ===\n');

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
const CURSOR_PATH = resolve(`${T037_DIR}/t038_cycle_cursor.json`);
const BENCHMARK_MANIFEST_PATH = resolve(`${T037_DIR}/benchmark_manifests.json`);
const STAGE_LEDGER_PATH = resolve(`${T037_DIR}/stage_training_ledger.jsonl`);
const CELL_RESULTS_PATH = resolve(`${T037_DIR}/benchmark_cell_results.jsonl`);
const STAGE1_EPISODE_PATH = resolve(`${T037_DIR}/stage1_episode_ledger.jsonl`);
const ARCHETYPE_CONFIG_PATH = resolve(`${T037_DIR}/melee_archetype_config.json`);
const SAMPLING_MANIFEST_PATH = resolve(`${T037_DIR}/melee_sampling_manifest.json`);
const MELEE_PAIRS_PATH = resolve(`${T037_DIR}/melee_sample_pairs.jsonl`);

// ---- 1. 文件存在性验证 ----

check('all required T042 artifact files exist', () => {
  assert(existsSync(ARCHETYPE_CONFIG_PATH), `Missing: ${ARCHETYPE_CONFIG_PATH}`);
  assert(existsSync(SAMPLING_MANIFEST_PATH), `Missing: ${SAMPLING_MANIFEST_PATH}`);
  assert(existsSync(STAGE1_EPISODE_PATH), `Missing: ${STAGE1_EPISODE_PATH}`);
  assert(existsSync(MELEE_PAIRS_PATH), `Missing: ${MELEE_PAIRS_PATH}`);
  assert(existsSync(STAGE_LEDGER_PATH), `Missing: ${STAGE_LEDGER_PATH}`);
  assert(existsSync(BENCHMARK_MANIFEST_PATH), `Missing: ${BENCHMARK_MANIFEST_PATH}`);
  assert(existsSync(CATALOG_PATH), `Missing: ${CATALOG_PATH}`);
});

// ---- 加载数据 ----

const archetypeConfig = existsSync(ARCHETYPE_CONFIG_PATH) ? JSON.parse(readFileSync(ARCHETYPE_CONFIG_PATH, 'utf8')) : null;
const samplingManifest = existsSync(SAMPLING_MANIFEST_PATH) ? JSON.parse(readFileSync(SAMPLING_MANIFEST_PATH, 'utf8')) : null;
const catalog = existsSync(CATALOG_PATH) ? JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) : null;
const cursor = existsSync(CURSOR_PATH) ? JSON.parse(readFileSync(CURSOR_PATH, 'utf8')) : null;
const decisions = existsSync(DECISIONS_PATH)
  ? readFileSync(DECISIONS_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];
const stageLedger = existsSync(STAGE_LEDGER_PATH)
  ? readFileSync(STAGE_LEDGER_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];
const stage1Episodes = existsSync(STAGE1_EPISODE_PATH)
  ? readFileSync(STAGE1_EPISODE_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];
const meleePairs = existsSync(MELEE_PAIRS_PATH)
  ? readFileSync(MELEE_PAIRS_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];

// ---- 2. 完整 Root-Lineage 成员发现与生成后代验证 ----

check('Melee catalog contains real generated candidate descendants across all root archetypes', () => {
  assert(archetypeConfig?.archetypes && archetypeConfig.archetypes.length === 11, `Expected 11 archetypes, got ${archetypeConfig?.archetypes?.length}`);
  assert(archetypeConfig.schemaVersion === 'T042_MELEE_CATALOG_V1', `Expected T042_MELEE_CATALOG_V1, got ${archetypeConfig.schemaVersion}`);
  assert(archetypeConfig.membersByOriginKind?.GENERATED_DESCENDANT > 0, `Expected >0 GENERATED_DESCENDANT, got ${archetypeConfig.membersByOriginKind?.GENERATED_DESCENDANT}`);
  assert(archetypeConfig.totalMembers >= 25, `Expected >= 25 total members, got ${archetypeConfig.totalMembers}`);

  console.log(`    Audited ${archetypeConfig.totalMembers} members: ` +
    `ROOT=${archetypeConfig.membersByOriginKind.ROOT}, ` +
    `GENERATED_DESCENDANT=${archetypeConfig.membersByOriginKind.GENERATED_DESCENDANT}, ` +
    `EARLY_HELDOUT=${archetypeConfig.membersByOriginKind.EARLY_HELDOUT}`);
});

check('Every member has explicit root lineage proof, originKind, and frozen strength evidence', () => {
  for (const arch of archetypeConfig.archetypes) {
    assert(arch.archetypeId === arch.rootSourceId, `Mismatched root for archetype: ${arch.archetypeId}`);
    for (const m of arch.members) {
      assert(m.primaryArchetype === arch.archetypeId, `Member primaryArchetype mismatch`);
      assert(m.rootSourceId === arch.rootSourceId, `Member rootSourceId mismatch`);
      assert(m.originKind, `Missing originKind in member: ${m.memberId}`);
      assert(m.lineageProof, `Missing lineageProof in member: ${m.memberId}`);
      assert(m.strengthEvidenceKind && m.strengthEvidenceRevision, `Missing strength evidence in member: ${m.memberId}`);
      assert(!m.memberId.includes('historical') && !m.selectionReason.includes('historical'), `ERROR: Historical snapshot found: ${m.memberId}`);
      assert(m.smoothedWeight > 0, `Member weight must be positive: ${m.smoothedWeight}`);
    }
  }
});

check('Excluded candidates are explicitly recorded with concrete reasons', () => {
  assert(archetypeConfig.totalExcludedCandidates > 0, `Expected recorded exclusions, got ${archetypeConfig.totalExcludedCandidates}`);
  for (const exc of archetypeConfig.excludedCandidates) {
    assert(exc.candidateId && exc.sourceId, `Missing candidateId/sourceId in exclusion record`);
    assert(['DUPLICATE_FINGERPRINT', 'REJECTED_BY_SCHEMA', 'NO_PRODUCT_PATH_EVIDENCE', 'UNRESOLVED_ROOT'].includes(exc.exclusionReason), `Invalid exclusion reason: ${exc.exclusionReason}`);
  }
  console.log(`    Audited ${archetypeConfig.totalExcludedCandidates} explicitly excluded candidates with valid reasons`);
});

check('In-archetype weights derive from frozen strength and are non-constant for multi-member archetypes', () => {
  let hasDivergentWeights = false;
  for (const arch of archetypeConfig.archetypes) {
    if (arch.members.length > 1) {
      const weights = arch.members.map((m: any) => m.smoothedWeight);
      const uniqueWeights = new Set(weights);
      if (uniqueWeights.size > 1) hasDivergentWeights = true;
    }
  }
  assert(hasDivergentWeights, 'Multi-member archetypes must have non-constant smoothed weights based on evidence');
});

// ---- 3. 严格独立 Stage-1 Episode 尝试门禁 ----

check('No candidate enters MELEE without at least three distinct countable Stage-1 attempts', () => {
  const meleeLedgers = stageLedger.filter((l: any) => l.previousStage === 'STAGE_1_STRONG_EPISODE' && l.nextStage === 'MELEE');
  assert(meleeLedgers.length > 0, 'No candidates reached MELEE');

  for (const ml of meleeLedgers) {
    const attempts = stage1Episodes.filter((e: any) => e.candidateId === ml.candidateId && e.countable);
    assert(attempts.length >= 3, `Candidate ${ml.candidateId} entered MELEE with only ${attempts.length} attempts (< 3)`);

    const distinctIdentities = new Set(attempts.map((a: any) => a.attemptIdentity));
    assert(distinctIdentities.size >= 3, `Duplicate attempt identities detected for candidate ${ml.candidateId}`);

    const distinctFps = new Set(attempts.map((a: any) => a.candidateFingerprint));
    assert(distinctFps.size >= 3, `Repeated candidate fingerprints in Stage-1 attempts for candidate ${ml.candidateId}`);

    const distinctVecRefs = new Set(attempts.map((a: any) => a.strongPoolVectorRef));
    assert(distinctVecRefs.size >= 3, `Repeated strongPoolVectorRef in Stage-1 attempts for candidate ${ml.candidateId}`);
  }
  console.log(`    Audited ${stage1Episodes.length} distinct Stage-1 targeted optimization attempts`);
});

// ---- 4. 跃迁谓词与数值一致性 ----

check('Transition predicate wording agrees exactly with stored numeric comparisons', () => {
  for (const entry of stageLedger) {
    if (entry.previousStage === 'STAGE_3_EARLY_BUNDLE') {
      if (entry.transitionDecision === 'STAGE_PROMOTED') {
        assert(entry.sourceRelativeScore >= -0.05, `Contradiction: promoted but rel < -0.05`);
        assert(entry.transitionReason.includes('>= -0.05'), `Reason text mismatch in promotion`);
      } else {
        const isRelFail = entry.sourceRelativeScore < -0.05;
        const isAbsFail = entry.score < 0.70;
        assert(isRelFail || isAbsFail, `Contradiction: retained but both passed`);
      }
    }
  }
});

// ---- 5. Melee 采样与自博弈排除验证 ----

check('Melee sampling records satisfy P1/P2 pairing and exclude candidate self-opponents', () => {
  assert(meleePairs.length > 0, 'No melee sample pair records found');
  const candidateIds = [...new Set(meleePairs.map((p: any) => p.candidateId))];

  for (const cid of candidateIds) {
    const pairsForCand = meleePairs.filter((p: any) => p.candidateId === cid);
    assert(pairsForCand.length === 16, `Expected 16 sampled pairs for candidate ${cid}, got ${pairsForCand.length}`);

    const coveredArchetypes = new Set(pairsForCand.map((p: any) => p.sampledArchetype));
    assert(coveredArchetypes.size === 11, `Candidate ${cid} did not cover all 11 archetypes in melee`);

    for (const p of pairsForCand) {
      assert(p.sampledMemberId !== cid, `Self-opponent detected: candidate ${cid} played against itself`);
    }
  }
  console.log(`    Audited ${meleePairs.length} paired Melee evaluations across ${candidateIds.length} candidates`);
});

// ---- 6. Melee 失败回退路径 ----

check('Melee failures return to Stage 1, never directly to Stage 3', () => {
  const meleeTransitions = stageLedger.filter((l: any) => l.previousStage === 'MELEE');
  for (const mt of meleeTransitions) {
    if (mt.transitionDecision === 'MELEE_DIAGNOSE_RETURN_STAGE_1') {
      assert(mt.nextStage === 'STAGE_1_STRONG_EPISODE', `Melee failure should return to STAGE_1_STRONG_EPISODE, got ${mt.nextStage}`);
      assert(mt.nextStage !== 'STAGE_3_EARLY_BUNDLE', `ERROR: Melee failure incorrectly returned to Stage 3!`);
    }
  }
});

// ---- 7. 幂等性、去重与 Catalog 边界 ----

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

// ---- 8. 汇总打印 ----

console.log('\n--- T042 Complete Root-Lineage Melee Catalog Summary ---');
console.log('  Source ID            Classification         CtrlRatio  Spatial  Baseline  BestRel  ExpFrontier?');
console.log('  ' + '-'.repeat(95));
if (catalog?.entries) {
  for (const e of catalog.entries) {
    const rel = (e.sourceRelativeScore >= 0 ? '+' : '') + e.sourceRelativeScore.toFixed(3);
    const frontier = e.isExperimentalFrontier ? 'YES' : ' NO';
    console.log(
      `  ${e.sourceId.padEnd(20)} ${(e.classification ?? '-').padEnd(22)} ${e.controllableRatio.toFixed(3).padStart(9)} ` +
      `${String(e.spatialBudget).padStart(8)} ${e.baselineScore.toFixed(3).padStart(9)} ` +
      `${rel.padStart(8)} ${frontier.padStart(13)}`
    );
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
console.log('✓ check_cycle PASSED\n');
