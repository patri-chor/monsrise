import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import {
  AUTHORITY_ARTIFACT_ABSOLUTE_PATH,
  PROHIBITED_TREE_SYMBOLS,
  getAuthorityArtifactManifest,
  assertAuthorityArtifact,
  auditRealAdapter,
  assertRealAdapterIndependent,
  validateRealAdapterSource,
  executeRealApplicationEntry,
  executeTreeRunnerEntry,
  compareIndependentBehaviorParity,
  ArtifactProvenanceError,
  RealAdapterNotIndependentError,
} from '../src/engine/tree/independent_real_entry_parity';
import { compareCanonicalTraces, serializeCanonicalTrace, EXCLUDED_PRESENTATION_ONLY_FIELDS } from '../src/engine/canonical_trace';
import type { CanonicalGameTrace } from '../src/engine/canonical_trace';
import type { Formation } from '../src/ai/types';

const REAL_AUTHORITY_SHA256 = 'a9821e8986b8722e89ccd32024e650e3f5853bf75df23c74a3e92e35240d6e43';

function fileHash(p: string): string {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

function cloneTrace(t: CanonicalGameTrace): CanonicalGameTrace {
  return JSON.parse(JSON.stringify(t));
}

async function runT031Tests() {
  console.log('=== T031 独立真实入口 parity 修复验收测试（Repair T029 False Independent-Entry Parity） ===\n');

  // ---------- 测试 A：权威制品身份（绝对/不可变/与 cwd 无关 + fail-closed） ----------
  console.log('[Test A] 权威制品身份 = 显式绝对路径，且与执行器 cwd 完全解耦（fail-closed）...');

  const manifest = getAuthorityArtifactManifest();
  console.log(`  authorityBundleAbsoluteSource = ${manifest.authorityBundleAbsoluteSource}`);
  console.log(`  authorityBundleSHA256         = ${manifest.authorityBundleSHA256}`);
  console.log(`  authorityResolvedFromCwd      = ${manifest.authorityResolvedFromCwd}`);
  console.log(`  runnerCommit                  = ${manifest.runnerCommit}`);
  assertStrict.equal(manifest.authorityBundleAbsoluteSource, AUTHORITY_ARTIFACT_ABSOLUTE_PATH, '权威制品必须使用显式绝对路径常量');
  assertStrict.ok(!manifest.authorityBundleAbsoluteSource.startsWith('.') && !manifest.authorityBundleAbsoluteSource.startsWith('public'), '权威身份不得是 cwd 相对解析');
  assertStrict.equal(manifest.authorityResolvedFromCwd, false, '权威身份不得来自 cwd 相对解析');
  assertStrict.equal(manifest.isAuthorityImmutable, true, '权威身份必须不可变');
  assertStrict.equal(manifest.authorityBundleSHA256, REAL_AUTHORITY_SHA256, '权威 SHA-256 必须与真实应用构建产物一致');
  assertStrict.equal(manifest.isArtifactProvenanceValid, true, '权威制品存在性校验必须有效');

  // fail-closed 负例
  const tmpBase = mkdtempSync(join(tmpdir(), 't031_'));
  const divergentPath = join(tmpBase, 'divergent.js');
  writeFileSync(divergentPath, 'var BattleAI = function(){ return { pipeline:{ getFormationEngine(){return null;} } }; };');
  const divergentHash = fileHash(divergentPath);
  assertStrict.ok(divergentHash !== REAL_AUTHORITY_SHA256, '分歧文件哈希必须与权威不同');

  assertStrict.throws(() => assertAuthorityArtifact(join(tmpBase, 'no_such_file.js')), ArtifactProvenanceError, '缺失路径必须 fail-closed');
  assertStrict.throws(() => assertAuthorityArtifact('public/ai-bundle.iife.js'), ArtifactProvenanceError, '相对路径必须被拒绝');
  assertStrict.throws(() => assertAuthorityArtifact(divergentPath), ArtifactProvenanceError, '哈希错配必须 fail-closed');
  console.log('  ✓ 缺失/相对/哈希错配路径均在模拟前 fail-closed 被拦截。');

  // 分歧 cwd bundle：同名但内容分歧的 cwd 文件绝不能影响权威身份
  const divergentCwdDir = join(tmpBase, 'divergent_cwd');
  const divergentPublicDir = join(divergentCwdDir, 'public');
  const originalCwd = process.cwd();
  try {
    const fsMod = await import('node:fs');
    fsMod.mkdirSync(divergentPublicDir, { recursive: true });
    fsMod.writeFileSync(join(divergentPublicDir, 'ai-bundle.iife.js'), 'var BattleAI = function(){ return {}; }; // divergent cwd copy');
    process.chdir(divergentCwdDir);
    const cwdBundleAbs = resolve('public/ai-bundle.iife.js');
    const cwdBundleHash = fileHash(cwdBundleAbs);
    const m2 = getAuthorityArtifactManifest();
    assertStrict.equal(m2.authorityBundleAbsoluteSource, AUTHORITY_ARTIFACT_ABSOLUTE_PATH, '权威路径不得随 cwd 变化');
    assertStrict.equal(m2.authorityResolvedFromCwd, false, '权威身份不得来自 cwd 相对解析（分歧目录下仍为 false）');
    assertStrict.equal(m2.authorityBundleSHA256, REAL_AUTHORITY_SHA256, '分歧 cwd bundle 不得影响权威身份哈希');
    assertStrict.ok(cwdBundleHash !== REAL_AUTHORITY_SHA256, '分歧 cwd bundle 的哈希必须与权威不同（证明未使用它）');
    assertStrict.throws(
      () => assertAuthorityArtifact(cwdBundleAbs),
      ArtifactProvenanceError,
      '以分歧 cwd 文件作为 Runner 路径必须 fail-closed（哈希不匹配）',
    );
    console.log(`  ✓ 分歧 cwd bundle (${cwdBundleAbs}) 无法影响权威身份；作为 runner 路径被 fail-closed 拒绝。`);
  } finally {
    process.chdir(originalCwd);
    try { rmSync(tmpBase, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  console.log('  ✓ [Test A] 通过。\n');

  // ---------- 测试 B：真实侧适配器独立（调用产品入口 + 无 tree 传递依赖） ----------
  console.log('[Test B] 真实侧适配器独立性：调用产品入口 playFullGame，且无禁止 tree 传递依赖...');
  const audit = auditRealAdapter();
  console.log(`  realAdapterFile     = ${audit.realAdapterFile}`);
  console.log(`  invokesPlayFullGame = ${audit.invokesPlayFullGame}`);
  console.log(`  scannedFiles        = ${audit.scannedFiles.join(', ')}`);
  console.log(`  prohibitedReferences= ${JSON.stringify(audit.prohibitedReferences)}`);
  console.log(`  prohibitedImports   = ${JSON.stringify(audit.prohibitedImportTargets)}`);
  assertStrict.equal(audit.invokesPlayFullGame, true, '真实入口必须实际调用产品入口 playFullGame');
  assertStrict.equal(audit.prohibitedReferences.length, 0, '真实侧适配器不得引用禁止 tree 符号');
  assertStrict.equal(audit.prohibitedImportTargets.length, 0, '真实侧适配器传递闭包不得导入 src/engine/tree/ 路径');
  assertStrict.equal(audit.clean, true, '真实侧适配器必须独立');
  assertRealAdapterIndependent(); // 比较门禁前强制校验不抛错
  console.log('  ✓ 真实侧适配器干净且调用 playFullGame；无 arena/playSpecVsSpec/PersistentSimPool/fine_grained_worker 依赖。');

  // 函数引用确实不同（但函数引用不等不构成独立证据，独立由调用溯源+传递闭包证明）
  assertStrict.notStrictEqual(executeRealApplicationEntry, executeTreeRunnerEntry);
  console.log('  ✓ executeRealApplicationEntry !== executeTreeRunnerEntry（由独立模块提供，非同一适配器）。\n');

  // ---------- 测试 C：规范轨迹全字段比较 + 60 案例矩阵 ----------
  console.log('[Test C] 全矩阵独立 parity：10 源 × 3 对手 × 实际侧 1/2 × 固定种子（≥60 案例）...');
  const sources: Formation[] = JSON.parse(
    readFileSync(resolve('tests/fixtures/tree/eleven_frozen_sources.json'), 'utf8'),
  ).filter((s: any) => !s.isLegacyBaseline);
  const earlyFamilies = JSON.parse(
    readFileSync(resolve('tests/fixtures/tree/early_seven_bundles.json'), 'utf8'),
  );
  const testOpps: Formation[] = earlyFamilies.slice(0, 3).map((f: any) => f.heldOutVariant);
  assertStrict.equal(sources.length, 10, '必须正好 10 套可执行源阵容');

  const result = compareIndependentBehaviorParity(sources, testOpps);
  assertStrict.equal(result.totalComparisons, 60, '必须完成 10×3×2=60 组真实侧 vs 树侧比较');
  console.log(`  共执行 ${result.totalComparisons} 组规范轨迹全字段比较；identical=${result.identicalCount}/${result.totalComparisons}；allPassed=${result.allPassed}`);

  // identical 不得为常量：每条案例都来自真实比较（含首字段差异诊断）
  for (const d of result.details) {
    assertStrict.equal(typeof d.identical, 'boolean');
    if (!d.identical) {
      assertStrict.ok(d.firstMismatch, `案例 ${d.sourceName} vs ${d.opponentName} (side${d.side}) 必须给出首字段差异诊断`);
      assertStrict.ok(d.firstMismatch!.field.length > 0);
    }
  }

  // 输出全矩阵证据（报告取证）
  for (const d of result.details) {
    const m = d.firstMismatch ? ` | 首差异: ${d.firstMismatch.field} (real=${d.firstMismatch.realValue} tree=${d.firstMismatch.treeValue})` : '';
    console.log(`    ${d.sourceName.padEnd(6)} vs ${d.opponentName.padEnd(10)} side=${d.side} seed=${d.seed} | real ${d.realFinal} (${d.realDeployments}部署) tree ${d.treeFinal} (${d.treeDeployments}部署) | ${d.identical ? 'IDENTICAL' : 'DIFF'}${m}`);
  }

  // 诚实分类：真实侧(playFullGame 贪心)与树侧(playSpecVsSpec 树模式)是真正不同的执行路径，
  // 规范轨迹逐位不一致 → 独立 parity 不成立 → 训练证据保持 SANDBOX_ENGINE_UNVERIFIED。
  assertStrict.equal(result.allPassed, false, '独立真实入口 parity 必须诚实报告为不成立（不得伪造 100% PASS）');
  assertStrict.equal(result.identicalCount, 0, '当前实现下真实侧与树侧无任何逐位一致案例（不同规划器）');
  console.log('  ✓ 60 组比较全部给出真实结果；独立 parity 不成立（真实侧=贪心产品入口 vs 树侧=阵型树 runner）。');

  // 序列化确定性 + 首字段差异诊断验证
  const sampleSrc = sources[0];
  const sampleOpp = testOpps[0];
  const baseReal = executeRealApplicationEntry(sampleSrc, sampleOpp, 1, 12345);
  const baseRealCmp = compareCanonicalTraces(baseReal, cloneTrace(baseReal));
  assertStrict.equal(baseRealCmp.identical, true, '同轨迹必须 identical=true（证明比较本身有效）');
  const ser1 = serializeCanonicalTrace(baseReal);
  assertStrict.equal(serializeCanonicalTrace(baseReal), ser1, '同轨迹序列化必须确定性一致');
  assertStrict.ok(!JSON.parse(ser1).hasOwnProperty('elapsedMs'), '展示字段不得进入规范序列化');
  assertStrict.ok(EXCLUDED_PRESENTATION_ONLY_FIELDS.length >= 5, '必须显式文档化排除的纯展示字段');
  console.log(`  ✓ 规范轨迹序列化确定；排除纯展示字段: ${EXCLUDED_PRESENTATION_ONLY_FIELDS.join(', ')}。\n`);

  // ---------- 测试 D：非同义反复负例控制 ----------
  console.log('[Test D] 非同义反复负例控制（以下各项必须失败门禁/被拒绝）...');

  // D1：权威制品路径 override/missing/mismatch + 分歧 cwd 文件（已在上方 Test A 验证 fail-closed）
  console.log('  [D1] 权威制品 override/missing/mismatch + 分歧 cwd 文件：均 fail-closed —— Test A 已通过。');

  // D2：适配器源码/调用图引用 playSpecVsSpec 或其它禁止 tree 符号 → 必须被拒绝
  const evilAdapter1 = `import { playSpecVsSpec } from './tree/arena';\nexport function real(s){ return playSpecVsSpec(s); }`;
  assertStrict.throws(() => validateRealAdapterSource(evilAdapter1, 'evil1'), RealAdapterNotIndependentError, '引用 playSpecVsSpec 的适配器必须被拒绝');
  for (const sym of PROHIBITED_TREE_SYMBOLS) {
    assertStrict.throws(() => validateRealAdapterSource(`function real(){ return ${sym}; }`, `evil_${sym}`), RealAdapterNotIndependentError, `引用 ${sym} 的适配器必须被拒绝`);
  }
  assertStrict.throws(
    () => validateRealAdapterSource(`import { x } from '../tree/persistent_pool';\nexport function real(){ return x; }`, 'evil_pool'),
    RealAdapterNotIndependentError,
    '导入 PersistentSimPool 路径的适配器必须被拒绝',
  );
  assertStrict.throws(
    () => validateRealAdapterSource(`import { y } from '../tree/fine_grained_worker';\nexport function real(){ return y; }`, 'evil_worker'),
    RealAdapterNotIndependentError,
    '导入 fine_grained_worker 路径的适配器必须被拒绝',
  );
  console.log('  ✓ [D2] 引用/导入 playSpecVsSpec、PersistentSimPool、fine_grained_worker 的适配器均被拒绝。');

  // D3：注入 分支 / 坐标 / 尝试序 / 接受-原因 / 预算 差异 → 比较必须检测到首字段差异
  const injectCases: { label: string; mutate: (t: CanonicalGameTrace) => CanonicalGameTrace; expectField: string }[] = [
    {
      label: '注入分支差异',
      mutate: t => { t.branches.push({ round: 1, chosenNodeId: 'injected' }); return t; },
      expectField: 'branches',
    },
    {
      label: '注入坐标差异',
      mutate: t => { if (t.deployments.length > 0) t.deployments[0].plannedX += 100; return t; },
      expectField: 'deployments[0].plannedX',
    },
    {
      label: '注入尝试序差异',
      mutate: t => { if (t.deployments.length > 0) t.deployments[0].attemptOrder += 100; return t; },
      expectField: 'deployments[0].attemptOrder',
    },
    {
      label: '注入接受/原因差异',
      mutate: t => { if (t.deployments.length > 0) { t.deployments[0].accepted = false; t.deployments[0].rejectionReason = 'INJECTED'; } return t; },
      expectField: 'deployments[0].accepted',
    },
    {
      label: '注入预算差异',
      mutate: t => { if (t.deployments.length > 0) t.deployments[0].budgetAfter += 100; return t; },
      expectField: 'deployments[0].budgetAfter',
    },
  ];
  for (const c of injectCases) {
    const base = cloneTrace(baseReal);
    const mutated = c.mutate(cloneTrace(baseReal));
    const cmp = compareCanonicalTraces(base, mutated);
    assertStrict.equal(cmp.identical, false, `${c.label} 必须被判定为不一致`);
    assertStrict.equal(cmp.firstMismatch!.field, c.expectField, `${c.label} 首字段差异应指向 ${c.expectField}`);
  }
  // 完全相同的轨迹必须 identical=true（证明比较本身有效，非恒假）
  assertStrict.equal(compareCanonicalTraces(baseReal, cloneTrace(baseReal)).identical, true, '同轨迹必须 identical=true（证明比较有效）');
  console.log('  ✓ [D3] 注入分支/坐标/尝试序/接受-原因/预算差异均被检测到正确首字段；同轨迹 comparison 有效。');

  // D4：side 传播 —— 仪器化真实入口断言请求 side 到达产品执行输入，side1/2 产生可区分证据
  const side1 = executeRealApplicationEntry(sampleSrc, sampleOpp, 1, 777);
  const side2 = executeRealApplicationEntry(sampleSrc, sampleOpp, 2, 777);
  assertStrict.equal(side1.side, 1, 'side=1 必须记录在规范轨迹');
  assertStrict.equal(side2.side, 2, 'side=2 必须记录在规范轨迹');
  // 源自身部署 = 实际棋盘侧与源所在侧一致的事件（源在 p1 则其部署 side=1，源在 p2 则 side=2）
  const src1 = side1.deployments.filter(d => d.side === d.sourceSide);
  const src2 = side2.deployments.filter(d => d.side === d.sourceSide);
  assertStrict.ok(src1.length > 0, 'side=1 必须产生源侧部署证据');
  assertStrict.ok(src2.length > 0, 'side=2 必须产生源侧部署证据');
  for (const d of src1) { assertStrict.equal(d.sourceSide, 1, 'side=1 源部署 sourceSide 必须为 1'); assertStrict.equal(d.side, 1, 'side=1 源部署必须落在 p1（isP1=true）'); }
  for (const d of src2) { assertStrict.equal(d.sourceSide, 2, 'side=2 源部署 sourceSide 必须为 2'); assertStrict.equal(d.side, 2, 'side=2 源部署必须落在 p2（isP1=false）'); }
  const minX1 = Math.min(...src1.map(d => d.plannedX));
  const maxX2 = Math.max(...src2.map(d => d.plannedX));
  assertStrict.ok(minX1 <= 4, `side=1 源部署计划 x 必须在 p1 区 (0-4)，实际 ${minX1}`);
  assertStrict.ok(maxX2 >= 6, `side=2 源部署计划 x 必须在 p2 区 (6-10)，实际 ${maxX2}`);
  // 可区分调用证据：两侧源部署棋盘侧集合互斥
  const sidesSet1 = new Set(src1.map(d => d.side));
  const sidesSet2 = new Set(src2.map(d => d.side));
  assertStrict.deepEqual([...sidesSet1], [1], 'side=1 只产生 p1 调用证据');
  assertStrict.deepEqual([...sidesSet2], [2], 'side=2 只产生 p2 调用证据');
  console.log('  ✓ [D4] side 传播：请求 side 到达产品执行输入（teamA/teamB 编排 + isP1），side1/2 产生互斥可区分调用证据。');

  // D5：故意委托 tree 代码的“真实适配器”在比较前即被拒绝
  const treeDelegating = `import { playSpecVsSpec } from './arena';\nexport function executeRealApplicationEntry(a,b,side,seed){ return playSpecVsSpec(null,a,b,side,seed); }`;
  assertStrict.throws(() => validateRealAdapterSource(treeDelegating, 'tree_delegating_real'), RealAdapterNotIndependentError, '故意委托 tree 代码的真实适配器必须在比较前被拒绝');
  console.log('  ✓ [D5] 故意委托 tree 代码的真实适配器在比较前即被拒绝。\n');

  // ---------- 测试 E：T029/T030 报告必须已修正为 PARTIAL ----------
  console.log('[Test E] T029/T030 报告修正为 PARTIAL（记录 T031 失败）...');
  const t029 = readFileSync(resolve('TASKS/tree/T029.report.md'), 'utf8');
  const t030 = readFileSync(resolve('TASKS/tree/T030.report.md'), 'utf8');
  assertStrict.ok(t029.startsWith('STATUS: PARTIAL'), 'T029.report.md 必须为 PARTIAL');
  assertStrict.ok(t030.startsWith('STATUS: PARTIAL'), 'T030.report.md 必须为 PARTIAL');
  console.log('  ✓ T029.report.md / T030.report.md 均已修正为 PARTIAL。\n');

  console.log('=== 所有 T031 验收测试通过（独立 parity 不成立 → 训练证据保持 SANDBOX_ENGINE_UNVERIFIED，门禁阻塞） ===');
}

runT031Tests().catch((err) => {
  console.error('T031 测试失败:', err);
  process.exit(1);
});
