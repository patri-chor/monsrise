// ============================================================
// 聚焦顺序爬山 v3 —— 目标看全局，变异看局部
//
// 用户定案：
//   - 术语：5 分叫"分"(R1-R5)，五局三胜叫"局"。聚焦到"输的分"。
//   - 目标函数（全局）：期望胜场数（五局三胜的局胜负），
//     能接受"先输第一分、后赢三分"的全局策略，也能区分 0:3 惨败 vs 2:3 惜败。
//   - 变异聚焦（局部）：只动"输的分及扩大一分"范围内的怪，
//     输 4/5 分就只搜 3-5 分，绝不动前面 1/2 分。
//   - 顺序优先：先搜"怪在哪一分出"，再碰位置/标签。
//
// 流程：
//   1. 诊断：对最弱格打多局，统计每分平均得分，定位输的分
//   2. 聚焦范围 = [min(输的分)-1, max(输的分)]（扩大一分，向下取整到 1）
//   3. 顺序搜索：只对出现在聚焦范围内的怪做 moveEarlier，目标分也限在范围内
//   4. 接受准则：期望胜场数（全局），严格 > 才接受
// ============================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { EvolFormation, EvolNode } from './evol_gene';
import { cloneEvolFormation, walkEvolNodes, summarizeEvolFormation, formationToEvol } from './evol_gene';
import { moveEarlier } from './tree_ops';
import { playSpecVsSpec, type SideSpec } from './arena';

function loadBundle(): any {
  const w = globalThis as any;
  const code = readFileSync(resolve('public/ai-bundle.iife.js'), 'utf8');
  const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
  const b = factory(w, w);
  return b?.BattleAI ?? w.BattleAI;
}

const FOUR_COST_IDS = new Set([101, 102, 108, 115, 118, 120]);

/** 对某对手某侧，打 games 局，返回 A 视角每分平均得分（长度 5） */
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

/** 全局目标：期望胜场数 = 每分平均得分之和 / games（等价于 sum(profile)，能接受先输后赢） */
function objective(profile: number[]): number {
  return profile.reduce((a, b) => a + b, 0);
}

/** 某怪出现的所有分（含分支） */
function monsterRounds(root: EvolNode, monsterId: number): number[] {
  const out: number[] = [];
  for (const n of walkEvolNodes(root)) {
    if (n.placements.some(p => p.monsterId === monsterId)) out.push(n.round);
  }
  return out;
}

function main(): void {
  const seedName = process.argv[2] || '肃清';
  const outPath = process.argv[3] || 'reports/focused_climb3_result.json';
  const evalGames = Number(process.argv[4] || 8);
  const BundleAI = loadBundle();
  const src = FORMATION_LIBRARY.find(f => f.name === seedName);
  if (!src) { console.error(`种子阵型不存在: ${seedName}`); process.exit(1); }

  const t0 = Date.now();
  let current = formationToEvol(src);

  const target = FORMATION_LIBRARY.find(f => f.name === '全二冲')!;
  const aSide = 2; // 后手（已知最弱格）

  const profile = roundScoreProfile(BundleAI, current, target, aSide, evalGames);
  console.log(`=== 聚焦顺序爬山 v3：${seedName} 后手 vs 全二冲（${evalGames}局诊断）===`);
  console.log(`初始每分得分: [${profile.map(v => v.toFixed(2)).join(', ')}]`);

  // 定位输的分（得分 < 0）
  const losingRounds = profile.map((v, i) => v < 0 ? i + 1 : 0).filter(v => v > 0);
  console.log(`输的分: ${losingRounds.length ? losingRounds.join(', ') : '无'}`);
  if (losingRounds.length === 0) {
    console.log('无输的分，无需优化。');
    return;
  }

  // 聚焦范围 = [min(输的分)-1, max(输的分)]，向下至少到 1
  const minLosing = Math.min(...losingRounds);
  const maxLosing = Math.max(...losingRounds);
  const focusLo = Math.max(1, minLosing - 1);
  const focusHi = maxLosing;
  console.log(`聚焦范围: R${focusLo}-R${focusHi}（输的分 ${losingRounds.join(',')} 扩大一分）`);

  // 顺序搜索：只对出现在聚焦范围内的怪做 moveEarlier，目标分限在 [focusLo, focusHi]
  const evaluate = (f: EvolFormation): number[] => roundScoreProfile(BundleAI, f, target, aSide, evalGames);

  let best = cloneEvolFormation(current);
  let bestProfile = evaluate(best);
  let bestObj = objective(bestProfile);

  const ids = current.team.filter(s => s.monsterId > 0).map(s => s.monsterId);
  let improvedAny = false;

  for (const mid of ids) {
    const rounds = monsterRounds(best.root, mid);
    if (rounds.length === 0) continue;
    // 该怪当前出现的最晚分（在聚焦范围内才考虑移动）
    const inFocus = rounds.filter(r => r >= focusLo && r <= focusHi);
    if (inFocus.length === 0) continue; // 该怪不在聚焦范围，跳过
    const fromRound = Math.max(...rounds);

    // 尝试移到聚焦范围内的每个更早分（且四费仅前三局）
    for (let toRound = focusLo; toRound < fromRound; toRound++) {
      if (toRound >= 4 && FOUR_COST_IDS.has(mid)) continue;
      const child = moveEarlier(best, mid, fromRound, toRound);
      if (!child) continue;
      const childProfile = evaluate(child);
      const childObj = objective(childProfile);
      // 接受准则：全局期望胜场数，严格改进才接受
      if (childObj > bestObj) {
        best = child;
        bestProfile = childProfile;
        bestObj = childObj;
        improvedAny = true;
        console.log(`  [顺序] ${mid} R${fromRound}→R${toRound}，胜场期望 ${bestObj.toFixed(2)}（profile [${bestProfile.map(v => v.toFixed(2)).join(', ')}]）`);
      }
    }
  }
  if (!improvedAny) console.log('  （聚焦范围内顺序搜索无严格改进）');

  const ms = Date.now() - t0;
  console.log(`\n=== 完成（${(ms / 1000).toFixed(0)}s）===`);
  console.log(`最终胜场期望 ${bestObj.toFixed(2)}，每分得分 [${bestProfile.map(v => v.toFixed(2)).join(', ')}]`);
  console.log(summarizeEvolFormation(best));

  writeFileSync(outPath, JSON.stringify({
    type: 'focused_climb3_result',
    seedFormation: seedName,
    focus: { lo: focusLo, hi: focusHi },
    objective: bestObj,
    profile: bestProfile,
    formation: { name: best.name, archetype: best.archetype, team: best.team, tree: best.root },
  }, null, 2));
  console.log(`结果已保存 → ${outPath}`);
}

main();
