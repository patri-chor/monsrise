// ============================================================
// 体系论本体回归测试：验证 7 套现阵型全部能被本体精确重建
//
// 检查项：
//   1. classifyDeck 归入的 (架构, 核心, 辅助) 与人类预期一致
//   2. validateDeck 全部通过（费用/槽位/徽章数/禁带/必带/辅助要求）
//   3. 每套卡组都是其模板的合法实例（卡组 ⊆ 必带 ∪ 角色池）
//   4. 模板枚举覆盖 7 套（含两个未用核心 115/120 的模板存在）
//
// 运行：npx vite-node --script src/engine/tree/verify_ontology.ts
// 退出码：0 = 全部通过；1 = 有失败（人类预期 vs 本体规则不一致时当场暴露）
// ============================================================

import { FORMATION_LIBRARY } from '../../ai/formation_library';
import {
  classifyDeck, validateDeck, enumerateTemplates, poolForTemplate,
  CORE_TABLE, BADGE_TEMPLATES, badgeLimit, type ArchKey, type AuxKey, type CoreKey,
} from './deck_ontology';

/** 人类预期表（来自体系论分析与 7 套实际卡组） */
const EXPECTED: Record<string, { arch: ArchKey; core: CoreKey; aux: AuxKey }> = {
  泉水剑: { arch: 'prayer', core: 'priest', aux: 'none' },
  全二永平: { arch: 'prayer', core: 'all2', aux: 'none' },
  坚果救星: { arch: 'halfrush', core: 'savior', aux: 'none' },
  肃清: { arch: 'halfrush', core: 'suqing', aux: 'dof' },
  全二冲: { arch: 'fullrush', core: 'all2', aux: 'none' },
  经典救星: { arch: 'fullrush', core: 'savior', aux: 'shield' },
  梯子塞雷: { arch: 'fullrush', core: 'seri', aux: 'shield' },
};

let failed = 0;

function check(ok: boolean, msg: string): void {
  if (ok) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.log(`  ✗ ${msg}`);
    failed++;
  }
}

function main(): void {
  console.log('=== 1. 卡组分类 + 合法性校验 ===');
  const templates = enumerateTemplates();
  console.log(`模板枚举：${templates.length} 个合法模板（3 架构 × 7 核心 × 4 辅助，含兼容过滤）\n`);

  for (const f of FORMATION_LIBRARY) {
    const team = f.team.filter(s => s.monsterId > 0);
    const exp = EXPECTED[f.name];
    console.log(`[${f.name}] (${team.map(s => `${s.monsterId}[${s.badgeIds.join(',')}]`).join(' ')})`);
    if (!exp) {
      console.log('  ✗ 无人类预期条目（需补充 EXPECTED）');
      failed++;
      continue;
    }
    const c = classifyDeck(team);
    check(c.arch === exp.arch && c.core === exp.core && c.aux === exp.aux,
      `分类 = ${c.arch}+${c.core}+${c.aux}（预期 ${exp.arch}+${exp.core}+${exp.aux}）`);
    const errs = validateDeck(team);
    if (errs.length === 0) {
      check(true, '合法性校验通过');
    } else {
      check(false, `合法性校验失败: ${errs.join('; ')}`);
    }
    // 模板实例检查：卡组 ⊆ 必带 ∪ 角色池
    const t = templates.find(t => t.arch === c.arch && t.core === c.core && t.aux === c.aux);
    if (!t) {
      check(false, '未找到对应模板');
    } else {
      const pool = new Set(poolForTemplate(t));
      const outside = team.filter(s => !t.mandatory.includes(s.monsterId) && !pool.has(s.monsterId)).map(s => s.monsterId);
      check(outside.length === 0,
        `模板实例合法（必带[${t.mandatory.join(',')}]，池外怪: ${outside.length ? outside.join(',') : '无'}）`);
    }
    console.log('');
  }

  console.log('=== 2. 未用核心模板存在性 ===');
  const goldenTpl = templates.filter(t => t.core === 'golden').length;
  const diggerTpl = templates.filter(t => t.core === 'digger').length;
  check(goldenTpl > 0, `金猴120 模板 ${goldenTpl} 个（${templates.filter(t => t.core === 'golden').map(t => `${t.arch}+${t.aux}`).join(', ') || '无'}）`);
  check(diggerTpl > 0, `铲土115 模板 ${diggerTpl} 个（${templates.filter(t => t.core === 'digger').map(t => `${t.arch}+${t.aux}`).join(', ') || '无'}）`);

  console.log('\n=== 3. 徽章模板覆盖率（对照 7 套真实卡组徽章） ===');
  for (const f of FORMATION_LIBRARY) {
    let allOk = true;
    const misses: string[] = [];
    for (const s of f.team.filter(s => s.monsterId > 0)) {
      const tpls = BADGE_TEMPLATES[s.monsterId] ?? [];
      const actual = new Set(s.badgeIds);
      const covered = tpls.some(t => {
        const tSet = new Set(t.slice(0, badgeLimit(s.monsterId)));
        return tSet.size === actual.size && [...tSet].every(b => actual.has(b));
      });
      if (!covered) {
        allOk = false;
        misses.push(`${s.monsterId}[${s.badgeIds.join(',')}]（模板: ${tpls.map(t => `[${t.join(',')}]`).join(' / ') || '无'}）`);
      }
    }
    if (allOk) {
      check(true, `${f.name} 徽章全部被模板覆盖`);
    } else {
      check(false, `${f.name} 徽章未被覆盖: ${misses.join('; ')}`);
    }
  }

  console.log('\n=== 4. 模板清单（架构+核心+辅助 → 必带怪） ===');
  for (const t of templates) {
    const coreName = CORE_TABLE[t.core].name;
    console.log(`  ${t.arch}+${coreName}+${t.aux} 必带[${t.mandatory.join(',')}] 剩${t.slotsLeft}槽/${t.budgetLeft}费`);
  }

  console.log(`\n结果：${failed === 0 ? '全部通过 ✅' : `${failed} 项失败 ❌`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
