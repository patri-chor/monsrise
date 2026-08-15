// ============================================================
// 一致性验证：原生 bundle(label 关键词匹配) vs 进化基因(FeatureMask 匹配)
// 同一阵型、同一对手、同一 seed，两者应逐局胜负一致。
// 若不一致 → FeatureMask 翻译与原生 selectBranch 语义有偏差，进化基线不可信。
//
// 重点验证对象：含 R1 分支的阵型（梯子塞雷"对方祷徒"分支在 R1 选择，场上为空，
// 只能靠手牌识别；旧 AND 语义会漏触发，OR 组修复后应一致）。
//
// 运行：npx vite-node --script src/engine/train/verify_consistency.ts [局数]
// ============================================================

import '../env';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { registerAllBadges } from '../../game/BadgeSystem';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import { formationToEvol } from './evol_gene';
import { playSpecVsSpec, type SideSpec } from './arena';

registerAllBadges();

function loadBundle(bundlePath: string): any {
  const w = globalThis as any;
  try {
    const code = readFileSync(resolve(bundlePath), 'utf8');
    const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
    const bundleExports = factory(w, w);
    return bundleExports?.BattleAI ?? w.BattleAI ?? null;
  } catch (e) {
    console.error(`[verify] bundle 加载失败: ${(e as Error).message}`);
    return null;
  }
}

function main(): void {
  const games = Number(process.argv[2]) || 6;
  const BundleAI = loadBundle('public/ai-bundle.iife.js');
  if (!BundleAI) { console.error('bundle 未加载'); process.exit(1); }

  const t0 = Date.now();
  let totalMismatch = 0;
  let totalGames = 0;
  const perFormation: Record<string, { match: number; mismatch: number }> = {};

  // 对每个多分支阵型，vs 每个对手，同 seed 分别跑 native 和 evol
  for (const learner of FORMATION_LIBRARY) {
    const evolSpec: SideSpec = { kind: 'evol', f: formationToEvol(learner) };
    const nativeSpec: SideSpec = { kind: 'native', f: learner };
    perFormation[learner.name] = { match: 0, mismatch: 0 };

    for (const opp of FORMATION_LIBRARY) {
      for (let g = 0; g < games; g++) {
        const aSide: 1 | 2 = g % 2 === 0 ? 1 : 2;
        const seed = 20000 + g;
        const rNative = playSpecVsSpec(BundleAI, nativeSpec, { kind: 'native', f: opp }, aSide, seed);
        const rEvol = playSpecVsSpec(BundleAI, evolSpec, { kind: 'native', f: opp }, aSide, seed);
        totalGames++;
        const same = (rNative.w === rEvol.w) && (rNative.d === rEvol.d) && (rNative.l === rEvol.l)
          && rNative.summary === rEvol.summary;
        if (same) {
          perFormation[learner.name].match++;
        } else {
          perFormation[learner.name].mismatch++;
          totalMismatch++;
          if (totalMismatch <= 10) {
            console.log(`[不一致] ${learner.name} vs ${opp.name} side${aSide} seed${seed}`);
            console.log(`  native: ${rNative.summary}`);
            console.log(`  evol:   ${rEvol.summary}`);
          }
        }
      }
    }
  }

  const ms = Date.now() - t0;
  console.log(`\n=== 一致性验证（native label匹配 vs evol FeatureMask匹配，同seed逐局对比）===`);
  for (const [name, s] of Object.entries(perFormation)) {
    const pct = s.match / (s.match + s.mismatch) * 100;
    console.log(`  ${name}: ${s.match}一致 / ${s.mismatch}不一致 (${pct.toFixed(1)}%)`);
  }
  console.log(`\n总计: ${totalGames - totalMismatch}/${totalGames} 一致，不一致 ${totalMismatch} 局`);
  console.log(`耗时 ${(ms / 1000).toFixed(1)}s`);
}

main();
