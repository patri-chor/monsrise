import type { TeamSlot } from '../../game/GameEngine';
import type { EvolFormation } from '../evol_gene';
import { cloneEvolFormation, walkEvolNodes } from '../evol_gene';
import { RoundBoardStateFactory } from '../round_board_factory';
import { SingleRoundEngine } from '../single_round_engine';
import { evaluateObjectiveVector, compareObjective, CandidateSpace } from './tree_search';
import { mulberry32 } from '../play_full_game';
import { TreeSnapshot } from '../tree_snapshot';

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
  sEdits: any[];
  editedStateFingerprint: string;
  result: any;
  objective: any;
  hasLocalSignal: boolean;
}

export class TreeDeck {
  public static generateDCatalog(
    targetSnap: { team: TeamSlot[]; evol: EvolFormation; canonicalFingerprint: string },
    rngSeed: number
  ): DCandidateCatalogRecord[] {
    const rng = mulberry32(rngSeed);
    const catalog: DCandidateCatalogRecord[] = [];

    // 1. BADGE_CHANGE
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

    // 2. DECK_INTERNAL_REASSIGNMENT
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

    // 3. CONSTRAINED_EXTERNAL_REPLACEMENT
    const team3 = JSON.parse(JSON.stringify(targetSnap.team)) as TeamSlot[];
    const evol3 = cloneEvolFormation(targetSnap.evol);
    const existingIds = new Set(team3.map(s => s.monsterId));
    const available = [1, 2, 3, 4, 5, 6, 7, 8].filter(id => !existingIds.has(id));
    if (available.length > 0 && team3.length > 0) {
      const repIdx = team3.length - 1;
      const oldId = team3[repIdx].monsterId;
      const newId = available[0];
      team3[repIdx].monsterId = newId;

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

    // 4. REPLACEMENT_WITH_BADGE_VARIANT
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

  public static async executeDPlusSSearch(
    dCatalog: DCandidateCatalogRecord[],
    adverseCases: any[],
    searchSeed: number
  ): Promise<{ dsTrials: DSTrialRecord[]; retainedLineages: any[]; discardedDCount: number }> {
    const dsTrials: DSTrialRecord[] = [];
    const retainedLineages: any[] = [];
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

      for (const baseCase of adverseCases) {
        if (dHadSignal) break;

        const dTargetSnap: any = {
          formationId: `d_${dRec.dId}`,
          displayName: `D_${dRec.dId}`,
          canonicalFingerprint: dRec.dId,
          team: dRec.modifiedTeam,
          evol: dRec.modifiedEvol,
        };

        const resolver = FormationSnapshotResolver.getInstance();
        const oppSnap = resolver.resolveFormationSnapshot({ formationId: baseCase.opponentFormationId });

        const dStates = RoundBoardStateFactory.captureStatesFromBaselineMatch({
          targetSnap: dTargetSnap,
          opponentSnap: oppSnap,
          targetSide: baseCase.targetSide,
          seed: baseCase.seed,
        });

        const matchingDState = dStates.find(st => st.targetRound === baseCase.round) ?? dStates[0];
        if (!matchingDState) continue;

        const dBaseRes = SingleRoundEngine.runSingleRound(matchingDState);
        const seenFp = new Set<string>();
        seenFp.add(matchingDState.stateFingerprint);

        for (let sIdx = 1; sIdx <= 8; sIdx++) {
          const edits = CandidateSpace.sampleCompatibleEdits(matchingDState, rng);
          if (edits.length === 0) continue;

          const candidateState = RoundBoardStateFactory.cloneWithEdits(matchingDState, edits);
          const fp = candidateState.stateFingerprint;
          if (seenFp.has(fp)) continue;
          seenFp.add(fp);

          const res = SingleRoundEngine.runSingleRound(candidateState);
          const obj = evaluateObjectiveVector(res, baseCase.targetSide, edits.length);
          const baseObj = evaluateObjectiveVector(dBaseRes, baseCase.targetSide, 0);

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
            break;
          }
        }
      }

      if (!dHadSignal) {
        discardedDCount++;
      }
    }

    return { dsTrials, retainedLineages, discardedDCount };
  }
}
