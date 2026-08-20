import type { EvolFormation, EvolNode } from '../../evol_gene';
import { cloneEvolFormation, cloneEvolNode, walkEvolNodes } from '../../evol_gene';
import { treeStrategyFor } from '../../product_tree_strategy';
import { computeCandidateFingerprint } from '../02_candidates';
import { RoundCheckpointService } from './round_checkpoint_service';
import type { LossCaseItem } from './loss_case_service';
import type { ResolvedFormationSnapshot } from '../snapshot_resolver';
import { sha256Hex } from '../../sha256_pure';

export interface LocalCandidate {
  candidateId: string;
  mutatedEvol: EvolFormation;
  behaviorFingerprint: string;
  modifiedVariablesCount: number;
  descriptions: string[];
}

export interface LocalTrialResult {
  lossCaseId: string;
  targetSide: 1 | 2;
  seed: number;
  forkRound: number;
  targetPayloadFingerprint: string;
  targetCalculatorPolicyFingerprint: string;
  candidateId: string;
  behaviorFingerprint: string;
  modifiedVariablesCount: number;
  concreteSelectedVariables: string[];
  outcome: 'W' | 'D' | 'L';
  baselineOutcome: 'W' | 'D' | 'L';
  improved: boolean;
  p1Score: number;
  p2Score: number;
  roundResults: (1 | 2 | 0)[];
  roundHpOutputs: Array<{
    round: number;
    survivors: Array<{ dbId: number; team: 1 | 2; hp: number; maxHp: number }>;
    p1TotalHp: number;
    p2TotalHp: number;
  }>;
  hpOutputDigest: string;
}

export class LocalSearchService {
  public static sampleCandidates(
    lossCase: LossCaseItem,
    baseEvol: EvolFormation,
    limit = 48
  ): LocalCandidate[] {
    const candidates: LocalCandidate[] = [];
    const r = lossCase.forkRound;
    const targetNode = walkEvolNodes(baseEvol.root).find(n => n.round === r) || baseEvol.root;

    // 1. Placement spatial shift
    const deltas = [
      { dx: -1, dy: -1 }, { dx: 0, dy: -1 }, { dx: 1, dy: -1 },
      { dx: -1, dy: 0 },                     { dx: 1, dy: 0 },
      { dx: -1, dy: 1 },  { dx: 0, dy: 1 },  { dx: 1, dy: 1 },
      { dx: -2, dy: 0 },  { dx: 2, dy: 0 },  { dx: 0, dy: -2 }, { dx: 0, dy: 2 },
    ];

    let candIdx = 0;
    for (const d of deltas) {
      if (candidates.length >= limit) break;
      const evol = cloneEvolFormation(baseEvol);
      const node = walkEvolNodes(evol.root).find(n => n.round === r);
      if (node && node.placements.length > 0) {
        node.placements = node.placements.map(p => ({
          ...p,
          x: Math.max(0, Math.min(5, p.x + d.dx)),
          y: Math.max(0, Math.min(5, p.y + d.dy)),
        }));
        const fp = computeCandidateFingerprint(evol);
        candidates.push({
          candidateId: `cand_r${r}_shift_${d.dx}_${d.dy}_${candIdx++}`,
          mutatedEvol: evol,
          behaviorFingerprint: fp,
          modifiedVariablesCount: 1,
          descriptions: [`R${r} placement shift dx=${d.dx}, dy=${d.dy}`],
        });
      }
    }

    // 2. Deployment order mutation
    if (targetNode.placements.length > 1 && candidates.length < limit) {
      const evol = cloneEvolFormation(baseEvol);
      const node = walkEvolNodes(evol.root).find(n => n.round === r);
      if (node) {
        node.placements = [...node.placements].reverse();
        const fp = computeCandidateFingerprint(evol);
        candidates.push({
          candidateId: `cand_r${r}_order_reversed_${candIdx++}`,
          mutatedEvol: evol,
          behaviorFingerprint: fp,
          modifiedVariablesCount: 1,
          descriptions: [`R${r} deployment order reversed`],
        });
      }
    }

    // 3. R+1 / R+2 Follow-up action modification
    if (r <= 4 && candidates.length < limit) {
      for (const d of [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }]) {
        if (candidates.length >= limit) break;
        const evol = cloneEvolFormation(baseEvol);
        const nodeR = walkEvolNodes(evol.root).find(n => n.round === r);
        const nodeNext = walkEvolNodes(evol.root).find(n => n.round === r + 1);
        if (nodeR && nodeNext && nodeR.placements.length > 0) {
          nodeR.placements = nodeR.placements.map(p => ({
            ...p,
            x: Math.max(0, Math.min(5, p.x + d.dx)),
            y: Math.max(0, Math.min(5, p.y + d.dy)),
          }));
          const fp = computeCandidateFingerprint(evol);
          candidates.push({
            candidateId: `cand_r${r}_r${r+1}_coord_${candIdx++}`,
            mutatedEvol: evol,
            behaviorFingerprint: fp,
            modifiedVariablesCount: 2,
            descriptions: [`R${r}+R${r+1} joint coordinate variation`],
          });
        }
      }
    }

    return candidates;
  }

  public static evaluateCase(
    lossCase: LossCaseItem,
    oppSnap: ResolvedFormationSnapshot,
    candidates: LocalCandidate[]
  ): LocalTrialResult[] {
    const trials: LocalTrialResult[] = [];
    const oppStrat = treeStrategyFor(oppSnap.evol);
    const targetSide = lossCase.side;
    const isRushP1 = targetSide === 1;

    for (const cand of candidates) {
      const session = RoundCheckpointService.restore(lossCase.preRCheckpoint, {
        strategyIdentityA: isRushP1 ? 'all2rush_cand' : oppSnap.displayName,
        strategyIdentityB: isRushP1 ? oppSnap.displayName : 'all2rush_cand',
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

      trials.push({
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
      });
    }

    return trials;
  }
}
