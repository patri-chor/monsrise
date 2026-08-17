// ============================================================
// 单分决策日志（single-round decision log）
//
// 对「优化不了」的阵型，不强行自动决策，而是逐分逐对手统计胜负，
// 输出成 markdown 报告，交用户手动决策。
//
// 报告内容：
//   1. 逐分逐对手胜负矩阵（11 对手 × 5 分，含胜/平/负与颜色标记）
//   2. 对手三层识别标签（main/subs/keys）
//   3. 崩盘分分析（总胜率 < 50% 的分高亮，列出该分输给谁 + 对手标签）
//
// 运行：由 cycle_optimize 在 optimizeFormation 无改进时自动调用，
//   也可单独运行：
//   npx vite-node --script src/engine/tree/decision_log.ts [阵型名] [侧] [局数]
// ============================================================

import '../env';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { Formation } from '../../ai/types';
import { formationToEvol, recognizeArchetype } from './evol_gene';
import { playSpecVsSpec } from './arena';

function loadBundle(): any {
  const w = globalThis as any;
  const code = readFileSync(resolve('public/ai-bundle.iife.js'), 'utf8');
  const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
  const b = factory(w, w);
  return b?.BattleAI ?? w.BattleAI;
}

const MAIN_CN: Record<string, string> = { prayer: '祷徒', halfrush: '半冲', fullrush: '全冲' };
const SUB_CN: Record<string, string> = { dof: 'dof', shield: '盾流', gift: '礼物' };
const KEY_CN: Record<string, string> = {
  drill: '钻头', rush: '冲锋', iron: '铁甲', ninja: '忍猴', tutu: '突突', spell: '咒法', mine: '矿爆',
};

/** 识别对手标签 → 中文 */
function labelOf(opp: Formation): string {
  const ids = opp.team.filter(s => s.monsterId > 0).map(s => s.monsterId);
  const badges = opp.team.flatMap(s => s.badgeIds);
  const rec = recognizeArchetype({ handIds: new Set(ids.slice(0, 4)), handBadges: new Set(badges), boardIds: new Set(ids) });
  const parts: string[] = [];
  if (rec.main) parts.push(MAIN_CN[rec.main] ?? rec.main);
  for (const s of rec.subs) parts.push(SUB_CN[s] ?? s);
  for (const k of rec.keys) parts.push(KEY_CN[k] ?? k);
  return parts.length ? parts.join('/') : '无标签';
}

/** 单分决策日志（返回 md 文本并写入文件） */
export function writeSingleRoundDecisionLog(
  BundleAI: any,
  src: Formation,
  aSide: 1 | 2,
  games: number,
  outPath?: string,
): string {
  const candidate = formationToEvol(src);
  const sideLabel = aSide === 1 ? '先手' : '后手';

  // 逐对手逐分统计
  interface Row { opp: string; label: string; stats: { w: number; d: number; l: number }[] }
  const rows: Row[] = [];

  for (const opp of FORMATION_LIBRARY) {
    if (opp.name === src.name) continue;
    const stats: { w: number; d: number; l: number }[] = [];
    for (let round = 1; round <= 5; round++) {
      let w = 0, d = 0, l = 0;
      for (let i = 0; i < games; i++) {
        const r = playSpecVsSpec(
          BundleAI,
          { kind: 'evol', f: candidate },
          { kind: 'native', f: opp },
          aSide,
          60000 + round * 1000 + i,
        );
        const s = r.roundScores[round - 1];
        if (s === undefined) { d++; continue; } // 该局提前结束，该分未打，计平
        if (s > 0) w++; else if (s < 0) l++; else d++;
      }
      stats.push({ w, d, l });
    }
    rows.push({ opp: opp.name, label: labelOf(opp), stats });
  }

  // 逐分总胜率（用于崩盘分析）
  const roundRates: { round: number; w: number; d: number; l: number; rate: number }[] = [];
  for (let round = 1; round <= 5; round++) {
    let w = 0, d = 0, l = 0;
    for (const row of rows) { w += row.stats[round - 1].w; d += row.stats[round - 1].d; l += row.stats[round - 1].l; }
    const t = w + d + l;
    roundRates.push({ round, w, d, l, rate: t ? (w + d) / t : 0 });
  }

  const mark = (rate: number) => (rate < 0.5 ? '🔴' : rate < 0.75 ? '🟡' : '🟢');
  const fmtStat = (s: { w: number; d: number; l: number }) => {
    const t = s.w + s.d + s.l;
    const rate = t ? (s.w + s.d) / t : 0;
    return `${mark(rate)}${(rate * 100).toFixed(0)}%(${s.w}胜${s.d}平${s.l}负)`;
  };

  let md = '';
  md += `# ${src.name} ${sideLabel} 单分决策日志\n\n`;
  md += `- 生成时间：${new Date().toISOString()}\n`;
  md += `- 每对手每分 ${games} 局，胜率 = (胜+平)/总\n`;
  md += `- 🟢 ≥75% ｜ 🟡 50%~75% ｜ 🔴 <50%\n\n`;

  md += `## 逐分逐对手胜负矩阵\n\n`;
  md += `| 对手 | 标签 | R1 | R2 | R3 | R4 | R5 |\n`;
  md += `|------|------|----|----|----|----|----|\n`;
  for (const row of rows) {
    md += `| ${row.opp} | ${row.label} | ${row.stats.map(fmtStat).join(' | ')} |\n`;
  }

  md += `\n## 崩盘分分析\n\n`;
  const crashRounds = roundRates.filter(r => r.rate < 0.5);
  if (crashRounds.length === 0) {
    md += `- 无崩盘分（所有分总胜率 ≥50%），整局不败率由累计劣势导致。\n`;
  } else {
    for (const r of crashRounds) {
      md += `\n### 🔴 R${r.round}（总胜率 ${(r.rate * 100).toFixed(0)}%，${r.w}胜${r.d}平${r.l}负）\n\n`;
      // 该分输给谁
      const losers = rows.filter(row => {
        const s = row.stats[r.round - 1];
        const t = s.w + s.d + s.l;
        return t > 0 && (s.w + s.d) / t < 0.5;
      });
      if (losers.length === 0) {
        md += `- 无明显单一对手崩盘（普遍略输）。\n`;
      } else {
        for (const row of losers) {
          const s = row.stats[r.round - 1];
          md += `- **${row.opp}**（标签：\`${row.label}\`）：${fmtStat(s)}\n`;
        }
      }
    }
  }

  md += `\n## 手动决策提示\n\n`;
  md += `针对崩盘分 + 输的对手标签，可在对应分（R{n}）建分支，或调整该分落子位置。\n`;
  md += `建议分支条件 = 对手标签（如上表「标签」列），走法与主链不同的落子。\n`;

  if (outPath) {
    mkdirSync(dirname(resolve(outPath)), { recursive: true });
    writeFileSync(resolve(outPath), md, 'utf8');
    console.log(`[决策日志] 已写入 → ${outPath}`);
  }
  return md;
}

// CLI 单独运行
if (process.argv[1] && process.argv[1].endsWith('decision_log.ts')) {
  const name = process.argv[2] || '泉水剑';
  const aSide: 1 | 2 = Number(process.argv[3] || 2) === 1 ? 1 : 2;
  const games = Number(process.argv[4] || 4);
  const BundleAI = loadBundle();
  const src = FORMATION_LIBRARY.find(f => f.name === name);
  if (!src) { console.error(`阵型不存在: ${name}`); process.exit(1); }
  const outPath = `reports/decisions/${name}_${aSide === 1 ? '先手' : '后手'}.md`;
  const md = writeSingleRoundDecisionLog(BundleAI, src, aSide, games, outPath);
  console.log(md);
}
