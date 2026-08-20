import '../src/engine/env';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FORMATION_LIBRARY } from '../src/ai/formation_library';
import {
  normalizeToEvalSpec,
  playSingleGameSymmetric,
  evaluateFormationAgainstPool,
} from '../src/engine/tree/product_training/eval_engine';

describe('EvalEngine: Symmetric Non-Inverting Arithmetic & Invariants', () => {
  const f0 = normalizeToEvalSpec(FORMATION_LIBRARY[0]); // springsword
  const f1 = normalizeToEvalSpec(FORMATION_LIBRARY[1]); // nutsavior
  const f5 = normalizeToEvalSpec(FORMATION_LIBRARY[5]); // suqing
  const f9 = normalizeToEvalSpec(FORMATION_LIBRARY[9]); // golden_boom

  it('verifies exact game-by-game pairwise symmetry (WA = LB, LA = WB, DA = DB)', () => {
    for (let side of [1, 2] as (1 | 2)[]) {
      for (let g = 0; g < 10; g++) {
        const seed = 500000 + side * 100 + g;
        // f0 视角
        const outcomeA = playSingleGameSymmetric(f0, f1, side, seed);
        // f1 视角 (当 f0 是 side 1 时，f1 实际上是 side 2)
        const oppositeSide = side === 1 ? 2 : 1;
        const outcomeB = playSingleGameSymmetric(f1, f0, oppositeSide, seed);

        if (outcomeA === 'W') {
          assert.equal(outcomeB, 'L', `Game seed ${seed}: if A wins, B must lose`);
        } else if (outcomeA === 'L') {
          assert.equal(outcomeB, 'W', `Game seed ${seed}: if A loses, B must win`);
        } else {
          assert.equal(outcomeB, 'D', `Game seed ${seed}: if A draws, B must draw`);
        }
      }
    }
  });

  it('verifies evaluateFormationAgainstPool satisfies W + D + L = totalGames and non-100% realistic score', () => {
    const opponents = [f1, f5, f9];
    const res = evaluateFormationAgainstPool(f0, opponents, 5, 600000);

    // 3 个对手 × 2 侧 × 5 局 = 30 局
    assert.equal(res.totalGames, 30);
    assert.equal(res.w + res.d + res.l, 30);
    assert.ok(res.score70 >= 0 && res.score70 <= 1.0);
    assert.ok(res.lossRate > 0 || res.drawRate > 0, 'Realistic evaluation against strong opponents must have losses/draws, not fake 100%');
  });

  it('verifies two-way pool evaluation is perfectly balanced across mutually evaluated pairs', () => {
    // 双方互相对战，总得分相加必定为 1.0 (或扣除平局折算)
    const pool = [f0, f1];
    const resA = evaluateFormationAgainstPool(f0, [f1], 10, 700000);
    const resB = evaluateFormationAgainstPool(f1, [f0], 10, 700000);

    assert.equal(resA.w, resB.l, 'A total wins must equal B total losses');
    assert.equal(resA.l, resB.w, 'A total losses must equal B total wins');
    assert.equal(resA.d, resB.d, 'A total draws must equal B total draws');
  });
});
