import type { CandidateTrial, BaselineCase, OptimizerCycleConfig } from './types';
import type { EvolFormation } from '../../../evol_gene';
import type { TeamSlot } from '../../../../game/GameEngine';
import { cloneEvolFormation, walkEvolNodes } from '../../../evol_gene';
import { RoundBoardStateFactory, type RoundBoardEdit } from '../round_board_state_factory';
import { SingleRoundEngine } from '../single_round_engine';
import { evaluateObjectiveVector, dominates, compareObjective } from '../optimizer/objective';
import { CandidateSpace } from '../optimizer/candidate_space';
import { mulberry32 } from '../../../../play_full_game';

export interface DCandidateCatalogRecord {
  dId: string;
  type: 'BADGE_CHANGE' | 'DECK_INTERNAL_REASSIGNMENT' | 'CONSTRAINED_EXTERNAL_REPLACEMENT' | 'REPLACEMENT_WITH_BADGE_VARIANT';
  description: string;
  sourceTargetFingerprint: string;
  modifiedTeam: TeamSlot[];
  modifiedEvol: EvolFormation;
  valid: boolean;
  rejectionReason?: string;
}

export interface DSTrialRecord {
  dsTrialId: string;
  dId: string;
  caseId: string;
  sTrialIndex: number;
  sEdits: RoundBoardEdit[];
  editedStateFingerprint: string;
  result: any;
  objective: any;
  hasLocalSignal: boolean;
}

export interface LocalLineage {
  lineageId: string;
  mode: 'S' | 'D_PLUS_S';
  parentSnapshotFingerprint: string;
  sourceCaseId: string;
  dRecord?: DCandidateCatalogRecord;
  sEdits: RoundBoardEdit[];
  objective: any;
  editedStateFingerprint: string;
  observableDigest: string;
  generation: number;
}

export class LineageManager {
  public static buildSLineages(
    representatives: CandidateTrial[],
    parentSnapshotFingerprint: string
  ): LocalLineage[] {
    return representatives.map(rep => ({
      lineageId: `LIN_S_${rep.candidateId}`,
      mode: 'S',
      parentSnapshotFingerprint,
      sourceCaseId: rep.caseId,
      sEdits: rep.edits,
      objective: rep.objective,
      editedStateFingerprint: rep.editedStateFingerprint,
      observableDigest: rep.result.observableOutput.observableDigest,
      generation: rep.generation,
    }));
  }

  /**
   * 生成最多 4 个有效 D 候选提案
   */
  public static generateDCatalog(
    targetSnap: { team: TeamSlot[]; evol: EvolFormation; canonicalFingerprint: string },
    rngSeed: number
  ): DCandidateCatalogRecord[] {
    const rng = mulberry32(rngSeed);
    const catalog: DCandidateCatalogRecord[] = [];

    // 1. BADGE_CHANGE: 调整一个合法槽位的徽章
    const team1 = JSON.parse(JSON.stringify(targetSnap.team)) as TeamSlot[];
    const evol1 = cloneEvolFormation(targetSnap.evol);
    if (team1.length > 0) {
      const slot = team1[0];
      const newBadges = slot.badgeIds.includes(1) ? slot.badgeIds.filter(b => b !== 1) : [...slot.badgeIds, 1];
      slot.badgeIds = newBadges;
      catalog.push({
        dId: `D_BADGE_01_${targetSnap.canonicalFingerprint.slice(0, 8)}`,
        type: 'BADGE_CHANGE',
        description: `Toggle badge for monster ${slot.monsterId}`,
        sourceTargetFingerprint: targetSnap.canonicalFingerprint,
        modifiedTeam: team1,
        modifiedEvol: evol1,
        valid: true,
      });
    }

    // 2. DECK_INTERNAL_REASSIGNMENT: 队内交换顺序
    const team2 = JSON.parse(JSON.stringify(targetSnap.team)) as TeamSlot[];
    const evol2 = cloneEvolFormation(targetSnap.evol);
    if (team2.length >= 2) {
      const tmp = team2[0];
      team2[0] = team2[1];
      team2[1] = tmp;
      catalog.push({
        dId: `D_REASSIGN_02_${targetSnap.canonicalFingerprint.slice(0, 8)}`,
        type: 'DECK_INTERNAL_REASSIGNMENT',
        description: `Swap monster ${team2[0].monsterId} and ${team2[1].monsterId}`,
        sourceTargetFingerprint: targetSnap.canonicalFingerprint,
        modifiedTeam: team2,
        modifiedEvol: evol2,
        valid: true,
      });
    }

    // 3. CONSTRAINED_EXTERNAL_REPLACEMENT: 替换一个合规怪兽
    const team3 = JSON.parse(JSON.stringify(targetSnap.team)) as TeamSlot[];
    const evol3 = cloneEvolFormation(targetSnap.evol);
    const existingIds = new Set(team3.map(s => s.monsterId));
    // 候选怪兽池 (1..8)
    const available = [1, 2, 3, 4, 5, 6, 7, 8].filter(id => !existingIds.has(id));
    if (available.length > 0 && team3.length > 0) {
      const repIdx = team3.length - 1;
      const oldId = team3[repIdx].monsterId;
      const newId = available[0];
      team3[repIdx].monsterId = newId;

      // 同步 evol 根节点中的 placement
      for (const node of walkEvolNodes(evol3.root)) {
        for (const p of node.placements) {
          if (p.monsterId === oldId) p.monsterId = newId;
        }
      }

      catalog.push({
        dId: `D_REPLACE_03_${targetSnap.canonicalFingerprint.slice(0, 8)}`,
        type: 'CONSTRAINED_EXTERNAL_REPLACEMENT',
        description: `Replace monster ${oldId} with ${newId}`,
        sourceTargetFingerprint: targetSnap.canonicalFingerprint,
        modifiedTeam: team3,
        modifiedEvol: evol3,
        valid: true,
      });
    }

    // 4. REPLACEMENT_WITH_BADGE_VARIANT: 替换带徽章微调
    const team4 = JSON.parse(JSON.stringify(targetSnap.team)) as TeamSlot[];
    const evol4 = cloneEvolFormation(targetSnap.evol);
    if (available.length > 1 && team4.length > 0) {
      const repIdx = 0;
      const oldId = team4[repIdx].monsterId;
      const newId = available[1];
      team4[repIdx].monsterId = newId;
      team4[repIdx].badgeIds = [2];

      for (const node of walkEvolNodes(evol4.root)) {
        for (const p of node.placements) {
          if (p.monsterId === oldId) p.monsterId = newId;
        }
      }

      catalog.push({
        dId: `D_REP_BADGE_04_${targetSnap.canonicalFingerprint.slice(0, 8)}`,
        type: 'REPLACEMENT_WITH_BADGE_VARIANT',
        description: `Replace monster ${oldId} with ${newId} with badge [2]`,
        sourceTargetFingerprint: targetSnap.canonicalFingerprint,
        modifiedTeam: team4,
        modifiedEvol: evol4,
        valid: true,
      });
    }

    return catalog.slice(0, 4);
  }

  /**
   * 执行 4x8 D+S 局部搜索循环
   */
  public static executeDPlusSSearch(
    dCatalog: DCandidateCatalogRecord[],
    adverseCases: BaselineCase[],
    searchSeed: number
  ): { dsTrials: DSTrialRecord[]; retainedLineages: LocalLineage[]; discardedDCount: number } {
    const dsTrials: DSTrialRecord[] = [];
    const retainedLineages: LocalLineage[] = [];
    let discardedDCount = 0;

    let dIndex = 0;
    for (const dRec of dCatalog) {
      dIndex++;
      if (!dRec.valid) {
        discardedDCount++;
        continue;
      }

      let dHadSignal = false;
      const rng = mulberry32(searchSeed * 7919 + dIndex * 104729);

      // 对每个不利局进行最多 8 个有效 S 搜索
      for (const baseCase of adverseCases) {
        if (dHadSignal) break; // 首次命中局部提升即结束当前 D 的 S 搜索并保留谱系

        const seenFp = new Set<string>();
        seenFp.add(baseCase.baseState.stateFingerprint);

        for (let sIdx = 1; sIdx <= 8; sIdx++) {
          const edits = CandidateSpace.sampleCompatibleEdits(baseCase.baseState, rng);
          if (edits.length === 0) continue;

          const candidateState = RoundBoardStateFactory.cloneWithEdits(baseCase.baseState, edits);
          const fp = candidateState.stateFingerprint;
          if (seenFp.has(fp)) continue;
          seenFp.add(fp);

          const res = SingleRoundEngine.runSingleRound(candidateState);
          const obj = evaluateObjectiveVector(res, baseCase.targetSide, edits.length);
          const baseObj = evaluateObjectiveVector(baseCase.baselineResult, baseCase.targetSide, 0);

          const isImprovement = compareObjective(obj, baseObj) > 0;

          const trial: DSTrialRecord = {
            dsTrialId: `DS_${dRec.dId}_c${baseCase.caseId}_s${sIdx}`,
            dId: dRec.dId,
            caseId: baseCase.caseId,
            sTrialIndex: sIdx,
            sEdits: edits,
            editedStateFingerprint: fp,
            result: res,
            objective: obj,
            hasLocalSignal: isImprovement,
          };
          dsTrials.push(trial);

          if (isImprovement) {
            dHadSignal = true;
            retainedLineages.push({
              lineageId: `LIN_DS_${trial.dsTrialId}`,
              mode: 'D_PLUS_S',
              parentSnapshotFingerprint: dRec.sourceTargetFingerprint,
              sourceCaseId: baseCase.caseId,
              dRecord: dRec,
              sEdits: edits,
              objective: obj,
              editedStateFingerprint: fp,
              observableDigest: res.observableOutput.observableDigest,
              generation: 1,
            });
            break; // 首个有效局部提升即锁定该 D
          }
        }
      }

      if (!dHadSignal) {
        discardedDCount++;
      }
    }

    return { dsTrials, retainedLineages, discardedDCount };
  }

  public static filterTopLineagesForBackprop(
    lineages: LocalLineage[],
    maxLineages = 8
  ): LocalLineage[] {
    const sorted = [...lineages].sort((a, b) => {
      // 优先选择 Pareto 胜负等级更高/存活血量更高的
      if (a.objective.roundWinnerRank !== b.objective.roundWinnerRank) {
        return a.objective.roundWinnerRank - b.objective.roundWinnerRank;
      }
      if (a.objective.targetSurvivingHp !== b.objective.targetSurvivingHp) {
        return b.objective.targetSurvivingHp - a.objective.targetSurvivingHp;
      }
      return a.sEdits.length - b.sEdits.length;
    });

    return sorted.slice(0, maxLineages);
  }
}
