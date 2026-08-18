import '../src/engine/env';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { PersistentSimPool } from '../src/engine/tree/persistent_pool';
import {
  formationToEvol,
  evolToBundleFormation,
  walkEvolNodes,
  type EvolFormation,
  type FeatureMask,
} from '../src/engine/tree/evol_gene';
import { validateTreeDeckCoherence } from '../src/engine/tree/order_search';
import { resolveEvaluationPanel } from '../src/engine/tree/candidate_optimization_runner';
import type { Formation } from '../src/ai/types';

// ---------- 1. 指纹计算与保真验证 ----------

export function getCanonicalTreeFingerprint(evol: EvolFormation): string {
  const parts: string[] = [];
  parts.push(`team:${evol.team.map(t => `${t.monsterId}[${(t.badgeIds ?? []).join(',')}]`).join('|')}`);
  for (const n of walkEvolNodes(evol.root)) {
    const pStr = n.placements.map(p => `${p.monsterId}@${p.x},${p.y}`).join(';');
    const cStr = JSON.stringify(n.condition);
    parts.push(`node:${n.id}:${n.round}:c[${cStr}]:p[${pStr}]`);
  }
  return parts.join('#');
}

export function canonicalizeEliteFormation(raw: any): EvolFormation {
  // 如果 raw 包含 tree（且 tree 节点有 placements），则是 Evol 结构存为 tree
  let rootNode = raw.root ?? raw.tree;
  if (!rootNode) {
    throw new Error(`Elite ${raw.candidateId} missing root/tree node`);
  }

  // 如果节点包含 placement（单数），则是 bundle 格式，走 formationToEvol
  if (rootNode.placement !== undefined && rootNode.placements === undefined) {
    return formationToEvol(raw as unknown as Formation);
  }

  // 否则本身就是 EvolFormation 结构
  const evol: EvolFormation = {
    name: raw.name ?? raw.sourceSeedName ?? raw.candidateId,
    archetype: raw.archetype ?? 'prayer',
    team: raw.team,
    root: rootNode,
  };

  // 验证 placements 非空保真
  let totalPlacements = 0;
  for (const n of walkEvolNodes(evol.root)) {
    totalPlacements += n.placements.length;
  }
  if (totalPlacements === 0) {
    throw new Error(`Elite ${raw.candidateId} resolved to empty placements!`);
  }

  // 验证闭包
  const coherence = validateTreeDeckCoherence(evol);
  if (!coherence.valid) {
    throw new Error(`Elite ${raw.candidateId} failed coherence: ${coherence.error}`);
  }

  return evol;
}

// ---------- 2. 主执行流程 ----------

async function main() {
  console.log('=== 开始执行 T021 精英种子真实重测与全量 T017 诊断 ===\n');

  const diagDir = resolve('tests/fixtures/tree/t020_runtime_diagnostics');
  if (!existsSync(diagDir)) {
    mkdirSync(diagDir, { recursive: true });
  }

  const pool = new PersistentSimPool({ workerCount: 8, enableCpuMonitor: false });
  await pool.init();

  const emptyMask: FeatureMask = { side: null, main: null, subs: [], keys: [] };
  const families = JSON.parse(readFileSync(resolve('tests/fixtures/tree/early_seven_bundles.json'), 'utf8'));
  const trainingOpps = families.map((f: any) => f.trainingVariant);
  const heldOutOpps = families.map((f: any) => f.heldOutVariant);
  const strongPanel = resolveEvaluationPanel();

  // Part A: 精英种子真实结构化评测 (Canonical Elite Retest)
  console.log('[Part A] 执行持久化精英种子真实结构化评测...');
  const eliteSeedsRaw = JSON.parse(readFileSync(resolve('tests/fixtures/tree/persistent_elite_seeds.json'), 'utf8'));
  const eliteRetests: any[] = [];

  for (const e of eliteSeedsRaw) {
    const evol = canonicalizeEliteFormation(e);
    const fp = getCanonicalTreeFingerprint(evol);

    // 1. Preflight
    const [preflight] = await pool.evalCandidateBatchOnMatchedParallel([evol], emptyMask, trainingOpps, 1, 10001);
    
    // 2. Held-Out 早期 7 家族 (70 局)
    const [heldOut] = await pool.evalCandidateBatchOnMatchedParallel([evol], emptyMask, heldOutOpps, 5, 20001);

    // 3. 强阵面板 (80 局)
    const [strong] = await pool.evalCandidateBatchOnMatchedParallel([evol], emptyMask, strongPanel, 5, 30001);

    const retestRecord = {
      candidateId: e.candidateId,
      sourceSeedName: e.sourceSeedName,
      provenanceTask: e.provenanceTask,
      adoptedMove: e.adoptedMove,
      canonicalFingerprint: fp,
      conversionRoute: 'DIRECT_EVOL_CANONICAL_WITH_PRESERVATION_CHECK',
      historicalT014Metrics: e.historicalT014Metrics,
      preflight: {
        passed: (preflight.workerErrorCount ?? 0) === 0,
        workerErrorCount: preflight.workerErrorCount ?? 0,
        workerErrors: preflight.workerErrors ?? [],
        win: preflight.win,
        draw: preflight.draw,
        loss: preflight.loss,
      },
      earlyHeldOut: {
        trainingScore: heldOut.trainingScore,
        win: heldOut.win,
        draw: heldOut.draw,
        loss: heldOut.loss,
        total: heldOut.total,
        workerErrorCount: heldOut.workerErrorCount ?? 0,
        workerErrors: heldOut.workerErrors ?? [],
      },
      strongPanel: {
        trainingScore: strong.trainingScore,
        win: strong.win,
        draw: strong.draw,
        loss: strong.loss,
        total: strong.total,
        workerErrorCount: strong.workerErrorCount ?? 0,
        workerErrors: strong.workerErrors ?? [],
      },
      status: (heldOut.workerErrorCount ?? 0) === 0 ? 'COMPLETE_VALID_EVALUATED' : 'RUNTIME_INVALID',
    };

    eliteRetests.push(retestRecord);
    console.log(`  ✓ ${e.candidateId} (${e.sourceSeedName}): Preflight=${retestRecord.preflight.passed}, HeldOut=${(heldOut.trainingScore * 100).toFixed(1)}% (${heldOut.win}W/${heldOut.draw}D/${heldOut.loss}L, Errors=${heldOut.workerErrorCount ?? 0}), Strong=${(strong.trainingScore * 100).toFixed(1)}%`);
  }

  const eliteOutPath = join(diagDir, 'elite_seed_retests.jsonl');
  writeFileSync(eliteOutPath, eliteRetests.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  console.log(`[T021] Wrote ${eliteRetests.length} elite retests to ${eliteOutPath}\n`);

  // Part B: 全量诊断 T017 历史全零候选
  console.log('[Part B] 全量诊断 T017 历史全零候选 (30 候选全量覆查)...');
  const allCands = readFileSync(resolve('tests/fixtures/tree/thirty_three_mutated_candidates.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map(l => JSON.parse(l));

  const diagnosticLedger: any[] = [];

  for (const c of allCands) {
    const evol = formationToEvol(c as unknown as Formation);
    const coherence = validateTreeDeckCoherence(evol);

    // 1-game Preflight (14 局)
    const [preflight] = await pool.evalCandidateBatchOnMatchedParallel([evol], emptyMask, trainingOpps, 1, 9999);

    // 5-game Held-Out 对局 (70 局)
    const [heldOut] = await pool.evalCandidateBatchOnMatchedParallel([evol], emptyMask, heldOutOpps, 5, 55555);

    const hasWorkerError = (preflight.workerErrorCount ?? 0) > 0 || (heldOut.workerErrorCount ?? 0) > 0;
    const isAllLoss = heldOut.win === 0 && heldOut.draw === 0 && heldOut.loss === 70;

    let classification = 'OTHER';
    if (!coherence.valid) {
      classification = 'STATIC_COHERENCE_INVALID';
    } else if (hasWorkerError) {
      classification = 'RUNTIME_INVALID';
    } else if (isAllLoss) {
      classification = 'COMPLETE_VALID_ALL_LOSS';
    } else {
      classification = 'COMPLETE_VALID_EVALUATED';
    }

    const diag = {
      candidateId: c.candidateId,
      sourceSeedName: c.sourceSeedName,
      noveltyBucket: c.noveltyBucket,
      staticCoherence: {
        valid: coherence.valid,
        error: coherence.error,
      },
      preflight: {
        passed: (preflight.workerErrorCount ?? 0) === 0,
        workerErrorCount: preflight.workerErrorCount ?? 0,
        workerErrors: preflight.workerErrors ?? [],
        win: preflight.win,
        draw: preflight.draw,
        loss: preflight.loss,
      },
      heldOutEvaluation: {
        trainingScore: heldOut.trainingScore,
        win: heldOut.win,
        draw: heldOut.draw,
        loss: heldOut.loss,
        total: heldOut.total,
        workerErrorCount: heldOut.workerErrorCount ?? 0,
        workerErrors: heldOut.workerErrors ?? [],
        isEvaluationComplete: (heldOut.workerErrorCount ?? 0) === 0,
      },
      classification,
      rootCauseNote: classification === 'COMPLETE_VALID_ALL_LOSS'
        ? 'Tactical deficit against tuned held-out early-seven benchmarks; 0 runtime/worker errors.'
        : classification === 'COMPLETE_VALID_EVALUATED'
        ? 'Successfully scored against held-out early-seven benchmarks; 0 runtime/worker errors.'
        : 'Worker exception or static coherence failure.',
    };

    diagnosticLedger.push(diag);
  }

  const diagOutPath = join(diagDir, 'runtime_diagnostic_ledger.jsonl');
  writeFileSync(diagOutPath, diagnosticLedger.map(d => JSON.stringify(d)).join('\n') + '\n', 'utf8');
  console.log(`[T021] Wrote ${diagnosticLedger.length} diagnostic records to ${diagOutPath}\n`);

  // Part C: 输出 Markdown 诊断摘要
  let summaryMd = `# T020/T021 Runtime Diagnostic & Elite Retest Summary\n\n`;
  summaryMd += `> Note: This archive supersedes T017's all-zero rows for candidate/source capability interpretations.\n\n`;
  summaryMd += `## 1. Elite Seeds Retest Table\n\n`;
  summaryMd += `| Candidate ID | Source Seed | Provenance | Historical T014 $\\Delta$ | T021 Early Held-Out | T021 Strong Panel | Errors | Status |\n|---|---|---|---|---|---|---|---|\n`;
  for (const e of eliteRetests) {
    summaryMd += `| \`${e.candidateId}\` | ${e.sourceSeedName} | ${e.provenanceTask} | Held-Out +${(e.historicalT014Metrics.earlyHeldOutDelta * 100).toFixed(1)}% | ${(e.earlyHeldOut.trainingScore * 100).toFixed(1)}% (${e.earlyHeldOut.win}W/${e.earlyHeldOut.draw}D/${e.earlyHeldOut.loss}L) | ${(e.strongPanel.trainingScore * 100).toFixed(1)}% (${e.strongPanel.win}W/${e.strongPanel.draw}D/${e.strongPanel.loss}L) | ${e.earlyHeldOut.workerErrorCount} | ${e.status} |\n`;
  }

  summaryMd += `\n## 2. All-Zero Candidate Diagnostics Classification (30 Candidates)\n\n`;
  summaryMd += `| Candidate ID | Source Seed | Bucket | Preflight | Held-Out Score | W / D / L | Worker Errors | Classification |\n|---|---|---|---|---|---|---|---|\n`;
  for (const d of diagnosticLedger) {
    summaryMd += `| \`${d.candidateId}\` | ${d.sourceSeedName} | ${d.noveltyBucket} | ${d.preflight.passed ? 'PASS' : 'FAIL'} | ${(d.heldOutEvaluation.trainingScore * 100).toFixed(1)}% | ${d.heldOutEvaluation.win}/${d.heldOutEvaluation.draw}/${d.heldOutEvaluation.loss} | ${d.heldOutEvaluation.workerErrorCount} | \`${d.classification}\` |\n`;
  }

  const sumOutPath = join(diagDir, 'diagnostic_summary.md');
  writeFileSync(sumOutPath, summaryMd, 'utf8');
  console.log(`[T021] Wrote diagnostic summary to ${sumOutPath}\n`);

  pool.destroy();
  console.log('=== T021 诊断与重测完成 ===');
}

main().catch(err => {
  console.error('T021 执行失败:', err);
  process.exit(1);
});
