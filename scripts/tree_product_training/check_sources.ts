// ============================================================
// scripts/tree_product_training/check_sources.ts
// T036 源文件只读检查脚本
// 验证：
//   - gift_jungle 恰好 8 怪，与预修复仅差 116[3,5] + R5 叶子放置
//   - 无 gift_jungle_v2
//   - 所有可执行源指纹计算正确
//   - T035 七怪历史证据存在且协议分离
// ============================================================

import '../../src/engine/env';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  loadProductSources,
  assertNoGiftJungleV2,
  computeSourceFingerprint,
  validateGiftJungleRepair,
} from '../../src/engine/tree/product_training';
import { formationToEvol, walkEvolNodes } from '../../src/engine/tree/evol_gene';

console.log('=== check_sources.ts — T036 Source Verification ===\n');

let passed = 0;
let failed = 0;

function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (e: any) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`ASSERT_FAIL: ${message}`);
}

// 1. 加载源（内置 gift_jungle 修复验证）
let sources: ReturnType<typeof loadProductSources>;
check('load sources with gift_jungle repair validation', () => {
  sources = loadProductSources();
});

// 2. gift_jungle 精确 8 怪
check('gift_jungle has exactly 8 monsters', () => {
  const raw: any[] = JSON.parse(readFileSync(resolve('tests/fixtures/tree/eleven_frozen_sources.json'), 'utf8'));
  const gj = raw.find((s: any) => s.id === 'gift_jungle');
  assert(gj.team.length === 8, `expected 8, got ${gj.team.length}`);
});

// 3. gift_jungle isLegacyBaseline = false
check('gift_jungle isLegacyBaseline is false', () => {
  const raw: any[] = JSON.parse(readFileSync(resolve('tests/fixtures/tree/eleven_frozen_sources.json'), 'utf8'));
  const gj = raw.find((s: any) => s.id === 'gift_jungle');
  assert(gj.isLegacyBaseline === false, `isLegacyBaseline=${gj.isLegacyBaseline}`);
});

// 4. gift_jungle 修复验证（只增 116[3,5] + R5 叶子）
check('gift_jungle repair is minimal (only 116[3,5] added)', () => {
  const raw: any[] = JSON.parse(readFileSync(resolve('tests/fixtures/tree/eleven_frozen_sources.json'), 'utf8'));
  const gj = raw.find((s: any) => s.id === 'gift_jungle');
  const evol = formationToEvol(gj);
  const result = validateGiftJungleRepair({
    evol,
    preRepairTeamSize: 7,
    preRepairFingerprint: '4c913570e3c9',
  });
  if (!result.valid) throw new Error(result.reasons.join('; '));
});

// 5. 每个 R5 叶子有 116
check('every R5 reachable leaf deploys monster 116 exactly once', () => {
  const raw: any[] = JSON.parse(readFileSync(resolve('tests/fixtures/tree/eleven_frozen_sources.json'), 'utf8'));
  const gj = raw.find((s: any) => s.id === 'gift_jungle');
  const evol = formationToEvol(gj);
  const leaves = walkEvolNodes(evol.root).filter(n => n.children.length === 0 && n.round === 5);
  assert(leaves.length > 0, 'no R5 leaves found');
  for (const leaf of leaves) {
    const count = leaf.placements.filter(p => p.monsterId === 116).length;
    assert(count === 1, `leaf ${leaf.id} has ${count} placements for monster 116`);
  }
});

// 6. 无 gift_jungle_v2
check('no gift_jungle_v2 source exists', () => {
  assertNoGiftJungleV2(sources!);
});

// 7. gift_jungle 有修复溯源
check('gift_jungle has sourceMetadata repair provenance', () => {
  const raw: any[] = JSON.parse(readFileSync(resolve('tests/fixtures/tree/eleven_frozen_sources.json'), 'utf8'));
  const gj = raw.find((s: any) => s.id === 'gift_jungle');
  assert(gj.sourceMetadata?.repairKind === 'add_eighth_monster_only', 'missing or wrong repairKind');
  assert(gj.sourceMetadata?.addedSlot?.monsterId === 116, 'addedSlot.monsterId should be 116');
});

// 8. T035 历史七怪证据存在且协议分离
check('T035 seven-monster evidence retained and protocol-separated', () => {
  const t035Dir = resolve('tests/fixtures/tree/experience_library/product_path_t035');
  assert(existsSync(t035Dir), 'T035 directory missing');
  const manifest = JSON.parse(readFileSync(resolve(t035Dir, 'manifest.json'), 'utf8'));
  assert(manifest.protocol === 'PRODUCT_PATH_FORMAL_SCREEN_T035_V1', `wrong protocol: ${manifest.protocol}`);
  assert(manifest.manifestHash === '7bb394b394eba26466ec6d7ee4ed3489cd2b8fc966edda97c81452f103c13d61', 'T035 manifest hash mismatch');
});

// 9. 所有可执行源指纹可计算
check('all executable sources have computable fingerprints', () => {
  if (!sources) throw new Error('sources not loaded');
  for (const src of sources.executable) {
    const fp = computeSourceFingerprint(src);
    assert(fp.length === 12, `fingerprint length ${fp.length} != 12 for ${(src as any).id}`);
  }
});

// 10. gift_jungle 在可执行源中
check('gift_jungle is in executable sources', () => {
  if (!sources) throw new Error('sources not loaded');
  const has = sources.executable.some((s: any) => s.id === 'gift_jungle');
  assert(has, 'gift_jungle not found in executable sources');
});

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exit(1);
}
console.log('✓ check_sources PASSED\n');
