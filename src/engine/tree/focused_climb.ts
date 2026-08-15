// ============================================================
// 聚焦替换爬山 v7 —— 单替换穷举（评估所有候选，选最优接受）
//
// 用户定案：
//   - 不做双替换，只做单替换穷举
//   - 穷举法：遍历所有候选，评估完统一选 objective 最高的（非贪心 break）
//   - 接受准则：最优候选 > 当前才接受，否则停止
//   - 目标看全局：期望胜场数
//   - 变异看局部：只动"输的分及扩大一分"范围内的怪
//
// 运行：npx vite-node --script src/engine/tree/focused_climb.ts [种子] [输出] [局数] [秒数]
// ============================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { EvolFormation } from './evol_gene';
import { cloneEvolFormation, walkEvolNodes, summarizeEvolFormation, formationToEvol } from './evol_gene';
import { replaceMonster, moveWithinZone, roleOf, isPositionIrrelevant } from './tree_ops';
import { playSpecVsSpec, type SideSpec } from './arena';

function loadBundle(): any {
  const w = globalThis as any;
  const code = readFileSync(resolve('public/ai-bundle.iife.js'), 'utf8');
  const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
  const b = factory(w, w);
  return b?.BattleAI ?? w.BattleAI;
}

const FOUR_COST_IDS = new Set([101, 102, 108, 115, 118, 120]);

function roundScoreProfile(BundleAI: any, candidate: EvolFormation, target: any, aSide: 1 | 2, games: number): number[] {
  const specA: SideSpec = { kind: 'evol', f: candidate };
  const specB: SideSpec = { kind: 'native', f: target };
  const acc = [0, 0, 0, 0, 0];
  for (let i = 0; i < games; i++) {
    const r = playSpecVsSpec(BundleAI, specA, specB, aSide, 1000 + i);
    for (let k = 0; k < 5; k++) acc[k] += r.roundScores[k] ?? 0;
  }
  return acc.map(v => v / games);
}
function objective(profile: number[]): number {
  return profile.reduce((a, b) => a + b, 0);
}

/** 聚焦范围内所有 (nodeId, round, monsterId) 槽位 */
function focusSlots(f: EvolFormation, focusLo: number, focusHi: number): { nodeId: string; round: number; monsterId: number }[] {
  const out: { nodeId: string; round: number; monsterId: number }[] = [];
  for (const n of walkEvolNodes(f.root)) {
    if (n.round >= focusLo && n.round <= focusHi) {
      for (const p of n.placements) out.push({ nodeId: n.id, round: n.round, monsterId: p.monsterId });
    }
  }
  return out;
}

function main(): void {
  const seedName = process.argv[2] || '肃清';
  const outPath = process.argv[3] || 'reports/focused_climb_result.json';
  const evalGames = Number(process.argv[4] || 6);
  const totalSeconds = Number(process.argv[5] || 600);

  const BundleAI = loadBundle();
  const src = FORMATION_LIBRARY.find(f => f.name === seedName);
  if (!src) { console.error(`种子阵型不存在: ${seedName}`); process.exit(1); }

  const target = FORMATION_LIBRARY.find(f => f.name === '全二冲')!;
  const aSide = 2;

  const t0 = Date.now();
  const deadline = t0 + totalSeconds * 1000;

  let current = formationToEvol(src);
  const evaluate = (f: EvolFormation): number[] => roundScoreProfile(BundleAI, f, target, aSide, evalGames);

  let best = cloneEvolFormation(current);
  let bestProfile = evaluate(best);
  let bestObj = objective(bestProfile);
  let iterations = 0, totalMoves = 0;

  console.log(`=== 聚焦爬山 v8：${seedName} 后手 vs 全二冲（${totalSeconds}s，每步${evalGames}局）===`);
  console.log(`初始 [${bestProfile.map(v => v.toFixed(2)).join(', ')}] 期望 ${bestObj.toFixed(2)}`);

  const teamIds = current.team.filter(s => s.monsterId > 0).map(s => s.monsterId);

  while (Date.now() < deadline) {
    iterations++;
    const curProfile = evaluate(current);
    const curObj = objective(curProfile);
    const losing = curProfile.map((v, i) => v < 0 ? i + 1 : 0).filter(v => v > 0);
    if (losing.length === 0) { console.log(`第${iterations}轮：全胜，结束。`); break; }
    const focusLo = Math.max(1, Math.min(...losing) - 1);
    const focusHi = Math.max(...losing);

    const slots = focusSlots(current, focusLo, focusHi);
    let bestChild: EvolFormation | null = null;
    let bestChildObj = curObj;
    let bestChildDesc = '';
    let bestChildKind = '';

    // === P1 单替换穷举 ===
    for (const slot of slots) {
      if (Date.now() >= deadline) break;
      for (const toMid of teamIds) {
        if (Date.now() >= deadline) break;
        if (toMid === slot.monsterId) continue;
        if (slot.round >= 4 && FOUR_COST_IDS.has(toMid)) continue;
        const child = replaceMonster(current, slot.nodeId, slot.monsterId, toMid);
        if (!child) continue;
        const o = objective(evaluate(child));
        if (o > bestChildObj) {
          bestChildObj = o;
          bestChild = child;
          bestChildDesc = `${slot.nodeId} ${slot.monsterId}→${toMid}`;
          bestChildKind = '单替换';
        }
      }
    }

    // === P2 位置搜索（普通怪，规则内换格；替换无改进时或并列进行）===
    // 对聚焦范围内每个普通怪（非特殊/瞄准），穷举其 role 合法列 × 5 行
    for (const slot of slots) {
      if (Date.now() >= deadline) break;
      if (isPositionIrrelevant(slot.monsterId)) continue; // 特殊怪位置无效，跳过
      const role = roleOf(slot.monsterId);
      const isBackline = role === '法师' || role === '射手';
      const cols = isBackline ? [8, 9, 10] : [6, 7, 8];
      for (const x of cols) {
        for (let y = 0; y < 5; y++) {
          if (Date.now() >= deadline) break;
          const child = moveWithinZone(current, slot.monsterId, x, y);
          if (!child) continue;
          const o = objective(evaluate(child));
          if (o > bestChildObj) {
            bestChildObj = o;
            bestChild = child;
            bestChildDesc = `${slot.monsterId}→(${x},${y})`;
            bestChildKind = '位置';
          }
        }
      }
    }

    if (bestChild && bestChildObj > curObj) {
      current = bestChild;
      totalMoves++;
      if (bestChildObj > bestObj) { best = cloneEvolFormation(bestChild); bestObj = bestChildObj; bestProfile = evaluate(best); }
      console.log(`第${iterations}轮：穷举 ${slots.length} 槽，选最优「${bestChildKind}: ${bestChildDesc}」期望 ${bestChildObj.toFixed(2)}`);
    } else {
      console.log(`第${iterations}轮：聚焦 R${focusLo}-R${focusHi} 替换+位置穷举无改进（最优 ${bestChildObj.toFixed(2)} ≤ 当前 ${curObj.toFixed(2)}），停止。`);
      break;
    }
  }

  const ms = Date.now() - t0;
  console.log(`\n=== 完成（${(ms / 1000).toFixed(0)}s，${iterations}轮，${totalMoves}次改进）===`);
  console.log(`最终期望 ${bestObj.toFixed(2)}，[${bestProfile.map(v => v.toFixed(2)).join(', ')}]`);
  console.log(summarizeEvolFormation(best));

  writeFileSync(outPath, JSON.stringify({
    type: 'focused_climb8_result',
    seedFormation: seedName,
    elapsedMs: ms, iterations, totalMoves,
    objective: bestObj, profile: bestProfile,
    formation: { name: best.name, archetype: best.archetype, team: best.team, tree: best.root },
  }, null, 2));
  console.log(`结果已保存 → ${outPath}`);
}

main();
