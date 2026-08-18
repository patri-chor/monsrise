import '../src/engine/env';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FORMATION_LIBRARY } from '../src/ai/formation_library';
import { playSpecVsSpec, type SideSpec } from '../src/engine/tree/arena';
import { formationToEvol } from '../src/engine/tree/evol_gene';
import type { Formation } from '../src/ai/types';

function loadBundle(): any {
  const w = globalThis as any;
  const code = readFileSync(resolve('public/ai-bundle.iife.js'), 'utf8');
  const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
  const b = factory(w, w);
  return b?.BattleAI ?? w.BattleAI;
}

const BundleAI = loadBundle();

const cands = readFileSync(resolve('tests/fixtures/tree/thirty_three_mutated_candidates.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .map(l => JSON.parse(l));

const families = JSON.parse(readFileSync(resolve('tests/fixtures/tree/early_seven_bundles.json'), 'utf8'));

const cand1 = cands[0]; // cand_s1_1_d3db
const evol1 = formationToEvol(cand1 as unknown as Formation);
const opp0 = families[0].trainingVariant; // springsword_train

console.log('=== 对局调试: cand_s1_1_d3db (泉水剑变异) VS springsword_train ===');
console.log('cand1 team:', cand1.team.map((s: any) => s.monsterId));
console.log('opp0 team:', opp0.team.map((s: any) => s.monsterId));

const specA: SideSpec = { kind: 'evol', f: evol1 };
const specB: SideSpec = { kind: 'native', f: opp0 };

const res1 = playSpecVsSpec(BundleAI, specA, specB, 1, 12345);
console.log('Side 1 match result:', res1);

const res2 = playSpecVsSpec(BundleAI, specA, specB, 2, 12345);
console.log('Side 2 match result:', res2);
