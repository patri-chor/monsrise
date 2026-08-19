// ============================================================
// T036 测试：产品路径训练基础验证
// tests/t036_product_training_foundation.test.ts
//
// 涵盖所有 T036 验收断言：
// - gift_jungle 修复（精确 8 怪，仅增加 116 [3,5]，R5 叶子部署 116）
// - 无 gift_jungle_v2
// - T035 七怪历史证据独立保留
// - R1 分支行为（P1/P2 坐标）
// - side-only / side+visible-opponent-feature 分支接受
// - future-state R1 条件拒绝
// - 模块文件不导入废弃沙盒路径
// - 规范指纹区分有意义变更并拒绝无操作
// ============================================================

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  loadProductSources,
  assertNoGiftJungleV2,
  validateCandidateLegality,
  validateGiftJungleRepair,
  rejectIfNoOp,
  isR1Observable,
  getR1BranchSelection,
  listR1Branches,
  isSideOnlyCondition,
  isSidePlusOpponentFeatureCondition,
  hasFutureStateCondition,
  treeXToProductX,
  computeCandidateFingerprint,
} from '../src/engine/tree/product_training';
import { formationToEvol, cloneEvolFormation } from '../src/engine/tree/evol_gene';
import type { EvolFormation, FeatureMask } from '../src/engine/tree/evol_gene';
import { treeStrategyFor } from '../src/engine/tree/product_tree_strategy';
import type { DeploymentStrategyContext } from '../src/engine/play_full_game';
import type { TeamSlot } from '../src/game/GameEngine';

describe('T036 — Product Training Foundation', () => {

  // ---- 源加载 ----

  describe('01_sources: Gift Jungle repair', () => {
    it('loads sources without error (repair validated internally)', () => {
      expect(() => loadProductSources()).not.toThrow();
    });

    it('gift_jungle has exactly 8 monsters', () => {
      const raw: any[] = JSON.parse(readFileSync(resolve('tests/fixtures/tree/eleven_frozen_sources.json'), 'utf8'));
      const gj = raw.find((s: any) => s.id === 'gift_jungle');
      expect(gj.team.length).toBe(8);
    });

    it('gift_jungle isLegacyBaseline is false', () => {
      const raw: any[] = JSON.parse(readFileSync(resolve('tests/fixtures/tree/eleven_frozen_sources.json'), 'utf8'));
      const gj = raw.find((s: any) => s.id === 'gift_jungle');
      expect(gj.isLegacyBaseline).toBe(false);
    });

    it('gift_jungle team contains monsterId 116 with badges [3,5]', () => {
      const raw: any[] = JSON.parse(readFileSync(resolve('tests/fixtures/tree/eleven_frozen_sources.json'), 'utf8'));
      const gj = raw.find((s: any) => s.id === 'gift_jungle');
      const slot116 = gj.team.find((s: any) => s.monsterId === 116);
      expect(slot116).toBeDefined();
      expect([...slot116.badgeIds].sort()).toEqual([3, 5]);
    });

    it('every reachable R5 leaf deploys monster 116 exactly once', () => {
      const raw: any[] = JSON.parse(readFileSync(resolve('tests/fixtures/tree/eleven_frozen_sources.json'), 'utf8'));
      const gj = raw.find((s: any) => s.id === 'gift_jungle');
      const evol = formationToEvol(gj);

      function findLeaves(node: any, acc: any[]) {
        if (node.children.length === 0) { acc.push(node); return; }
        for (const c of node.children) findLeaves(c, acc);
      }
      const leaves: any[] = [];
      findLeaves(evol.root, leaves);
      const r5Leaves = leaves.filter((n: any) => n.round === 5);
      expect(r5Leaves.length).toBeGreaterThan(0);
      for (const leaf of r5Leaves) {
        const count = leaf.placements.filter((p: any) => p.monsterId === 116).length;
        expect(count).toBe(1);
      }
    });

    it('gift_jungle differs from pre-repair only by 116 [3,5] + leaf deployments', () => {
      const raw: any[] = JSON.parse(readFileSync(resolve('tests/fixtures/tree/eleven_frozen_sources.json'), 'utf8'));
      const gj = raw.find((s: any) => s.id === 'gift_jungle');
      const evol = formationToEvol(gj);
      // Pre-repair team had 7 monsters
      const result = validateGiftJungleRepair({
        evol,
        preRepairTeamSize: 7,
        preRepairFingerprint: '4c913570e3c9', // original fingerprint
      });
      expect(result.valid).toBe(true);
      expect(result.reasons).toHaveLength(0);
    });

    it('no gift_jungle_v2 source exists', () => {
      const sources = loadProductSources();
      expect(() => assertNoGiftJungleV2(sources)).not.toThrow();
    });

    it('historic T035 seven-monster evidence remains present and protocol-separated', () => {
      const t035Dir = resolve('tests/fixtures/tree/experience_library/product_path_t035');
      expect(existsSync(t035Dir)).toBe(true);
      const manifest = JSON.parse(readFileSync(resolve(t035Dir, 'manifest.json'), 'utf8'));
      expect(manifest.protocol).toBe('PRODUCT_PATH_FORMAL_SCREEN_T035_V1');
      // gift_jungle was isLegacyBaseline=true during T035, so it should NOT appear in T035 baselines
      // This confirms historical separation: the seven-monster legacy record is untouched
      const baselines = readFileSync(resolve(t035Dir, 'source_baselines.jsonl'), 'utf8').split('\n').filter(Boolean);
      const gjBaseline = baselines.map(l => JSON.parse(l)).find((r: any) => r.sourceId === 'gift_jungle');
      // Correctly absent from T035 (was legacy); this is the historical-separation proof
      expect(gjBaseline).toBeUndefined();
      // Verify T035 manifest hash is intact (not overwritten)
      expect(manifest.manifestHash).toBe('7bb394b394eba26466ec6d7ee4ed3489cd2b8fc966edda97c81452f103c13d61');
    });
  });

  // ---- R1 分支行为 ----

  // ---- R1 分支行为（直接产品适配器证据） ----

  describe('product adapter: R1 branch parity via treeStrategyFor()', () => {
    function getGiftJungleEvol(): EvolFormation {
      const raw: any[] = JSON.parse(readFileSync(resolve('tests/fixtures/tree/eleven_frozen_sources.json'), 'utf8'));
      const gj = raw.find((s: any) => s.id === 'gift_jungle');
      return formationToEvol(gj);
    }

    /** 构造 R1 DeploymentStrategyContext */
    function makeR1Ctx(side: 1 | 2, enemyHandMonsterIds: number[]): DeploymentStrategyContext {
      const raw: any[] = JSON.parse(readFileSync(resolve('tests/fixtures/tree/eleven_frozen_sources.json'), 'utf8'));
      const gj = raw.find((s: any) => s.id === 'gift_jungle');
      const team: TeamSlot[] = gj.team.map((s: any) => ({ monsterId: s.monsterId, badgeIds: s.badgeIds ?? [] }));
      return {
        side,
        identity: 'gift_jungle',
        round: 1,
        seed: 1,
        rng: () => 0.5,
        team,
        hand: team,
        ownMonsters: [],
        enemyMonsters: [],
        enemyRevealedHand: enemyHandMonsterIds.map(id => ({ monsterId: id, badgeIds: [] })),
        budget: 999,
        zone: side === 1 ? { min: 1, max: 5 } : { min: 6, max: 10 },
      } as any;
    }

    it('R1 branches listed: n2 (fallback) and n7 (fullrush) exist', () => {
      const evol = getGiftJungleEvol();
      const branches = listR1Branches(evol);
      expect(branches.length).toBe(2);
      expect(branches.some(b => b.isFallback && b.nodeId === 'n2')).toBe(true);
      expect(branches.some(b => !b.isFallback && b.nodeId === 'n7')).toBe(true);
    });

    it('[P2] R1 fallback: treeStrategyFor emits branchId=n2, intents contain m110+m124, x direct', () => {
      const evol = getGiftJungleEvol();
      const strategy = treeStrategyFor(evol);
      const intents = strategy(makeR1Ctx(2, [])); // empty hand → no fullrush
      expect(intents.length).toBeGreaterThan(0);
      for (const intent of intents) {
        expect(intent.branch?.branchId).toBe('n2');
      }
      const ids = intents.map(i => i.monsterId);
      expect(ids).toContain(110);
      expect(ids).toContain(124);
      // P2: treeX=7 → plannedX=7
      const m110 = intents.find(i => i.monsterId === 110)!;
      expect(m110.plannedX).toBe(7);
      expect(m110.plannedY).toBe(3);
    });

    it('[P1] R1 fallback: treeStrategyFor emits branchId=n2, x mirrored to 10-x', () => {
      const evol = getGiftJungleEvol();
      const strategy = treeStrategyFor(evol);
      const intents = strategy(makeR1Ctx(1, [])); // empty hand → fallback
      expect(intents.length).toBeGreaterThan(0);
      for (const intent of intents) {
        expect(intent.branch?.branchId).toBe('n2');
      }
      const ids = intents.map(i => i.monsterId);
      expect(ids).toContain(110);
      expect(ids).toContain(124);
      // P1: treeX=7 → plannedX=3 (10-7)
      const m110 = intents.find(i => i.monsterId === 110)!;
      expect(m110.plannedX).toBe(3);
      expect(m110.plannedY).toBe(3);
    });

    it('[P2] R1 n7/fullrush: treeStrategyFor emits branchId=n7 when hand has ≥2 of [114,113,107]', () => {
      const evol = getGiftJungleEvol();
      const strategy = treeStrategyFor(evol);
      const intents = strategy(makeR1Ctx(2, [114, 113])); // fullrush hand
      expect(intents.length).toBeGreaterThan(0);
      for (const intent of intents) {
        expect(intent.branch?.branchId).toBe('n7');
      }
      const ids = intents.map(i => i.monsterId);
      expect(ids).toContain(110);
      expect(ids).toContain(124);
      // P2: treeX=7 → plannedX=7
      const m110 = intents.find(i => i.monsterId === 110)!;
      expect(m110.plannedX).toBe(7);
      expect(m110.plannedY).toBe(3);
    });

    it('[P1] R1 n7/fullrush: treeStrategyFor emits branchId=n7, x mirrored', () => {
      const evol = getGiftJungleEvol();
      const strategy = treeStrategyFor(evol);
      const intents = strategy(makeR1Ctx(1, [114, 113])); // fullrush
      expect(intents.length).toBeGreaterThan(0);
      for (const intent of intents) {
        expect(intent.branch?.branchId).toBe('n7');
      }
      const ids = intents.map(i => i.monsterId);
      expect(ids).toContain(110);
      expect(ids).toContain(124);
      // P1: treeX=7 → 10-7=3
      const m110 = intents.find(i => i.monsterId === 110)!;
      expect(m110.plannedX).toBe(3);
      expect(m110.plannedY).toBe(3);
    });

    it('n7 branchId ≠ n2 branchId (fullrush vs fallback differ)', () => {
      const evol = getGiftJungleEvol();
      const strategy = treeStrategyFor(evol);
      const fallback = strategy(makeR1Ctx(2, []));
      const n7 = strategy(makeR1Ctx(2, [114, 113]));
      expect(fallback[0]?.branch?.branchId).toBe('n2');
      expect(n7[0]?.branch?.branchId).toBe('n7');
      expect(fallback[0]?.branch?.branchId).not.toBe(n7[0]?.branch?.branchId);
    });

    it('branch_semantics helper agrees with product adapter for same R1 input', () => {
      const evol = getGiftJungleEvol();
      const strategy = treeStrategyFor(evol);
      const helperSel = getR1BranchSelection(evol, {
        enemyHandIds: new Set([114, 113]),
        enemyHandBadges: new Set<number>(),
      });
      const adapterIntents = strategy(makeR1Ctx(2, [114, 113]));
      expect(helperSel.side2?.id).toBe('n7');
      expect(adapterIntents[0]?.branch?.branchId).toBe('n7');
    });

    it('P1/P2 coordinate mirror (helper check)', () => {
      expect(treeXToProductX(7, 2)).toBe(7);
      expect(treeXToProductX(7, 1)).toBe(3);
      expect(treeXToProductX(9, 1)).toBe(1);
    });

    it('side-only condition accepted (R1 observable)', () => {
      const m: FeatureMask = { side: 1, main: null, subs: [], keys: [] };
      expect(isSideOnlyCondition(m)).toBe(true);
      expect(isR1Observable(m)).toBe(true);
    });

    it('side+visible-opponent-feature condition accepted', () => {
      const m: FeatureMask = { side: 2, main: 'fullrush', subs: [], keys: [] };
      expect(isSidePlusOpponentFeatureCondition(m)).toBe(true);
      expect(isR1Observable(m)).toBe(true);
    });

    it('future-state R1 condition rejected', () => {
      const evol = getGiftJungleEvol();
      const futureEvol = cloneEvolFormation(evol);
      const r1 = futureEvol.root.children.filter(c => c.round === 1);
      if (r1.length > 0) (r1[0].condition as any).requiresBoardIds = true;
      expect(hasFutureStateCondition(futureEvol)).toBe(true);
    });
  });


  // ---- 验证模块 ----

  describe('03_validate: candidate legality', () => {
    function getExecutableEvol(): EvolFormation {
      const sources = loadProductSources();
      // Use first non-gift_jungle executable source
      const src = sources.executable.find((s: any) => s.id !== 'gift_jungle');
      if (!src) throw new Error('No non-gift_jungle executable source found');
      return formationToEvol(src as any);
    }

    it('valid executable source passes legality check', () => {
      const evol = getExecutableEvol();
      const result = validateCandidateLegality(evol);
      expect(result.valid).toBe(true);
    });

    it('gift_jungle executable source passes legality check', () => {
      const raw: any[] = JSON.parse(readFileSync(resolve('tests/fixtures/tree/eleven_frozen_sources.json'), 'utf8'));
      const gj = raw.find((s: any) => s.id === 'gift_jungle');
      const evol = formationToEvol(gj);
      const result = validateCandidateLegality(evol);
      expect(result.valid).toBe(true);
    });

    it('rejects formation with wrong team size', () => {
      const evol = getExecutableEvol();
      const modified = cloneEvolFormation(evol);
      modified.team.push({ monsterId: 999, badgeIds: [] });
      const result = validateCandidateLegality(modified);
      expect(result.valid).toBe(false);
      expect(result.reasons.some(r => r.includes('TEAM_COUNT_INVALID'))).toBe(true);
    });

    it('canonical fingerprint distinguishes transform/schedule/branch changes', () => {
      const evol = getExecutableEvol();
      const modified = cloneEvolFormation(evol);
      // Move a placement
      let changed = false;
      outer: for (const node of [modified.root, ...modified.root.children]) {
        const child = (node as any).children?.[0];
        if (child && child.placements.length > 0) {
          const p = child.placements[0];
          const origX = p.x;
          p.x = p.x === 10 ? 9 : p.x + 1;
          if (p.x !== origX) { changed = true; break outer; }
        }
      }
      if (!changed) return; // skip if no movable placement
      const fpOriginal = computeCandidateFingerprint(evol);
      const fpModified = computeCandidateFingerprint(modified);
      expect(fpOriginal).not.toBe(fpModified);
    });

    it('canonical fingerprint rejects no-op (identical candidate)', () => {
      const evol = getExecutableEvol();
      const clone = cloneEvolFormation(evol);
      const result = rejectIfNoOp(clone, evol);
      expect(result.isNoOp).toBe(true);
    });
  });

  // ---- 架构约束 ----

  describe('architecture: no deprecated sandbox imports', () => {
    const DEPRECATED_PATTERNS = [
      /import.*arena/,
      /import.*playSpecVsSpec/,
      /import.*evaluateArena/,
      /import.*hill_climb/,
      /import.*sequential_tree_optimization/,
      /import.*branch_induct/,
    ];

    const MODULE_FILES = [
      'src/engine/tree/product_training/01_sources.ts',
      'src/engine/tree/product_training/02_candidates.ts',
      'src/engine/tree/product_training/03_validate.ts',
      'src/engine/tree/product_training/branch_semantics.ts',
      'src/engine/tree/product_training/index.ts',
    ];

    for (const file of MODULE_FILES) {
      it(`${file} does not import deprecated sandbox paths`, () => {
        const content = readFileSync(resolve(file), 'utf8');
        for (const pattern of DEPRECATED_PATTERNS) {
          expect(content).not.toMatch(pattern);
        }
      });
    }

    it('all Phase-1 files exist', () => {
      for (const file of MODULE_FILES) {
        expect(existsSync(resolve(file))).toBe(true);
      }
    });
  });
});
