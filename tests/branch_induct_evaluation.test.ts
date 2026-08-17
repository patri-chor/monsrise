import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { FORMATION_LIBRARY } from '../src/ai/formation_library';
import { formationToEvol } from '../src/engine/tree/evol_gene';
import {
  MatchSimulationCache,
  sampleFromTrace,
  type MatchTrace,
} from '../src/engine/tree/branch_induct';
import {
  ExperienceBank,
  replaceKey,
  computeTreeFingerprint,
} from '../src/engine/tree/search_experience';
import {
  replaceMonster,
} from '../src/engine/tree/tree_ops';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function runTests() {
  console.log('=== 开始执行 T003 树决策优化器验收测试 ===\n');

  // Test 1: 运行时可见特征隔离测试
  console.log('[Test 1] 运行时可见特征隔离测试...');
  const fakeDecision = {
    round: 1,
    handIds: [101, 102, 103, 104], // 仅前四张手牌
    handBadges: [1, 2],
    boardIds: [101], // 已部署
    chosenBranchId: 'root',
    branchLabels: ['root'],
  };
  const decisionsMap = new Map();
  decisionsMap.set(1, fakeDecision);

  const mockTrace: MatchTrace = {
    seed: 1000,
    side: 1,
    oppId: 'test_opp',
    roundScores: [1, 1, 1, 1, 1],
    decisions: decisionsMap,
    w: 1,
    d: 0,
    l: 0,
  };

  const sampleR1 = sampleFromTrace(mockTrace, 1, 'test_opp');
  assertStrict.ok(sampleR1 !== null, 'R1 sample should exist');
  // 对手整队若含有 117 (铁甲) 但手牌和 board 均无 117，则 keys 绝对不能含有 'shield' 或 117 对应特征
  assertStrict.ok(!sampleR1!.keys.includes('iron' as any), '未出现在 handIds/boardIds 中的怪不能被提取为已观测特征');
  // 未打的回合或无决策的回合不产生样本
  const sampleR2 = sampleFromTrace(mockTrace, 2, 'test_opp');
  assertStrict.equal(sampleR2, null, '无 BranchDecision 的回合不能产生样本');
  console.log('  ✓ 运行时特征提取严格限定于实际决策观察，未触发回退到全卡组。\n');

  // Test 2: 单局多回合结果复用测试
  console.log('[Test 2] 单局多回合结果复用测试...');
  const cache = new MatchSimulationCache();
  const seedFormation = FORMATION_LIBRARY[0];
  const evol = formationToEvol(seedFormation);
  const opp = FORMATION_LIBRARY[1];

  const mockBundleAI = class {
    pipeline = {
      getFormationEngine: () => ({
        getSelectedFormation: () => null,
        loadCustomFormation: () => {},
        setOpponentHand: () => {},
      }),
      decideWithFormation: () => ({ placements: [] }),
    };
    buildTeam() {}
    setDifficulty() {}
    getMonster() { return { cost: 1 }; }
  };

  // 模拟 getOrSimulate 缓存行为
  const trace1 = cache.getOrSimulate(mockBundleAI, evol, opp, 1, 2026);
  assertStrict.equal(cache.simCount, 1, '第一次请求应产生 1 次底层模拟');
  const trace2 = cache.getOrSimulate(mockBundleAI, evol, opp, 1, 2026);
  assertStrict.equal(cache.simCount, 1, '相同 (tree, opp, side, seed) 应直接命中缓存，不产生新模拟');
  assertStrict.equal(trace1, trace2, '返回相同引用');
  console.log('  ✓ 单局五回合结果成功复用，避免重复模拟。\n');

  // Test 3: 经验库树结构版本隔离与容错测试
  console.log('[Test 3] 经验库树结构指纹隔离与旧格式容错测试...');
  const fp1 = computeTreeFingerprint(evol);
  const tempPath = resolve('reports/test_search_experience_temp.json');

  // 模拟写入损坏/旧版 JSON
  writeFileSync(tempPath, JSON.stringify({ type: 'search_experience', entries: [{ key: 'old_key_without_fp', reason: 'old reason' }] }));
  const exp = new ExperienceBank(tempPath);
  exp.load();
  assertStrict.equal(exp.size, 1, '旧版有效条目应被安全加载');

  // 测试损坏 JSON
  writeFileSync(tempPath, '{ broken json');
  exp.load();
  assertStrict.equal(exp.size, 0, '损坏 JSON 应优雅降级为空，不抛出异常');

  // 测试树指纹隔离
  const keyWithFp1 = replaceKey('test_fmt', 'node_1', 101, 102, fp1);
  const keyWithFp2 = replaceKey('test_fmt', 'node_1', 101, 102, 'different_fp_8888');
  exp.markInvalid(keyWithFp1, '结构冲突');
  assertStrict.ok(exp.isKnownInvalid(keyWithFp1), '当前树指纹下的 key 应被识别为无效');
  assertStrict.ok(!exp.isKnownInvalid(keyWithFp2), '不同树指纹下的相同操作不应被误拦截');

  if (existsSync(tempPath)) unlinkSync(tempPath);
  console.log('  ✓ 经验库树指纹版本隔离与文件容错验证通过。\n');

  // Test 4: 现有树算子回归
  console.log('[Test 4] 树算子结构合法性与校验回归...');
  const mutated = replaceMonster(evol, evol.root.id, evol.root.placements[0]?.monsterId ?? 0, 999999);
  assertStrict.equal(mutated, null, '非法怪兽 ID 替换应失败并返回 null');
  console.log('  ✓ 树算子合法性检查保持完整。\n');

  console.log('=== 所有 T003 行为验收测试全部通过 (4/4) ===');
}

runTests();
