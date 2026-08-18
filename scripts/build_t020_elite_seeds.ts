import '../src/engine/env';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function buildT020EliteSeeds() {
  const cands = readFileSync(resolve('tests/fixtures/tree/eight_frozen_candidates.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map(l => JSON.parse(l));

  const eliteMap: Record<string, any> = {
    cand_s1_1_2a: {
      provenanceTask: 'T014',
      earlyHeldOutDelta: 0.057,
      strongPanelDelta: 0.119,
      adoptedMove: '[常规站位 R1] 可控怪兽 105 → (8,0)',
    },
    cand_s1_2_2b: {
      provenanceTask: 'T014',
      earlyHeldOutDelta: 0.171,
      strongPanelDelta: 0.194,
      adoptedMove: '[常规站位 R1] 可控怪兽 105 → (8,1)',
    },
    cand_s2_1_8e: {
      provenanceTask: 'T014',
      earlyHeldOutDelta: 0.093,
      strongPanelDelta: 0.125,
      adoptedMove: '[入场提前] 怪兽 110 从 R3 提前至 R2',
    },
  };

  const eliteSeeds = cands
    .filter(c => eliteMap[c.candidateId])
    .map(c => ({
      candidateId: c.candidateId,
      sourceSeedName: c.sourceSeedName,
      provenanceTask: eliteMap[c.candidateId].provenanceTask,
      adoptedMove: eliteMap[c.candidateId].adoptedMove,
      historicalT014Metrics: {
        earlyHeldOutDelta: eliteMap[c.candidateId].earlyHeldOutDelta,
        strongPanelDelta: eliteMap[c.candidateId].strongPanelDelta,
      },
      team: c.team,
      tree: c.tree,
    }));

  const outPath = resolve('tests/fixtures/tree/persistent_elite_seeds.json');
  writeFileSync(outPath, JSON.stringify(eliteSeeds, null, 2), 'utf8');
  console.log(`[T020] Wrote ${eliteSeeds.length} persistent elite seeds to ${outPath}`);
}

buildT020EliteSeeds();
