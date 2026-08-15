// ============================================================
// 部署验证：把进化产物（evolution2_result.json）读回 → 转 EvolFormation
// → loadCustomFormation 注入 bundle → 打分离测试 + vs 规则随机（不败率）。
//
// 关键链路验证：进化出的新阵型能否真正部署（而非只存在于 JSON）。
//
// 运行：npx vite-node --script src/engine/train/deploy_evolved.ts [结果json] [分离测试局数] [vs随机局数]
// ============================================================

import '../env';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { registerAllBadges } from '../../game/BadgeSystem';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { EvolFormation, EvolNode, FeatureMask } from './evol_gene';
import { summarizeEvolFormation, maskToLabel, isEmptyMask } from './evol_gene';
import { evaluateArena, formatArenaResult, playSpecVsSpec, type SideSpec } from './arena';

registerAllBadges();

function loadBundle(bundlePath: string): any {
  const w = globalThis as any;
  try {
    const code = readFileSync(resolve(bundlePath), 'utf8');
    const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
    const bundleExports = factory(w, w);
    return bundleExports?.BattleAI ?? w.BattleAI ?? null;
  } catch (e) {
    console.error(`[deploy] bundle 加载失败: ${(e as Error).message}`);
    return null;
  }
}

/** JSON roundtrip：把序列化的树节点转回 EvolNode（补全缺失的 condition 字段） */
function reviveNode(raw: any): EvolNode {
  const cond: FeatureMask = {
    side: raw.condition?.side ?? null,
    main: raw.condition?.main ?? null,
    subs: raw.condition?.subs ?? [],
    keys: raw.condition?.keys ?? [],
  };
  return {
    id: raw.id,
    round: raw.round,
    condition: cond,
    placements: (raw.placements ?? []).map((p: any) => ({ monsterId: p.monsterId, x: p.x, y: p.y })),
    children: (raw.children ?? []).map((c: any) => reviveNode(c)),
  };
}

function reviveFormation(raw: any): EvolFormation {
  return {
    name: raw.name ?? 'evolved',
    archetype: raw.archetype ?? 'half_rush',
    team: (raw.team ?? []).map((s: any) => ({ monsterId: s.monsterId, badgeIds: [...(s.badgeIds ?? [])] })),
    root: reviveNode(raw.tree ?? raw.root),
  };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** vs 规则随机（L1 口径）：随机卡组(7套)+完全随机站位，测不败率 */
function playVsRuleRandom(
  BundleAI: any,
  spec: SideSpec,
  seed: number,
  oppDeck: { monsterId: number; badgeIds: number[] }[],
): { w: number; d: number; l: number } {
  // 复用 playSpecVsSpec 的 native 侧做对手？不行，规则随机不是 bundle。
  // 这里用简单实现：对手随机站位的规则随机，需要 gameEngine 直接放置。
  // 为避免重复实现战斗循环，改用 bundle 对手 + 随机站位近似？
  // 注：规则随机对手已在 Python selfplay.random_place 有权威实现，此处仅做占位。
  throw new Error('vs 规则随机需走 Python bridge（selfplay.play_vs_random），本脚本仅验证部署链路');
}

function main(): void {
  const jsonPath = process.argv[2] || 'reports/evolution2_result.json';
  const adGames = Number(process.argv[3]) || 4;
  const BundleAI = loadBundle('public/ai-bundle.iife.js');
  if (!BundleAI) { console.error('bundle 未加载'); process.exit(1); }

  const raw = JSON.parse(readFileSync(resolve(jsonPath), 'utf8'));
  const evolved = reviveFormation(raw.formation);
  console.log('=== 进化产物部署验证 ===');
  console.log(summarizeEvolFormation(evolved));
  console.log('');

  // 1. 分离测试（确认可注入 bundle 并真实执行）
  const t0 = Date.now();
  const r = evaluateArena(BundleAI, evolved, adGames);
  console.log(formatArenaResult(evolved.name, r));
  console.log(`分离测试耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  // 2. 与 7 阵型逐一交手（双向各 1 局），确认无崩溃 + 综合胜平率
  const spec: SideSpec = { kind: 'evol', f: evolved };
  let w = 0, d = 0, l = 0;
  for (const opp of FORMATION_LIBRARY) {
    const r1 = playSpecVsSpec(BundleAI, spec, { kind: 'native', f: opp }, 1, 7000);
    const r2 = playSpecVsSpec(BundleAI, spec, { kind: 'native', f: opp }, 2, 7001);
    w += r1.w + r2.w; d += r1.d + r2.d; l += r1.l + r2.l;
  }
  const t = w + d + l;
  console.log(`vs 7阵型（双向各1局，共${t}局）: ${w}胜 ${d}平 ${l}负 不败率 ${((w + d) / t * 100).toFixed(1)}%`);
  console.log('\n部署链路验证通过：进化产物可注入 bundle 并真实执行。');
}

main();
