import '../src/engine/env';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { FORMATION_LIBRARY } from '../src/ai/formation_library';
import { formationToEvol, evolToBundleFormation, cloneEvolFormation, walkEvolNodes, type EvolFormation } from '../src/engine/tree/evol_gene';
import { computeCalculatedUnitRatio, validateTreePlacements, getMonsterDisplayName } from '../src/engine/tree/order_search';
import { costOf } from '../src/engine/tree/tree_ops';
import type { Formation } from '../src/ai/types';

function computeFingerprint(obj: any): string {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 12);
}

export interface FrozenSourceRecord {
  sourceIndex: number;
  id: string;
  name: string;
  archetype: string;
  team: Formation['team'];
  tree: Formation['tree'];
  calculatedUnitRatio: number;
  calculatedCount: number;
  controllableCount: number;
  fingerprint: string;
}

export interface GeneratedCandidateRecord {
  candidateId: string;
  sourceSeedIndex: number;
  sourceSeedId: string;
  sourceSeedName: string;
  noveltyBucket: 'light' | 'medium' | 'heavy';
  noveltyScore: number;
  mutationType: string;
  mutationDescription: string;
  team: Formation['team'];
  tree: Formation['tree'];
  deckKey: string;
  treeFingerprint: string;
}

export function buildT016Fixtures() {
  const fixturesDir = resolve('tests/fixtures/tree');
  if (!existsSync(fixturesDir)) {
    mkdirSync(fixturesDir, { recursive: true });
  }

  // 1. Snapshot 11 Sources
  const sources: FrozenSourceRecord[] = FORMATION_LIBRARY.slice(0, 11).map((f, idx) => {
    const ratioAnalysis = computeCalculatedUnitRatio(f.team);
    return {
      sourceIndex: idx,
      id: f.id ?? `source_${idx + 1}`,
      name: f.name,
      archetype: f.archetype || 'prayer',
      team: f.team,
      tree: f.tree,
      calculatedUnitRatio: ratioAnalysis.ratio,
      calculatedCount: ratioAnalysis.calculatedCount,
      controllableCount: ratioAnalysis.controllableMonsterIds.length,
      fingerprint: computeFingerprint(f),
    };
  });

  const sourcesPath = resolve(fixturesDir, 'eleven_frozen_sources.json');
  writeFileSync(sourcesPath, JSON.stringify(sources, null, 2), 'utf8');
  console.log(`[T016 Fixture] Snapshot 11 sources written to ${sourcesPath}`);

  // 2. 生成 33 个合法突变候选 (每源 3 个, light/medium/heavy)
  const allCandidates: GeneratedCandidateRecord[] = [];

  for (let sIdx = 0; sIdx < sources.length; sIdx++) {
    const src = sources[sIdx];
    const evol = formationToEvol(src as unknown as Formation);

    // Mutation 1: Light (微调 R1/R2 可控怪兽站位或轮内顺序)
    const c1Evol = cloneEvolFormation(evol);
    const nodes = walkEvolNodes(c1Evol.root);
    const r1Node = nodes.find(n => n.round === 1);
    let m1Desc = 'R1 站位微调';
    if (r1Node && r1Node.placements.length > 0) {
      const p = r1Node.placements[0];
      p.y = (p.y + 1) % 5;
      m1Desc = `R1 ${getMonsterDisplayName(p.monsterId)} 站位平移至 (${p.x},${p.y})`;
    }
    const c1Bundle = evolToBundleFormation(c1Evol);
    const c1DeckKey = c1Bundle.team.map(t => t.monsterId).sort().join('-');
    allCandidates.push({
      candidateId: `cand_s${sIdx + 1}_1_${computeFingerprint(c1Evol).slice(0, 4)}`,
      sourceSeedIndex: sIdx,
      sourceSeedId: src.id,
      sourceSeedName: src.name,
      noveltyBucket: 'light',
      noveltyScore: 0.25,
      mutationType: 'position_or_order_shift',
      mutationDescription: m1Desc,
      team: c1Bundle.team,
      tree: c1Bundle.tree,
      deckKey: c1DeckKey,
      treeFingerprint: computeFingerprint(c1Bundle.tree),
    });

    // Mutation 2: Medium (微调徽章或中前期间隔重排)
    const c2Evol = cloneEvolFormation(evol);
    const c2Bundle = evolToBundleFormation(c2Evol);
    // 徽章微调
    if (c2Bundle.team.length > 0 && c2Bundle.team[0].badgeIds.length >= 2) {
      const b0 = c2Bundle.team[0].badgeIds[0];
      c2Bundle.team[0].badgeIds[0] = c2Bundle.team[0].badgeIds[1];
      c2Bundle.team[0].badgeIds[1] = b0;
    }
    const c2DeckKey = c2Bundle.team.map(t => t.monsterId).sort().join('-');
    allCandidates.push({
      candidateId: `cand_s${sIdx + 1}_2_${computeFingerprint(c2Bundle).slice(0, 4)}`,
      sourceSeedIndex: sIdx,
      sourceSeedId: src.id,
      sourceSeedName: src.name,
      noveltyBucket: 'medium',
      noveltyScore: 0.50,
      mutationType: 'badge_permutation_or_timing',
      mutationDescription: '徽章搭配调优与节奏微调',
      team: c2Bundle.team,
      tree: c2Bundle.tree,
      deckKey: c2DeckKey,
      treeFingerprint: computeFingerprint(c2Bundle.tree),
    });

    // Mutation 3: Heavy (合法时机提前/延后重组)
    const c3Evol = cloneEvolFormation(evol);
    const c3Nodes = walkEvolNodes(c3Evol.root);
    const r2Node = c3Nodes.find(n => n.round === 2);
    const r3Node = c3Nodes.find(n => n.round === 3);
    let m3Desc = 'R2/R3 入场节奏重排';
    if (r2Node && r3Node && r3Node.placements.length > 0) {
      const p = r3Node.placements[0];
      if (costOf(p.monsterId) <= 2) {
        // 尝试时机提前
        r3Node.placements.shift();
        r2Node.placements.push(p);
        if (validateTreePlacements(c3Evol)) {
          m3Desc = `怪兽 ${getMonsterDisplayName(p.monsterId)} 从 R3 提前至 R2`;
        }
      }
    }
    const c3Bundle = evolToBundleFormation(c3Evol);
    const c3DeckKey = c3Bundle.team.map(t => t.monsterId).sort().join('-');
    allCandidates.push({
      candidateId: `cand_s${sIdx + 1}_3_${computeFingerprint(c3Bundle).slice(0, 4)}`,
      sourceSeedIndex: sIdx,
      sourceSeedId: src.id,
      sourceSeedName: src.name,
      noveltyBucket: 'heavy',
      noveltyScore: 0.75,
      mutationType: 'round_timing_shift',
      mutationDescription: m3Desc,
      team: c3Bundle.team,
      tree: c3Bundle.tree,
      deckKey: c3DeckKey,
      treeFingerprint: computeFingerprint(c3Bundle.tree),
    });
  }

  const candsPath = resolve(fixturesDir, 'thirty_three_mutated_candidates.jsonl');
  writeFileSync(candsPath, allCandidates.map(c => JSON.stringify(c)).join('\n') + '\n', 'utf8');
  console.log(`[T016 Fixture] 33 mutated candidates written to ${candsPath}`);
}

buildT016Fixtures();
