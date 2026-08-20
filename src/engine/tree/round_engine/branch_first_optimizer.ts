// ============================================================
// src/engine/tree/round_engine/branch_first_optimizer.ts
// T101: C, D, E, F - Generation 2 Multi-Variable Search, Branch Library, Merge & Prune
// ============================================================

import '../../env';
import type { EvolFormation, EvolNode, FeatureMask } from '../evol_gene';
import { cloneEvolFormation, cloneEvolNode, emptyMask, walkEvolNodes, recognizeArchetype } from '../evol_gene';
import { treeStrategyFor } from '../product_tree_strategy';
import { ProductGameSession } from './product_round_session';
import type { LossCase } from './loss_case_inventory';
import { computeCandidateFingerprint } from '../product_training/02_candidates';
import {
  computeCalculatorPolicyFingerprint,
  DEFAULT_CALCULATOR_POLICY,
  type CalculatorContextPolicy,
  type ChargeTargetPriority,
  type SpellTargetPriority,
  type TutuModePreference,
  type DrillTargetPriority,
} from '../calculator_policy';
import { sha256Hex } from '../sha256_pure';
import { FormationSnapshotResolver } from '../product_training/snapshot_resolver';
import { FORMATION_LIBRARY } from '../../../ai/formation_library';
import { formationToEvol } from '../evol_gene';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type BranchState =
  | 'EXACT_CASE_BRANCH'
  | 'GENERALIZING_BRANCH'
  | 'MERGED_PREFIX_BRANCH'
  | 'PRUNED_HISTORICAL';

export interface BranchRecord {
  branchId: string;
  state: BranchState;
  parentSnapshotFingerprint: string;
  solutionBehaviorFingerprint: string;
  forkRound: number;
  condition: FeatureMask;
  sourceLossCaseIds: string[];
  actionSubtreeDelta: { round: number; placements: { monsterId: number; x: number; y: number }[] }[];
  policyDelta?: CalculatorContextPolicy | null;
  fixedCaseResult: 'W' | 'D' | 'L';
  verifiedCoverageCount: number;
  createdAt: string;
  notes?: string;
}

export interface CandidateVariation {
  candidateId: string;
  mutatedEvol: EvolFormation;
  behaviorFingerprint: string;
  modifiedVariablesCount: number;
  descriptions: string[];
}

export const EVIDENCE_LOCAL_TRIALS_PATH = resolve('reports/tree-cycle/all2rush_g2_local_search_trials.jsonl');
export const EVIDENCE_BRANCH_LIB_PATH = resolve('reports/tree-cycle/all2rush_g2_branch_library.jsonl');
export const EVIDENCE_MERGE_PRUNE_PATH = resolve('reports/tree-cycle/all2rush_g2_branch_merge_prune_audit.jsonl');

export function appendTrialEvidence(record: any): void {
  appendFileSync(EVIDENCE_LOCAL_TRIALS_PATH, JSON.stringify({ recordKind: 'ALL2RUSH_G2_LOCAL_TRIAL_V1', timestamp: new Date().toISOString(), ...record }) + '\n', 'utf8');
}

export function appendBranchEvidence(record: BranchRecord): void {
  appendFileSync(EVIDENCE_BRANCH_LIB_PATH, JSON.stringify({ recordKind: 'ALL2RUSH_G2_BRANCH_RECORD_V1', timestamp: new Date().toISOString(), ...record }) + '\n', 'utf8');
}

export function appendMergePruneAudit(record: any): void {
  appendFileSync(EVIDENCE_MERGE_PRUNE_PATH, JSON.stringify({ recordKind: 'ALL2RUSH_G2_MERGE_PRUNE_AUDIT_V1', timestamp: new Date().toISOString(), ...record }) + '\n', 'utf8');
}

/**
 * 针对一个确切的 LossCase 生成最多 48 个 1-3 变量组合变体
 */
export function generateFocusedCandidatesForCase(
  lossCase: LossCase,
  baseEvol: EvolFormation,
  maxCandidates: number = 48
): CandidateVariation[] {
  const variations: CandidateVariation[] = [];
  const seenFp = new Set<string>();

  const forkR = lossCase.forkRound;
  const targetNodes = walkEvolNodes(baseEvol.root).filter(n => n.round === forkR);
  if (targetNodes.length === 0) return [];

  const chargePriorities: ChargeTargetPriority[] = ['iron_first', 'tank_first', 'four_cost_first'];
  const spellPriorities: SpellTargetPriority[] = ['four_cost_first', 'prayer_first', 'most_enemies'];
  const tutuModes: TutuModePreference[] = ['voodoo_shield_first', 'imperial_front'];
  const drillPriorities: DrillTargetPriority[] = ['spell_counter', 'prayer_first'];

  let count = 0;

  // 1. 单变量变体 (R 落子微调 / 顺序 / 单个 Policy 调整)
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (count >= maxCandidates) break;

      const clone = cloneEvolFormation(baseEvol);
      const rNodes = walkEvolNodes(clone.root).filter(n => n.round === forkR);
      if (rNodes.length > 0 && rNodes[0].placements.length > 0) {
        const p = rNodes[0].placements[0];
        const newX = Math.max(6, Math.min(10, p.x + dx));
        const newY = Math.max(0, Math.min(4, p.y + dy));
        if (newX !== p.x || newY !== p.y) {
          p.x = newX;
          p.y = newY;
          const fp = computeCandidateFingerprint(clone);
          if (!seenFp.has(fp)) {
            seenFp.add(fp);
            variations.push({
              candidateId: `cand_r${forkR}_shift_${dx}_${dy}_${count}`,
              mutatedEvol: clone,
              behaviorFingerprint: fp,
              modifiedVariablesCount: 1,
              descriptions: [`R${forkR} placement shift dx=${dx}, dy=${dy}`],
            });
            count++;
          }
        }
      }
    }
  }

  // 2. 双变量变体 (R 坐标 + 1个 Policy 参数)
  for (const cp of chargePriorities) {
    if (count >= maxCandidates) break;
    const clone = cloneEvolFormation(baseEvol);
    clone.calculatorPolicy = {
      ...DEFAULT_CALCULATOR_POLICY,
      special: {
        ...DEFAULT_CALCULATOR_POLICY.special,
        charge: { targetPriority: cp },
      },
    };
    const rNodes = walkEvolNodes(clone.root).filter(n => n.round === forkR);
    if (rNodes.length > 0 && rNodes[0].placements.length > 0) {
      rNodes[0].placements[0].y = (rNodes[0].placements[0].y + 1) % 5;
    }
    const fp = computeCandidateFingerprint(clone);
    if (!seenFp.has(fp)) {
      seenFp.add(fp);
      variations.push({
        candidateId: `cand_r${forkR}_charge_${cp}_${count}`,
        mutatedEvol: clone,
        behaviorFingerprint: fp,
        modifiedVariablesCount: 2,
        descriptions: [`R${forkR} placement y+1`, `Charge policy=${cp}`],
      });
      count++;
    }
  }

  // 3. 三变量变体 (R 坐标 + R+1 坐标 + Policy 参数)
  for (const sp of spellPriorities) {
    if (count >= maxCandidates) break;
    const clone = cloneEvolFormation(baseEvol);
    clone.calculatorPolicy = {
      ...DEFAULT_CALCULATOR_POLICY,
      special: {
        ...DEFAULT_CALCULATOR_POLICY.special,
        spell: { targetPriority: sp, preferXOffset: 6 },
      },
    };
    const rNodes = walkEvolNodes(clone.root).filter(n => n.round === forkR);
    if (rNodes.length > 0 && rNodes[0].placements.length > 0) {
      rNodes[0].placements[0].x = rNodes[0].placements[0].x === 6 ? 7 : 6;
    }
    const nextNodes = walkEvolNodes(clone.root).filter(n => n.round === forkR + 1);
    if (nextNodes.length > 0 && nextNodes[0].placements.length > 0) {
      nextNodes[0].placements[0].y = (nextNodes[0].placements[0].y + 1) % 5;
    }
    const fp = computeCandidateFingerprint(clone);
    if (!seenFp.has(fp)) {
      seenFp.add(fp);
      variations.push({
        candidateId: `cand_r${forkR}_spell_${sp}_tri_${count}`,
        mutatedEvol: clone,
        behaviorFingerprint: fp,
        modifiedVariablesCount: 3,
        descriptions: [`R${forkR} x flip`, `R${forkR+1} y+1`, `Spell policy=${sp}`],
      });
      count++;
    }
  }

  return variations;
}

/**
 * 运行基于 pre-R checkpoint 的单局续玩搜索 (Focused Continuation Search)
 * 严格规则：目标侧 (targetSide) 必须与 lossCase.side 严格绑定，杜绝侧混淆
 */
export function runFocusedSearchOnLossCase(
  lossCase: LossCase,
  baseEvol: EvolFormation,
  candidates: CandidateVariation[]
): {
  improvedBranches: BranchRecord[];
  allTrials: any[];
} {
  const improvedBranches: BranchRecord[] = [];
  const allTrials: any[] = [];

  const resolver = FormationSnapshotResolver.getInstance();
  resolver.init();

  let oppEvol: EvolFormation | null = null;
  try {
    const oppSnap = resolver.resolveFormationSnapshot({ formationId: lossCase.opponentId });
    oppEvol = oppSnap.evol;
  } catch {
    const opp = FORMATION_LIBRARY.find(f => f.id === lossCase.opponentId || f.name === lossCase.opponentId);
    oppEvol = opp ? ((opp as any).evol ? (opp as any).evol : formationToEvol(opp)) : null;
  }

  if (!oppEvol) return { improvedBranches, allTrials };

  const oppStrat = treeStrategyFor(oppEvol);
  const targetSide = lossCase.side;
  const isRushP1 = targetSide === 1;

  for (const cand of candidates) {
    // 关键点：每个 candidate 均从相同的 pre-R checkpoint 恢复，进行 1 局续玩评估
    const session = ProductGameSession.restore(lossCase.preRCheckpoint, {
      strategyIdentityA: isRushP1 ? 'all2rush_cand' : lossCase.opponentId,
      strategyIdentityB: isRushP1 ? lossCase.opponentId : 'all2rush_cand',
    });

    const candStrat = treeStrategyFor(cand.mutatedEvol);

    const roundHpOutputs: Array<{
      round: number;
      survivors: Array<{ dbId: number; team: 1 | 2; hp: number; maxHp: number }>;
      p1TotalHp: number;
      p2TotalHp: number;
    }> = [];

    while (session.currentRound <= 5) {
      if (session.p1Score >= 3 || session.p2Score >= 3) break;
      const ctxA = session.buildRoundContext(1);
      const ctxB = session.buildRoundContext(2);

      const intentsA = isRushP1 ? candStrat(ctxA) : oppStrat(ctxA);
      const intentsB = isRushP1 ? oppStrat(ctxB) : candStrat(ctxB);

      const rRes = session.playRound(intentsA, intentsB);

      const survivors = (rRes.boardMonsters ?? [])
        .filter((m: any) => !m.isDead && m.hp > 0)
        .map((m: any) => ({ dbId: m.dbId, team: m.team, hp: Math.round(m.hp), maxHp: Math.round(m.maxHp) }))
        .sort((a: any, b: any) => a.team - b.team || a.dbId - b.dbId);

      const p1TotalHp = survivors.filter((s: any) => s.team === 1).reduce((acc: number, s: any) => acc + s.hp, 0);
      const p2TotalHp = survivors.filter((s: any) => s.team === 2).reduce((acc: number, s: any) => acc + s.hp, 0);

      roundHpOutputs.push({
        round: rRes.round,
        survivors,
        p1TotalHp,
        p2TotalHp,
      });

      if (rRes.isGameOver) break;
    }

    const matchWinner: 1 | 2 | 0 =
      session.p1Score === session.p2Score ? 0 : session.p1Score > session.p2Score ? 1 : 2;

    const candWon = (targetSide === 1 && matchWinner === 1) || (targetSide === 2 && matchWinner === 2);
    const candDraw = matchWinner === 0;
    const outcome: 'W' | 'D' | 'L' = candWon ? 'W' : candDraw ? 'D' : 'L';

    const isImproved = (lossCase.finalGameOutcome === 'L' && (outcome === 'W' || outcome === 'D')) ||
                       (lossCase.finalGameOutcome === 'D' && outcome === 'W');

    const hpOutputDigest = sha256Hex(JSON.stringify(roundHpOutputs)).slice(0, 16);

    const trialRecord = {
      lossCaseId: lossCase.caseId,
      targetSide,
      seed: lossCase.seed,
      forkRound: lossCase.forkRound,
      targetPayloadFingerprint: lossCase.targetPayloadFingerprint,
      targetCalculatorPolicyFingerprint: lossCase.targetCalculatorPolicyFingerprint,
      candidateId: cand.candidateId,
      behaviorFingerprint: cand.behaviorFingerprint,
      modifiedVariablesCount: cand.modifiedVariablesCount,
      concreteSelectedVariables: cand.descriptions,
      outcome,
      baselineOutcome: lossCase.finalGameOutcome,
      improved: isImproved,
      p1Score: session.p1Score,
      p2Score: session.p2Score,
      roundResults: session.roundResults,
      roundHpOutputs,
      hpOutputDigest,
    };
    allTrials.push(trialRecord);
    appendTrialEvidence(trialRecord);

    if (isImproved) {
      // 提取局部分支增量
      const rNodes = walkEvolNodes(cand.mutatedEvol.root).filter(n => n.round >= lossCase.forkRound);
      const actionSubtreeDelta = rNodes.map(n => ({
        round: n.round,
        placements: n.placements.map(p => ({ monsterId: p.monsterId, x: p.x, y: p.y })),
      }));

      // 动态推导合法特征掩码（严禁硬编码 main/keys/opponent）
      const rec = recognizeArchetype({
        handIds: new Set(lossCase.preRObservation.revealedEnemyHandIds),
        handBadges: new Set(lossCase.preRObservation.revealedEnemyHandBadges),
        boardIds: new Set(lossCase.preRObservation.revealedEnemyBoardIds),
      });

      const specificMask: FeatureMask = {
        side: lossCase.side,
        main: rec.main,
        subs: [...rec.subs],
        keys: [...rec.keys],
      };

      const branch: BranchRecord = {
        branchId: `BR_${lossCase.caseId}_${cand.behaviorFingerprint.slice(0, 8)}`,
        state: 'EXACT_CASE_BRANCH',
        parentSnapshotFingerprint: lossCase.targetPayloadFingerprint,
        solutionBehaviorFingerprint: cand.behaviorFingerprint,
        forkRound: lossCase.forkRound,
        condition: specificMask,
        sourceLossCaseIds: [lossCase.caseId],
        actionSubtreeDelta,
        policyDelta: cand.mutatedEvol.calculatorPolicy,
        fixedCaseResult: outcome,
        verifiedCoverageCount: 1,
        createdAt: new Date().toISOString(),
        notes: `Local continuation discovery: ${lossCase.finalGameOutcome} -> ${outcome}`,
      };

      improvedBranches.push(branch);
      appendBranchEvidence(branch);
    }
  }

  return { improvedBranches, allTrials };
}

/**
 * 运行分支前缀合并与历史剪枝 (Merge & Prune)
 * 严格规则：严禁向空 mask (emptyMask) 盲目泛化，合并分支必须具备合法派生的非空约束条件
 */
export function mergeAndPruneBranches(branches: BranchRecord[]): {
  merged: BranchRecord[];
  pruned: BranchRecord[];
  activeLibrary: BranchRecord[];
} {
  const merged: BranchRecord[] = [];
  const pruned: BranchRecord[] = [];
  const activeLibrary: BranchRecord[] = [];

  const seenExactFp = new Map<string, BranchRecord>();

  for (const br of branches) {
    if (seenExactFp.has(br.solutionBehaviorFingerprint)) {
      const pBr: BranchRecord = {
        ...br,
        state: 'PRUNED_HISTORICAL',
        notes: `Pruned as exact behavior duplicate of ${seenExactFp.get(br.solutionBehaviorFingerprint)!.branchId}`,
      };
      pruned.push(pBr);
      appendMergePruneAudit({ action: 'PRUNE_DUPLICATE', branchId: br.branchId, duplicateOf: seenExactFp.get(br.solutionBehaviorFingerprint)!.branchId });
      continue;
    }

    seenExactFp.set(br.solutionBehaviorFingerprint, br);
    activeLibrary.push(br);
  }

  // 尝试合并共享前缀分支（仅当具备合法且非空的公共约束时）
  if (activeLibrary.length >= 2) {
    for (let i = 0; i < activeLibrary.length; i++) {
      for (let j = i + 1; j < activeLibrary.length; j++) {
        const b1 = activeLibrary[i];
        const b2 = activeLibrary[j];
        if (b1.forkRound === b2.forkRound && b1.actionSubtreeDelta.length > 0 && b2.actionSubtreeDelta.length > 0) {
          const p1 = b1.actionSubtreeDelta[0];
          const p2 = b2.actionSubtreeDelta[0];
          if (JSON.stringify(p1.placements) === JSON.stringify(p2.placements)) {
            // 提取合法公共条件（求交集，绝不设为空 mask）
            const commonSubs = b1.condition.subs.filter(s => b2.condition.subs.includes(s));
            const commonKeys = b1.condition.keys.filter(k => b2.condition.keys.includes(k));
            const commonMain = b1.condition.main === b2.condition.main ? b1.condition.main : null;
            const commonSide = b1.condition.side === b2.condition.side ? b1.condition.side : null;

            // 若公共条件完全为空，严禁合成（保持为独立精确分支）
            if (commonMain === null && commonSide === null && commonSubs.length === 0 && commonKeys.length === 0) {
              continue;
            }

            const generalizedCondition: FeatureMask = {
              side: commonSide,
              main: commonMain,
              subs: commonSubs,
              keys: commonKeys,
            };

            // 共享 forkRound 执行前缀
            const mergedRecord: BranchRecord = {
              branchId: `MERGED_PREFIX_${b1.branchId.slice(0, 10)}_${b2.branchId.slice(0, 10)}`,
              state: 'MERGED_PREFIX_BRANCH',
              parentSnapshotFingerprint: b1.parentSnapshotFingerprint,
              solutionBehaviorFingerprint: b1.solutionBehaviorFingerprint,
              forkRound: b1.forkRound,
              condition: generalizedCondition,
              sourceLossCaseIds: Array.from(new Set([...b1.sourceLossCaseIds, ...b2.sourceLossCaseIds])),
              actionSubtreeDelta: [p1],
              policyDelta: b1.policyDelta,
              fixedCaseResult: 'W',
              verifiedCoverageCount: b1.verifiedCoverageCount + b2.verifiedCoverageCount,
              createdAt: new Date().toISOString(),
              notes: `Prefix merged from ${b1.branchId} and ${b2.branchId} under verified legal condition`,
            };
            merged.push(mergedRecord);
            appendMergePruneAudit({ action: 'MERGE_PREFIX', sourceBranches: [b1.branchId, b2.branchId], mergedBranchId: mergedRecord.branchId });
          }
        }
      }
    }
  }

  return { merged, pruned, activeLibrary };
}

/**
 * 将分支记录编译并挂载到基础 EvolFormation 上，生成具备分支执行能力的 EvolFormation
 */
export function attachExecutableBranchesToEvol(baseEvol: EvolFormation, branches: BranchRecord[]): EvolFormation {
  const evolved = cloneEvolFormation(baseEvol);
  
  for (const br of branches) {
    if (br.state === 'PRUNED_HISTORICAL') continue;

    // 寻找 forkRound 对应的父节点
    const parentRound = br.forkRound - 1;
    const parentNodes = walkEvolNodes(evolved.root).filter(n => n.round === parentRound);
    const parent = parentNodes.length > 0 ? parentNodes[0] : evolved.root;

    // 构造分支子节点
    let prevNode = parent;
    for (const delta of br.actionSubtreeDelta) {
      const newNode: EvolNode = {
        id: `${br.branchId}_r${delta.round}`,
        round: delta.round,
        condition: delta.round === br.forkRound ? br.condition : emptyMask(),
        placements: delta.placements.map(p => ({ monsterId: p.monsterId, x: p.x, y: p.y })),
        children: [],
      };
      prevNode.children.push(newNode);
      prevNode = newNode;
    }
  }

  return evolved;
}

