// ============================================================
// 聚焦替换爬山 v9 —— 单替换穷举（评估所有候选，选最优接受）
//
// 用户定案：
//   - 不做双替换，只做单替换穷举
//   - 穷举法：遍历所有候选，评估完统一选 objective 最高的（非贪心 break）
//   - 接受准则：最优候选 > 当前才接受，否则停止
//   - 目标看全局：期望胜场数
//   - 变异看局部：只动"输的分及扩大一分"范围内的怪
//
// v9 新增：
//   - 中文调试日志：每轮输出聚焦范围、待搜槽位、采纳的修改（顺序/位置/替换目标）
//   - 经验库（search_experience.ts）：结构上完全不可用的候选持久化跳过，
//     避免后续轮回反复构造/评估同样的无效候选
//
// 运行：npx vite-node --script src/engine/tree/focused_climb.ts [种子] [输出] [局数] [秒数] [靶子] [侧] [focusLo]
// ============================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { EvolFormation } from './evol_gene';
import { cloneEvolFormation, walkEvolNodes, summarizeEvolFormation, formationToEvol } from './evol_gene';
import { replaceMonster, moveWithinZone, roleOf, isPositionIrrelevant, getLastValidationError } from './tree_ops';
import { playSpecVsSpec, type SideSpec } from './arena';
import { ExperienceBank, replaceKey, moveKey } from './search_experience';

function loadBundle(): any {
  const w = globalThis as any;
  const code = readFileSync(resolve('public/ai-bundle.iife.js'), 'utf8');
  const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
  const b = factory(w, w);
  return b?.BattleAI ?? w.BattleAI;
}

const FOUR_COST_IDS = new Set([101, 102, 108, 115, 118, 120]);

const MONSTER_NAME: Record<number, string> = {
  101: '肃清哥', 102: '大祭司', 103: '学徒', 104: '散弹', 105: '祈祷', 106: '冲锋', 107: '咒法',
  108: '救星', 109: '银狙', 110: '帝国', 111: '见习', 112: '守卫', 113: '矿爆', 114: '突突',
  115: '铲土', 116: '钻头', 117: '铁甲', 118: '塞雷', 119: '忍猴', 120: '金猴', 121: '僧猴',
  122: '丛林猴', 123: '棒球', 124: '三振', 125: '战壕', 126: '祭司',
};
const nm = (id: number) => MONSTER_NAME[id] ?? String(id);

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
  const targetName = process.argv[6] || '全二冲';
  const aSideArg = Number(process.argv[7] || 2);
  const focusLoMin = Number(process.argv[8] || 1);

  const BundleAI = loadBundle();
  const src = FORMATION_LIBRARY.find(f => f.name === seedName);
  if (!src) { console.error(`种子阵型不存在: ${seedName}`); process.exit(1); }
  const formationId = src.id; // 经验库 key 用英文 id 编码

  const target = FORMATION_LIBRARY.find(f => f.name === targetName)!;
  if (!target) { console.error(`靶子阵型不存在: ${targetName}`); process.exit(1); }
  const aSide: 1 | 2 = aSideArg === 1 ? 1 : 2;

  // 经验库：加载历史无效候选
  const exp = new ExperienceBank();
  exp.load();

  const t0 = Date.now();
  const deadline = t0 + totalSeconds * 1000;

  let current = formationToEvol(src);
  const evaluate = (f: EvolFormation): number[] => roundScoreProfile(BundleAI, f, target, aSide, evalGames);

  let best = cloneEvolFormation(current);
  let bestProfile = evaluate(best);
  let bestObj = objective(bestProfile);
  let iterations = 0, totalMoves = 0;
  let skippedByExp = 0, newlyInvalid = 0;

  console.log(`=== 聚焦爬山 v9：${seedName} ${aSide === 1 ? '先手' : '后手'} vs ${targetName}（${totalSeconds}s，每步${evalGames}局，focusLo≥${focusLoMin}）===`);
  console.log(`经验库已加载 ${exp.size} 条历史无效候选`);
  console.log(`初始 逐轮期望 [${bestProfile.map(v => v.toFixed(2)).join(', ')}] 总期望 ${bestObj.toFixed(2)}`);

  const teamIds = current.team.filter(s => s.monsterId > 0).map(s => s.monsterId);

  while (Date.now() < deadline) {
    iterations++;
    const curProfile = evaluate(current);
    const curObj = objective(curProfile);
    const losing = curProfile.map((v, i) => v < 0 ? i + 1 : 0).filter(v => v > 0);
    if (losing.length === 0) { console.log(`[爬山 第${iterations}轮] 全胜（无输的分），结束。`); break; }
    const focusLo = Math.max(focusLoMin, Math.min(...losing) - 1);
    const focusHi = Math.max(...losing);

    const slots = focusSlots(current, focusLo, focusHi);
    console.log(`\n[爬山 第${iterations}轮] 聚焦 R${focusLo}-R${focusHi}（输的分 R${losing.join('/R')} 往前扩1），待搜槽位 ${slots.length} 个，当前总期望 ${curObj.toFixed(2)}`);

    let bestChild: EvolFormation | null = null;
    let bestChildObj = curObj;
    let bestChildDesc = '';
    let bestChildKind = '';
    let roundEvaluated = 0;

    // === P1 单替换穷举 ===
    for (const slot of slots) {
      if (Date.now() >= deadline) break;
      for (const toMid of teamIds) {
        if (Date.now() >= deadline) break;
        if (toMid === slot.monsterId) continue;
        if (slot.round >= 4 && FOUR_COST_IDS.has(toMid)) continue;
        const key = replaceKey(formationId, slot.nodeId, slot.monsterId, toMid);
        if (exp.isKnownInvalid(key)) { skippedByExp++; continue; }
        const child = replaceMonster(current, slot.nodeId, slot.monsterId, toMid);
        if (!child) {
          const reason = getLastValidationError() ?? '结构非法';
          exp.markInvalid(key, reason);
          newlyInvalid++;
          continue;
        }
        roundEvaluated++;
        const o = objective(evaluate(child));
        if (o > bestChildObj) {
          bestChildObj = o;
          bestChild = child;
          bestChildDesc = `替换 R${slot.round} 节点${slot.nodeId}：${nm(slot.monsterId)} → ${nm(toMid)}`;
          bestChildKind = '单替换';
        }
      }
    }

    // === P2 位置搜索（普通怪，规则内换格）===
    for (const slot of slots) {
      if (Date.now() >= deadline) break;
      if (isPositionIrrelevant(slot.monsterId)) continue;
      const role = roleOf(slot.monsterId);
      const isBackline = role === '法师' || role === '射手';
      const cols = isBackline ? [8, 9, 10] : [6, 7, 8];
      for (const x of cols) {
        for (let y = 0; y < 5; y++) {
          if (Date.now() >= deadline) break;
          const key = moveKey(formationId, slot.nodeId, slot.monsterId, x, y);
          if (exp.isKnownInvalid(key)) { skippedByExp++; continue; }
          const child = moveWithinZone(current, slot.monsterId, x, y);
          if (!child) {
            const reason = getLastValidationError() ?? '结构非法';
            exp.markInvalid(key, reason);
            newlyInvalid++;
            continue;
          }
          roundEvaluated++;
          const o = objective(evaluate(child));
          if (o > bestChildObj) {
            bestChildObj = o;
            bestChild = child;
            bestChildDesc = `移动 ${nm(slot.monsterId)} → (${x},${y})`;
            bestChildKind = '位置';
          }
        }
      }
    }

    console.log(`  [评估] 本轮实际评估 ${roundEvaluated} 个候选（跳过经验库无效 ${skippedByExp} 个）`);

    if (bestChild && bestChildObj > curObj) {
      current = bestChild;
      totalMoves++;
      if (bestChildObj > bestObj) { best = cloneEvolFormation(bestChild); bestObj = bestChildObj; bestProfile = evaluate(best); }
      console.log(`  [采纳] 第${iterations}轮 ${bestChildKind}：${bestChildDesc}，总期望 ${curObj.toFixed(2)} → ${bestChildObj.toFixed(2)}`);
    } else {
      console.log(`  [无改进] 最优候选 ${bestChildObj.toFixed(2)} ≤ 当前 ${curObj.toFixed(2)}，停止。`);
      break;
    }
  }

  const ms = Date.now() - t0;
  exp.save();
  console.log(`\n=== 完成（${(ms / 1000).toFixed(0)}s，${iterations}轮，${totalMoves}次改进）===`);
  console.log(`最终总期望 ${bestObj.toFixed(2)}，逐轮 [${bestProfile.map(v => v.toFixed(2)).join(', ')}]`);
  console.log(`经验库：本轮跳过历史无效 ${skippedByExp} 个，新增无效 ${newlyInvalid} 个，累计 ${exp.size} 条`);
  console.log(summarizeEvolFormation(best));

  writeFileSync(outPath, JSON.stringify({
    type: 'focused_climb9_result',
    seedFormation: seedName,
    elapsedMs: ms, iterations, totalMoves,
    objective: bestObj, profile: bestProfile,
    skippedByExperience: skippedByExp, newlyInvalid,
    formation: { name: best.name, archetype: best.archetype, team: best.team, tree: best.root },
  }, null, 2));
  console.log(`结果已保存 → ${outPath}`);
}

main();
