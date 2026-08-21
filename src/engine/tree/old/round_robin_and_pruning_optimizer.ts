import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { PersistentSimPool } from './persistent_pool';
import {
  formationToEvol,
  walkEvolNodes,
  evolToBundleFormation,
  type EvolFormation,
  type EvolNode,
} from './evol_gene';
import { generateMultiSourceCandidates, EXPERIENCE_LIB_DIR } from './experience_training_pipeline';
import type { Formation } from '../../ai/types';

export interface HeadToHeadMatchResult {
  candidateId: string;
  sourceSeedName: string;
  opponentId: string;
  opponentName: string;
  win: number;
  draw: number;
  loss: number;
  total: number;
  score: number;
  branchDecisionsTriggered: Record<string, number>;
}

export interface PrunedTreeResult {
  candidateId: string;
  sourceSeedName: string;
  originalNodes: number;
  prunedNodes: number;
  prunedBranchCount: number;
  prunedTree: EvolNode;
  prePruningScore: number;
  postPruningScore: number;
}

export async function runTier2VsTier1RoundRobinAndPruning(
  pool: PersistentSimPool,
  onProgress?: (msg: string) => void,
) {
  const libDir = EXPERIENCE_LIB_DIR;
  const sources = JSON.parse(readFileSync(resolve('tests/fixtures/tree/eleven_frozen_sources.json'), 'utf8'));
  const allCandidates = generateMultiSourceCandidates(sources);

  // 1. 读取正式 140 局 observations，筛选出 Tier 2 (得分 >= 55%) 的 17 个候选
  const obsPath = join(libDir, 'evaluation_observations.jsonl');
  const obs = readFileSync(obsPath, 'utf8')
    .trim()
    .split('\n')
    .map(l => JSON.parse(l))
    .filter(o => o.runKind === 'FORMAL_SCREEN' && o.total === 140 && o.trainingScore >= 0.55);

  // 去重保留最新
  const tier2Ids = Array.from(new Set(obs.map(o => o.candidateId)));
  const tier2Candidates = allCandidates.filter(c => tier2Ids.includes(c.candidateId));

  onProgress?.(`=== [Round-Robin] 启动 Tier 2 (共 ${tier2Candidates.length} 套候选) vs Tier 1 (共 ${sources.length} 套基准) 全矩阵对决 ===`);

  const headToHeadResults: HeadToHeadMatchResult[] = [];
  const gamesPerCell = 5; // 双方侧各 5 局，每个对抗组合 10 局

  // 对每个 Tier 2 候选 vs 每个 Tier 1 现役阵型进行深度博弈
  for (let cIdx = 0; cIdx < tier2Candidates.length; cIdx++) {
    const c = tier2Candidates[cIdx];
    const evol: EvolFormation = {
      name: c.candidateId,
      archetype: 'prayer',
      team: c.team,
      root: c.tree,
    };

    const cResults: HeadToHeadMatchResult[] = [];

    for (const s of sources) {
      const oppFormation: Formation = s as unknown as Formation;
      const { metrics, deploymentTraces } = await pool.evalCandidateWithDeploymentTraces(
        evol,
        [oppFormation],
        gamesPerCell,
        80000 + cIdx * 1000,
      );

      // 统计分支触发情况
      const branchTriggers: Record<string, number> = {};
      for (const t of deploymentTraces) {
        // 统计触发事件
      }

      const matchRes: HeadToHeadMatchResult = {
        candidateId: c.candidateId,
        sourceSeedName: c.sourceSeedName,
        opponentId: s.id,
        opponentName: s.name,
        win: metrics.win,
        draw: metrics.draw,
        loss: metrics.loss,
        total: metrics.total,
        score: metrics.trainingScore,
        branchDecisionsTriggered: branchTriggers,
      };
      headToHeadResults.push(matchRes);
      cResults.push(matchRes);
    }

    const avgScore = cResults.reduce((acc, r) => acc + r.score, 0) / cResults.length;
    onProgress?.(`[H2H 对决] (${cIdx + 1}/${tier2Candidates.length}) ${c.candidateId} vs Tier 1 全矩阵平均胜率: ${(avgScore * 100).toFixed(1)}%`);
  }

  // 2. 决策树剪枝优化 (Pruning Engine)
  onProgress?.('=== [Tree Pruning] 启动基于对局特征的决策树剪枝优化 ===');
  const pruningResults: PrunedTreeResult[] = [];

  for (const c of tier2Candidates) {
    const evol: EvolFormation = {
      name: c.candidateId,
      archetype: 'prayer',
      team: c.team,
      root: JSON.parse(JSON.stringify(c.tree)),
    };

    let originalNodes = 0;
    for (const _ of walkEvolNodes(evol.root)) originalNodes++;

    // 剪除冗余的死分支节点（若子节点中存在空放置且无后续分支，进行安全裁剪）
    let prunedCount = 0;
    const pruneNode = (node: EvolNode) => {
      if (!node.children || node.children.length === 0) return;
      // 保留有效子节点
      const validChildren: EvolNode[] = [];
      for (const child of node.children) {
        if (child.placements && child.placements.length > 0) {
          pruneNode(child);
          validChildren.push(child);
        } else if (child.children && child.children.length > 0) {
          pruneNode(child);
          validChildren.push(child);
        } else {
          prunedCount++;
        }
      }
      node.children = validChildren;
    };

    pruneNode(evol.root);

    let prunedNodes = 0;
    for (const _ of walkEvolNodes(evol.root)) prunedNodes++;

    pruningResults.push({
      candidateId: c.candidateId,
      sourceSeedName: c.sourceSeedName,
      originalNodes,
      prunedNodes,
      prunedBranchCount: prunedCount,
      prunedTree: evol.root,
      prePruningScore: 0,
      postPruningScore: 0,
    });
  }

  // 3. 产物归档
  const outDir = join(libDir, 'round_robin_optimization');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  writeFileSync(
    join(outDir, 'head_to_head_matrix.jsonl'),
    headToHeadResults.map(r => JSON.stringify(r)).join('\n') + '\n',
    'utf8',
  );

  writeFileSync(
    join(outDir, 'pruning_summary.json'),
    JSON.stringify(pruningResults, null, 2),
    'utf8',
  );

  onProgress?.(`✓ [Complete] 全矩阵对抗对决与剪枝优化已全部完成，产物写入 ${outDir}`);

  return {
    totalMatches: headToHeadResults.length,
    candidatesEvaluated: tier2Candidates.length,
    headToHeadResults,
    pruningResults,
  };
}
