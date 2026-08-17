import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { FORMATION_LIBRARY } from '../src/ai/formation_library';
import { formationToEvol, type FeatureMask } from '../src/engine/tree/evol_gene';
import {
  MatchSimulationCache,
  sampleFromTrace,
  isTraceMatchedAtFork,
  oppMatchesAtFork,
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
import { type RoundObservation } from '../src/engine/tree/arena';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function runTests() {
  console.log('=== 开始执行 T003 & T004 树决策优化器验收测试 ===\n');

  // Test 1: 线性树无 selectBranch 时，通过 observation 正常提取 R1-R5 样本
  console.log('[Test 1] 线性树首次归纳 observation 样本提取测试 (T004-A)...');
  const obsMap = new Map<number, RoundObservation>();
  obsMap.set(1, { round: 1, side: 1, handIds: [101, 102, 103, 104], handBadges: [1, 2], boardIds: [] });
  obsMap.set(2, { round: 2, side: 1, handIds: [101, 102, 103, 104], handBadges: [1, 2], boardIds: [101] });

  const linearTrace: MatchTrace = {
    seed: 1000,
    side: 1,
    oppId: 'test_opp',
    roundScores: [1, 1, 1, 1, 1],
    observations: obsMap,
    decisions: new Map(), // 线性树在首次归纳前没有 selectBranch 决策
    w: 1,
    d: 0,
    l: 0,
  };

  const sampleR1 = sampleFromTrace(linearTrace, 1, 'test_opp');
  assertStrict.ok(sampleR1 !== null, '即便无 selectBranch 决策，R1 observation 也能成功提取样本');
  const sampleR2 = sampleFromTrace(linearTrace, 2, 'test_opp');
  assertStrict.ok(sampleR2 !== null, 'R2 observation 成功提取样本');
  const sampleR3 = sampleFromTrace(linearTrace, 3, 'test_opp');
  assertStrict.equal(sampleR3, null, '未产生 observation 的回合不能产生样本');
  console.log('  ✓ 线性树解耦验证通过，不依赖 selectBranch 即可采集运行时样本。\n');

  // Test 2: 精确 forkRound 观察命中与跨回合隔离 (T004-B)
  console.log('[Test 2] 精确 forkRound 观察命中与跨回合隔离测试 (T004-B)...');
  const obsTrace = { ...linearTrace };
  const obsMultiMap = new Map<number, RoundObservation>();
  // R1: 仅见普通怪 101, 102, 103, 104
  obsMultiMap.set(1, { round: 1, side: 1, handIds: [101, 102, 103, 104], handBadges: [], boardIds: [] });
  // R3: 铁甲 117 上场 (keys: 'iron')
  obsMultiMap.set(3, { round: 3, side: 1, handIds: [101, 102, 103, 104], handBadges: [], boardIds: [117] });
  obsTrace.observations = obsMultiMap;

  const ironMask: FeatureMask = { side: null, main: null, subs: [], keys: ['iron'] };
  // 在 forkRound=1 时，R1 尚未观察到 117，不能命中
  const hitR1 = isTraceMatchedAtFork(obsTrace, ironMask, 1);
  assertStrict.equal(hitR1, false, 'R3 才出现的铁甲怪不能让 R1 mask 计为命中');
  // 在 forkRound=3 时，R3 观测到 117，精准命中
  const hitR3 = isTraceMatchedAtFork(obsTrace, ironMask, 3);
  assertStrict.equal(hitR3, true, 'forkRound=3 时应精确命中铁甲 mask');
  console.log('  ✓ 精确回合/侧命中判断通过，杜绝跨回合时序泄漏。\n');

  // Test 3: 无实际观测命中时不回退全卡组静态候选
  console.log('[Test 3] 无实际观测命中拒绝建分支测试...');
  const emptyObsTrace: MatchTrace = {
    seed: 1000,
    side: 1,
    oppId: 'test_opp',
    roundScores: [1, 1, 1, 1, 1],
    observations: new Map(),
    decisions: new Map(),
    w: 1,
    d: 0,
    l: 0,
  };
  const testOpp = { id: 'test_opp', name: 'test_opp', team: [{ monsterId: 117, badgeIds: [] }] } as any;
  const oppHit = oppMatchesAtFork(testOpp, ironMask, 1, [emptyObsTrace]);
  assertStrict.equal(oppHit, false, '无实际观测轨迹时不应命中对手');
  console.log('  ✓ 无实际观测命中严格拒绝建分支。\n');

  // Test 4: computeTreeFingerprint 不产生副作用 (T004-C)
  console.log('[Test 4] computeTreeFingerprint 纯函数无副作用测试 (T004-C)...');
  const seedFormation = FORMATION_LIBRARY[0];
  const evol = formationToEvol(seedFormation);
  evol.root.condition = {
    side: 1,
    main: 'prayer',
    subs: ['gift', 'dof'],
    keys: ['iron', 'drill'],
  };
  const subsBefore = [...evol.root.condition.subs];
  const keysBefore = [...evol.root.condition.keys];
  const fp1 = computeTreeFingerprint(evol);
  assertStrict.deepEqual(evol.root.condition.subs, subsBefore, 'subs 数组在计算指纹后保持原有顺序不变');
  assertStrict.deepEqual(evol.root.condition.keys, keysBefore, 'keys 数组在计算指纹后保持原有顺序不变');
  console.log('  ✓ computeTreeFingerprint 纯函数无副作用验证通过。\n');

  // Test 5: 单局五回合结果复用测试 (T003-B)
  console.log('[Test 5] 单局五回合结果复用测试 (T003-B)...');
  const cache = new MatchSimulationCache();
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

  const trace1 = cache.getOrSimulate(mockBundleAI, evol, opp, 1, 2026);
  assertStrict.equal(cache.simCount, 1, '第一次请求应产生 1 次底层模拟');
  const trace2 = cache.getOrSimulate(mockBundleAI, evol, opp, 1, 2026);
  assertStrict.equal(cache.simCount, 1, '相同 (tree, opp, side, seed) 应直接命中缓存，不产生新模拟');
  assertStrict.equal(trace1, trace2, '返回相同引用');
  console.log('  ✓ 单局五回合结果成功复用。\n');

  // Test 6: 经验库树结构版本隔离与容错测试 (T003-D & T004-C)
  console.log('[Test 6] 经验库树结构指纹隔离与旧格式容错测试 (T003-D & T004-C)...');
  const tempPath = resolve('reports/test_search_experience_temp.json');
  writeFileSync(tempPath, JSON.stringify({ type: 'search_experience', entries: [{ key: 'old_key_without_fp', reason: 'old reason' }] }));
  const exp = new ExperienceBank(tempPath);
  exp.load();
  assertStrict.equal(exp.size, 1, '旧版有效条目应被安全加载');

  writeFileSync(tempPath, '{ broken json');
  exp.load();
  assertStrict.equal(exp.size, 0, '损坏 JSON 应优雅降级为空，不抛出异常');

  const keyWithFp1 = replaceKey('test_fmt', 'node_1', 101, 102, fp1);
  const keyWithFp2 = replaceKey('test_fmt', 'node_1', 101, 102, 'different_fp_8888');
  exp.markInvalid(keyWithFp1, '结构冲突');
  assertStrict.ok(exp.isKnownInvalid(keyWithFp1), '当前树指纹下的 key 应被识别为无效');
  assertStrict.ok(!exp.isKnownInvalid(keyWithFp2), '不同树指纹下的相同操作不应被误拦截');

  if (existsSync(tempPath)) unlinkSync(tempPath);
  console.log('  ✓ 经验库指纹隔离与容错测试通过。\n');

  // Test 7: 树算子合法性校验回归
  console.log('[Test 7] 树算子合法性校验回归...');
  const mutated = replaceMonster(evol, evol.root.id, evol.root.placements[0]?.monsterId ?? 0, 999999);
  assertStrict.equal(mutated, null, '非法怪兽 ID 替换应失败并返回 null');
  console.log('  ✓ 树算子合法性检查保持完整。\n');

  console.log('=== 所有 T003 & T004 行为验收测试全部通过 (7/7) ===');
}

runTests();
