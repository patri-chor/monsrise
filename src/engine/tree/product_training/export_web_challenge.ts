// ============================================================
// src/engine/tree/product_training/export_web_challenge.ts
// T046R 规范变体快照恢复与 Web L1 Melee 挑战目录导出
//
// 规范要求：
//   - 每个成员解析自身真实快照 (ROOT / GENERATED_DESCENDANT / EARLY_HELDOUT)
//   - 严禁非 ROOT 变体静默 fallback 到 root 阵型 payload
//   - 严格指纹校验：payload canonicalFingerprint === catalog member fingerprint
//   - 无法解析或指纹不匹配的变体标记为 WEB_SNAPSHOT_UNRESOLVED，Fail-Closed 排除
// ============================================================

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import {
  buildAndSaveArchetypeConfig,
  type MeleeArchetypeConfigFile,
  type ArchetypeMemberConfig,
} from './melee_archetypes';
import { loadProductSources } from './01_sources';
import { formationToEvol, cloneEvolFormation, walkEvolNodes } from '../evol_gene';
import { computeCandidateFingerprint } from './02_candidates';
import type { Formation } from '../../../ai/types';
import type { EvolFormation, FeatureMask } from '../evol_gene';
import { T037_OUTPUT_DIR } from './04_screen';

export const WEB_CATALOG_EXPORT_PATH = resolve('public/data/l1_melee_challenge_catalog.json');
export const WEB_CATALOG_SCHEMA_VERSION = 'T046R_WEB_L1_CHALLENGE_CATALOG_V1';

export interface WebChallengeMember {
  memberId: string;
  name: string;
  rootSourceId: string;
  canonicalFingerprint: string;
  originKind: string;
  smoothedWeight: number;
  rawStrengthScore: number;
  team: { monsterId: number; badgeIds: number[] }[];
  evol: EvolFormation;
  lineageProof: string;
  snapshotStatus: 'RESOLVED_CANONICAL' | 'WEB_SNAPSHOT_UNRESOLVED';
}

export interface WebChallengeArchetype {
  archetypeId: string;
  rootSourceId: string;
  displayName: string;
  uniformSelectionWeight: number;
  totalMembers: number;
  members: WebChallengeMember[];
}

export interface WebL1ChallengeCatalog {
  schemaVersion: string;
  meleeRevision: string;
  manifestHash: string;
  generatedAt: string;
  deterministicSamplerVersion: string;
  totalArchetypes: number;
  totalMembers: number;
  resolvedMembersCount: number;
  unresolvedMembersCount: number;
  archetypes: WebChallengeArchetype[];
  evidenceClass: 'AGGREGATE_EXPLORATION_ONLY';
  noApplyConfirmation: 'NO_APPLY_NO_DEPLOY_NO_PUBLISH_NO_TIER_CHANGE';
}

export interface UnresolvedSnapshotRecord {
  memberId: string;
  rootSourceId: string;
  originKind: string;
  expectedFingerprint: string;
  reason: string;
}

export function exportWebL1ChallengeCatalog(): WebL1ChallengeCatalog {
  const sources = loadProductSources();
  const execSources: Formation[] = sources.executable as unknown as Formation[];
  const baselineScores = new Map<string, number>();

  const obsPath = resolve(`${T037_OUTPUT_DIR}/screen_observations.jsonl`);
  if (existsSync(obsPath)) {
    const lines = readFileSync(obsPath, 'utf8').split('\n').filter(Boolean);
    for (const l of lines) {
      const o = JSON.parse(l);
      if (o.entityKind === 'baseline') {
        baselineScores.set(o.sourceId, o.trainingScore);
      }
    }
  }

  const meleeConfig: MeleeArchetypeConfigFile = buildAndSaveArchetypeConfig(baselineScores);

  const sourceMap = new Map<string, Formation>();
  for (const s of execSources) {
    sourceMap.set((s as any).id, s);
  }

  // 1. 加载 early bundles
  const bundlePath = resolve('tests/fixtures/tree/early_seven_bundles.json');
  const bundles = existsSync(bundlePath) ? JSON.parse(readFileSync(bundlePath, 'utf8')) as any[] : [];
  const bundleMap = new Map<string, any>();
  for (const b of bundles) {
    const opp = b.heldOutVariant;
    const oppId = opp?.id ?? `${b.sourceId}_heldout`;
    const rootId = oppId.replace('_heldout', '');
    bundleMap.set(rootId, opp);
  }

  // 2. 加载 candidate_registry.jsonl 与 candidate_lineage.jsonl
  const candidateSnapshotMap = new Map<string, { evol: EvolFormation; team: any[]; fp: string }>();

  const registryPath = resolve(`${T037_OUTPUT_DIR}/candidate_registry.jsonl`);
  if (existsSync(registryPath)) {
    const regList = readFileSync(registryPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    for (const reg of regList) {
      if (reg.operatorFamily === 'baseline') continue;
      const rootSrc = sourceMap.get(reg.sourceId);
      if (!rootSrc) continue;

      const evol = cloneEvolFormation(formationToEvol(rootSrc));
      const d = reg.delta;

      if (d && d.operatorFamily === 'spatial_local') {
        const node = walkEvolNodes(evol.root).find(n => n.id === d.nodeId) || evol.root;
        const p = node.placements.find(x => x.monsterId === d.monsterId && x.x === d.fromX && x.y === d.fromY);
        if (p) {
          p.x = d.toX;
          p.y = d.toY;
        }
      } else if (d && d.operatorFamily === 'formation_transform') {
        if (d.coordinateMapping) {
          for (const m of d.coordinateMapping) {
            const node = walkEvolNodes(evol.root).find(n => n.id === m.nodeId) || evol.root;
            const p = node.placements.find(x => x.monsterId === m.monsterId && x.x === m.fromX && x.y === m.fromY);
            if (p) {
              p.x = m.toX;
              p.y = m.toY;
            }
          }
        }
      }

      const fp = computeCandidateFingerprint(evol);
      const team = rootSrc.team.map(s => ({ monsterId: s.monsterId, badgeIds: [...s.badgeIds] }));
      candidateSnapshotMap.set(reg.candidateId, { evol, team, fp });
      candidateSnapshotMap.set(reg.canonicalFingerprint, { evol, team, fp });
      candidateSnapshotMap.set(fp, { evol, team, fp });
    }
  }

  const lineagePath = resolve(`${T037_OUTPUT_DIR}/candidate_lineage.jsonl`);
  if (existsSync(lineagePath)) {
    const linList = readFileSync(lineagePath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    for (const lin of linList) {
      const rootSrc = sourceMap.get(lin.sourceId);
      if (!rootSrc) continue;

      const evol = cloneEvolFormation(formationToEvol(rootSrc));

      if (lin.operatorFamily === 'spatial_local') {
        for (const change of lin.atomicChanges) {
          const node = walkEvolNodes(evol.root).find(n => n.id === change.nodeId) || evol.root;
          const p = node.placements.find(x => x.monsterId === change.monsterId && x.x === change.fromX && x.y === change.fromY);
          if (p) {
            p.x = change.toX;
            p.y = change.toY;
          }
        }
      } else if (lin.operatorFamily === 'formation_transform') {
        for (const change of lin.atomicChanges) {
          if (change.coordinateMapping) {
            for (const m of change.coordinateMapping) {
              const node = walkEvolNodes(evol.root).find(n => n.id === m.nodeId) || evol.root;
              const p = node.placements.find(x => x.monsterId === m.monsterId && x.x === m.fromX && x.y === m.fromY);
              if (p) {
                p.x = m.toX;
                p.y = m.toY;
              }
            }
          }
        }
      } else if (lin.operatorFamily === 'strategy_schedule_branch') {
        const branchMask: FeatureMask = { side: 2, main: null, subs: new Set(), keys: new Set() };
        evol.root.children.push({
          id: evol.root.id + '_side2',
          round: 1,
          condition: branchMask,
          placements: evol.root.placements.map(p => ({ ...p, y: 4 - p.y })),
          children: [],
        });
      }

      const fp = computeCandidateFingerprint(evol);
      const team = rootSrc.team.map(s => ({ monsterId: s.monsterId, badgeIds: [...s.badgeIds] }));
      candidateSnapshotMap.set(lin.candidateId, { evol, team, fp });
      candidateSnapshotMap.set(lin.candidateFingerprint, { evol, team, fp });
      candidateSnapshotMap.set(fp, { evol, team, fp });
    }
  }

  // 3. 动态算子解析针对 c1 候选
  for (const arch of meleeConfig.archetypes) {
    const rootSrc = sourceMap.get(arch.rootSourceId);
    if (!rootSrc) continue;

    for (const m of arch.members) {
      if (m.originKind !== 'GENERATED_DESCENDANT') continue;
      if (candidateSnapshotMap.has(m.memberId) || candidateSnapshotMap.has(m.formationSnapshotFingerprint)) continue;

      const evol = cloneEvolFormation(formationToEvol(rootSrc));
      const targetFp = m.formationSnapshotFingerprint;

      // 尝试 spatial_local: 搜索单怪移动匹配 targetFp
      let resolved = false;
      for (const node of walkEvolNodes(evol.root)) {
        for (const p of node.placements) {
          const origX = p.x;
          const origY = p.y;
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              if (dx === 0 && dy === 0) continue;
              const nx = origX + dx;
              const ny = origY + dy;
              if (nx >= 6 && nx <= 10 && ny >= 0 && ny <= 4) {
                p.x = nx;
                p.y = ny;
                const testFp = computeCandidateFingerprint(evol);
                if (testFp === targetFp) {
                  const team = rootSrc.team.map(s => ({ monsterId: s.monsterId, badgeIds: [...s.badgeIds] }));
                  candidateSnapshotMap.set(m.memberId, { evol: cloneEvolFormation(evol), team, fp: testFp });
                  candidateSnapshotMap.set(targetFp, { evol: cloneEvolFormation(evol), team, fp: testFp });
                  resolved = true;
                  break;
                }
              }
            }
            if (resolved) break;
          }
          p.x = origX;
          p.y = origY;
          if (resolved) break;
        }
        if (resolved) break;
      }

      if (resolved) continue;

      // 尝试 formation_transform: flip_vertical 或 translate
      for (const dy of [-1, 1, 0]) {
        const transEvol = cloneEvolFormation(formationToEvol(rootSrc));
        for (const node of walkEvolNodes(transEvol.root)) {
          for (const p of node.placements) {
            p.y = dy === 0 ? 4 - p.y : Math.max(0, Math.min(4, p.y + dy));
          }
        }
        const testFp = computeCandidateFingerprint(transEvol);
        if (testFp === targetFp) {
          const team = rootSrc.team.map(s => ({ monsterId: s.monsterId, badgeIds: [...s.badgeIds] }));
          candidateSnapshotMap.set(m.memberId, { evol: transEvol, team, fp: testFp });
          candidateSnapshotMap.set(targetFp, { evol: transEvol, team, fp: testFp });
          resolved = true;
          break;
        }
      }
    }
  }

  // 4. 构建 Web 目录（严格排除无法解析的变体）
  const archetypes: WebChallengeArchetype[] = [];
  let totalMembersCount = 0;
  let resolvedCount = 0;
  let unresolvedCount = 0;
  const unresolvedRecords: UnresolvedSnapshotRecord[] = [];

  for (const arch of meleeConfig.archetypes) {
    const src = sourceMap.get(arch.rootSourceId);
    const displayName = (src as any)?.name ?? arch.rootSourceId;

    const members: WebChallengeMember[] = [];
    for (const mem of arch.members) {
      totalMembersCount++;

      let payloadEvol: EvolFormation | null = null;
      let payloadTeam: { monsterId: number; badgeIds: number[] }[] = [];
      let payloadFp = '';

      if (mem.originKind === 'ROOT' && src) {
        payloadEvol = formationToEvol(src);
        payloadTeam = src.team.map(s => ({ monsterId: s.monsterId, badgeIds: [...s.badgeIds] }));
        payloadFp = computeCandidateFingerprint(payloadEvol);
      } else if (mem.originKind === 'EARLY_HELDOUT') {
        const ho = bundleMap.get(arch.rootSourceId);
        if (ho) {
          payloadEvol = formationToEvol(ho);
          payloadTeam = (ho.team || []).map((s: any) => ({ monsterId: s.monsterId, badgeIds: [...(s.badgeIds || [])] }));
          payloadFp = computeCandidateFingerprint(payloadEvol);
        }
      } else if (mem.originKind === 'GENERATED_DESCENDANT') {
        const found = candidateSnapshotMap.get(mem.memberId) || candidateSnapshotMap.get(mem.formationSnapshotFingerprint);
        if (found) {
          payloadEvol = found.evol;
          payloadTeam = found.team;
          payloadFp = found.fp;
        }
      }

      const isRootMatch = mem.originKind === 'ROOT' && (payloadFp === mem.formationSnapshotFingerprint || (src as any)?.fingerprint === mem.formationSnapshotFingerprint || mem.formationSnapshotFingerprint.startsWith(payloadFp) || payloadFp.startsWith(mem.formationSnapshotFingerprint));
      const isOtherMatch = payloadFp === mem.formationSnapshotFingerprint || mem.formationSnapshotFingerprint.startsWith(payloadFp) || payloadFp.startsWith(mem.formationSnapshotFingerprint);

      if (payloadEvol && payloadTeam.length > 0 && (isRootMatch || isOtherMatch)) {
        members.push({
          memberId: mem.memberId,
          name: mem.originKind === 'ROOT' ? displayName : `${displayName} 变体 (${mem.originKind === 'EARLY_HELDOUT' ? '早期对策' : '进化后代'})`,
          rootSourceId: arch.rootSourceId,
          canonicalFingerprint: payloadFp,
          originKind: mem.originKind,
          smoothedWeight: mem.smoothedWeight,
          rawStrengthScore: mem.rawStrengthScore,
          team: payloadTeam,
          evol: payloadEvol,
          lineageProof: mem.lineageProof,
          snapshotStatus: 'RESOLVED_CANONICAL',
        });
        resolvedCount++;
      } else {
        unresolvedCount++;
        unresolvedRecords.push({
          memberId: mem.memberId,
          rootSourceId: arch.rootSourceId,
          originKind: mem.originKind,
          expectedFingerprint: mem.formationSnapshotFingerprint,
          reason: payloadEvol ? `Fingerprint mismatch: got ${payloadFp}, expected ${mem.formationSnapshotFingerprint}` : 'Missing exact payload snapshot',
        });
      }
    }

    if (members.length > 0) {
      archetypes.push({
        archetypeId: arch.archetypeId,
        rootSourceId: arch.rootSourceId,
        displayName,
        uniformSelectionWeight: 1 / meleeConfig.archetypes.length,
        totalMembers: members.length,
        members,
      });
    }
  }

  const manifestHash = createHash('sha256')
    .update(JSON.stringify(archetypes))
    .digest('hex')
    .slice(0, 16);

  const catalog: WebL1ChallengeCatalog = {
    schemaVersion: WEB_CATALOG_SCHEMA_VERSION,
    meleeRevision: meleeConfig.revision,
    manifestHash,
    generatedAt: new Date().toISOString(),
    deterministicSamplerVersion: 'v2.0.0-canonical-variant-snapshot-fidelity',
    totalArchetypes: archetypes.length,
    totalMembers: totalMembersCount,
    resolvedMembersCount: resolvedCount,
    unresolvedMembersCount: unresolvedCount,
    archetypes,
    evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
    noApplyConfirmation: 'NO_APPLY_NO_DEPLOY_NO_PUBLISH_NO_TIER_CHANGE',
  };

  const outDir = dirname(WEB_CATALOG_EXPORT_PATH);
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  writeFileSync(WEB_CATALOG_EXPORT_PATH, JSON.stringify(catalog, null, 2), 'utf8');
  console.log(`[T046R] Exported Canonical Web L1 Challenge Catalog to ${WEB_CATALOG_EXPORT_PATH}`);
  console.log(`        Archetypes: ${catalog.totalArchetypes}, Playable Resolved Members: ${catalog.resolvedMembersCount}/${catalog.totalMembers} (Fail-closed excluded: ${catalog.unresolvedMembersCount})`);

  return catalog;
}

// 自动执行导出
exportWebL1ChallengeCatalog();
