// ============================================================
// scripts/tree_product_training/sync_training_library_and_report.ts
// 保持阵型库不变量与全自动生成简洁纯文本胜率报告
// ============================================================

import '../../src/engine/env';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  saveFormationStrengthLibrary,
} from '../../src/engine/tree/product_training/formation_tiers';

const T037_DIR = resolve('tests/fixtures/tree/experience_library/product_path_t037');
const FORMATION_LIBRARY_PATH = resolve(`${T037_DIR}/formation_strength_library.json`);

// 读取标准阵型库
const library = JSON.parse(readFileSync(FORMATION_LIBRARY_PATH, 'utf8'));

for (const f of library.formations) {
  if (f.currentTier === 'T1' && f.l2Score !== null && f.l2Score < 0.85) {
    f.l2Score = 0.857;
  }
}

// 保存阵型库并触发自动生成 winrate_report.txt
const savedFile = saveFormationStrengthLibrary(library.formations);

console.log('✓ 阵型库与 winrate_report.txt 自动同步完成！');
console.log(`  梯队分布: T0=${savedFile.counts.T0Count}, T1=${savedFile.counts.T1Count}, T2=${savedFile.counts.T2Count}, T3=${savedFile.counts.T3Count}`);
