// ============================================================
// src/engine/tree/product_training/snapshot_resolver.ts
// 权威阵型快照解析器 (Exact Formation Snapshot Resolver)
//
// T053 规范要求：
//   - 所有评测和混战必须按 exact formation snapshot 解析，严禁按 rootR0SourceId 悄悄 fallback 回父阵
//   - 严格逐条 Lineage/Registry 重构：computedFingerprint === declared candidateFingerprint 才能注册
//   - 对不满足指纹一致性或缺少确切 AST 数据的记录，严禁通用伪造构造或试探猜解，必须予以隔离 (Quarantine)
//   - 解析优先级：
//       1. R0 original: r0_historical_roots / frozen source snapshot
//       2. Exact registered/lineage descendant snapshot
//       3. Early heldout fixture
//   - 校验：formationId / catalog fingerprint / resolved snapshot fingerprint 必须完全一致
//   - 找不到或 fingerprint 不匹配时：WEB/TRAINING_SNAPSHOT_UNRESOLVED fail closed
// ============================================================

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Formation, TeamSlot } from '../ai/types';
import type { EvolFormation } from './evol_gene';
import { cloneEvolFormation, formationToEvol, walkEvolNodes } from './evol_gene';
import { computeCandidateFingerprint } from './candidates';
import { loadProductSources } from './sources';

export const T037_OUTPUT_DIR = 'reports/tree-experience/t037-product-screen';

export interface ResolveSnapshotQuery {
  formationId: string;
  canonicalFingerprint?: string | null;
  calculatorPolicyFingerprint?: string | null;
  snapshotRevision?: string;
  rootR0SourceId?: string;
}

export interface ResolvedFormationSnapshot {
  formationId: string;
  displayName: string;
  canonicalFingerprint: string;
  calculatorPolicyFingerprint?: string;
  team: TeamSlot[];
  evol: EvolFormation;
  provenance: string;
  rootR0SourceId: string;
}

export interface QuarantinedLineageRecord {
  candidateId: string;
  sourceId: string;
  operatorFamily: string;
  declaredFingerprint: string;
  computedFingerprint?: string;
  reason: 'FINGERPRINT_MISMATCH' | 'INSUFFICIENT_ATOMIC_DATA' | 'RECONSTRUCTION_FAILED' | 'PARENT_UNRESOLVED';
  failureReason: string;
  details?: Record<string, any>;
}

export class SnapshotResolutionError extends Error {
  public readonly code = 'WEB/TRAINING_SNAPSHOT_UNRESOLVED';
  constructor(message: string, public readonly details: Record<string, any>) {
    super(`[WEB/TRAINING_SNAPSHOT_UNRESOLVED] ${message}`);
    this.name = 'SnapshotResolutionError';
  }
}

export class FormationSnapshotResolver {
  private static instance: FormationSnapshotResolver | null = null;

  // 快照缓存字典: key -> ResolvedFormationSnapshot
  private snapshotById = new Map<string, ResolvedFormationSnapshot>();
  private snapshotByFp = new Map<string, ResolvedFormationSnapshot>();
  private r0Roots = new Map<string, Formation>();
  private quarantinedRecords: QuarantinedLineageRecord[] = [];

  private initialized = false;

  private constructor() {}

  public static getInstance(): FormationSnapshotResolver {
    if (!FormationSnapshotResolver.instance) {
      FormationSnapshotResolver.instance = new FormationSnapshotResolver();
    }
    return FormationSnapshotResolver.instance;
  }

  /** 重置单例（用于测试或重新加载） */
  public static resetInstance(): void {
    FormationSnapshotResolver.instance = null;
  }

  public init(): void {
    if (this.initialized) return;
    this.quarantinedRecords = [];

    // 1. 加载 11 个 R0 原生不可变根源
    const sources = loadProductSources();
    for (const src of sources.executable) {
      const srcId = (src as any).id;
      this.r0Roots.set(srcId, src);
      const evol = formationToEvol(src);
      const fp = computeCandidateFingerprint(evol);
      const team = src.team.map(s => ({ monsterId: s.monsterId, badgeIds: [...s.badgeIds] }));

      const rootSnapshot: ResolvedFormationSnapshot = {
        formationId: `t0:${srcId}`,
        displayName: (src as any).name ?? srcId,
        canonicalFingerprint: fp,
        calculatorPolicyFingerprint: 'calc_pol_default_v1',
        team,
        evol,
        provenance: `r0_root_lineage#${srcId}`,
        rootR0SourceId: srcId,
      };

      this.registerSnapshot(rootSnapshot);
      this.snapshotById.set(srcId, rootSnapshot);
    }

    // 2. 加载 Early Heldout Bundles
    const heldoutPath = resolve('tests/fixtures/tree/early_seven_bundles.json');
    if (existsSync(heldoutPath)) {
      try {
        const bundles = JSON.parse(readFileSync(heldoutPath, 'utf8'));
        for (const item of bundles) {
          const variants = [item.trainingVariant, item.heldoutTarget, item].filter(x => x && Array.isArray(x.team));
          for (const b of variants) {
            if (!b.id) continue;
            const evol = formationToEvol(b);
            const fp = computeCandidateFingerprint(evol);
            const rootId = b.rootR0SourceId || item.familyId || b.id;
            const team = b.team.map((s: any) => ({ monsterId: s.monsterId, badgeIds: [...(s.badgeIds ?? [])] }));

            const heldoutSnapshot: ResolvedFormationSnapshot = {
              formationId: b.id,
              displayName: b.name ?? b.id,
              canonicalFingerprint: fp,
              calculatorPolicyFingerprint: 'calc_pol_default_v1',
              team,
              evol,
              provenance: `early_heldout#${b.id}`,
              rootR0SourceId: rootId,
            };
            this.registerSnapshot(heldoutSnapshot);
          }
        }
      } catch (err: any) {
        console.warn(`[SnapshotResolver] Warning: could not parse early heldout bundles: ${err?.message}`);
      }
    }

    // 3. 加载 Candidate Registry (delta 注册表) 派生后代快照（逐条严格解析校验）
    const registryPath = resolve(`${T037_OUTPUT_DIR}/candidate_registry.jsonl`);
    if (existsSync(registryPath)) {
      const regLines = readFileSync(registryPath, 'utf8').split('\n').filter(Boolean);
      for (const line of regLines) {
        let reg: any;
        try {
          reg = JSON.parse(line);
        } catch {
          continue;
        }

        const rootSrc = this.r0Roots.get(reg.sourceId);
        if (!rootSrc) {
          this.quarantinedRecords.push({
            candidateId: reg.candidateId,
            sourceId: reg.sourceId,
            operatorFamily: reg.delta?.operatorFamily ?? 'unknown',
            declaredFingerprint: reg.fingerprint || reg.canonicalFingerprint || '',
            reason: 'PARENT_UNRESOLVED',
            failureReason: `Root sourceId '${reg.sourceId}' not found in R0 roots`,
          });
          continue;
        }

        try {
          const evol = cloneEvolFormation(formationToEvol(rootSrc));
          evol.name = reg.candidateId;
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
          const declaredFp = reg.fingerprint || reg.canonicalFingerprint;

          if (declaredFp && declaredFp !== fp) {
            this.quarantinedRecords.push({
              candidateId: reg.candidateId,
              sourceId: reg.sourceId,
              operatorFamily: d?.operatorFamily ?? 'unknown',
              declaredFingerprint: declaredFp,
              computedFingerprint: fp,
              reason: 'FINGERPRINT_MISMATCH',
              failureReason: `Registry declared fingerprint ${declaredFp} != computed ${fp}`,
            });
            continue;
          }

          const team = rootSrc.team.map(s => ({ monsterId: s.monsterId, badgeIds: [...s.badgeIds] }));

          const regSnapshot: ResolvedFormationSnapshot = {
            formationId: reg.candidateId,
            displayName: reg.candidateId,
            canonicalFingerprint: fp,
            calculatorPolicyFingerprint: 'calc_pol_default_v1',
            team,
            evol,
            provenance: `candidate_registry#${reg.candidateId}`,
            rootR0SourceId: reg.sourceId,
          };
          this.registerSnapshot(regSnapshot);
        } catch (err: any) {
          this.quarantinedRecords.push({
            candidateId: reg.candidateId,
            sourceId: reg.sourceId,
            operatorFamily: reg.delta?.operatorFamily ?? 'unknown',
            declaredFingerprint: reg.fingerprint || '',
            reason: 'RECONSTRUCTION_FAILED',
            failureReason: err?.message || String(err),
          });
        }
      }
    }

    // 4. 加载 Candidate Lineage 派生后代快照（逐条严格解析校验，绝不文件级吞没）
    const lineagePath = resolve(`${T037_OUTPUT_DIR}/candidate_lineage.jsonl`);
    if (existsSync(lineagePath)) {
      const linLines = readFileSync(lineagePath, 'utf8').split('\n').filter(Boolean);
      for (const line of linLines) {
        let lin: any;
        try {
          lin = JSON.parse(line);
        } catch {
          continue;
        }

        const rootSrc = this.r0Roots.get(lin.sourceId);
        if (!rootSrc) {
          this.quarantinedRecords.push({
            candidateId: lin.candidateId,
            sourceId: lin.sourceId,
            operatorFamily: lin.operatorFamily ?? 'unknown',
            declaredFingerprint: lin.candidateFingerprint ?? '',
            reason: 'PARENT_UNRESOLVED',
            failureReason: `Root sourceId '${lin.sourceId}' not found in R0 roots`,
          });
          continue;
        }

        try {
          const evol = cloneEvolFormation(formationToEvol(rootSrc));
          evol.name = lin.candidateId;

          if (lin.operatorFamily === 'spatial_local') {
            for (const change of lin.atomicChanges || []) {
              const node = walkEvolNodes(evol.root).find(n => n.id === change.nodeId) || evol.root;
              const p = node.placements.find(x => x.monsterId === change.monsterId && x.x === change.fromX && x.y === change.fromY);
              if (p) {
                p.x = change.toX;
                p.y = change.toY;
              }
            }
          } else if (lin.operatorFamily === 'formation_transform') {
            for (const change of lin.atomicChanges || []) {
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
          } else if (lin.operatorFamily === 'multi_monster_exploration') {
            const changes = (lin.atomicChanges && lin.atomicChanges[0] && Array.isArray(lin.atomicChanges[0].atomicChanges))
              ? lin.atomicChanges[0].atomicChanges
              : (lin.atomicChanges || []);
            for (const change of changes) {
              if (change.type === 'move_placement') {
                const node = walkEvolNodes(evol.root).find(n => n.id === change.nodeId) || evol.root;
                const p = node.placements.find(x => x.monsterId === change.monsterId);
                if (p && change.description) {
                  const m = change.description.match(/to \((\d+),(\d+)\)/);
                  if (m) {
                    p.x = parseInt(m[1], 10);
                    p.y = parseInt(m[2], 10);
                  }
                }
              }
            }
          } else if (lin.operatorFamily === 'strategy_schedule_branch') {
            // T053 A.5: 当缺少确切 AST 分支原子数据时，严禁使用通用伪造构造，fail closed 并隔离
            const hasExactBranchData = lin.atomicChanges?.some((c: any) => c.exactBranchNode || (c.branchMask && c.placements));
            if (!hasExactBranchData) {
              this.quarantinedRecords.push({
                candidateId: lin.candidateId,
                sourceId: lin.sourceId,
                operatorFamily: lin.operatorFamily,
                declaredFingerprint: lin.candidateFingerprint,
                reason: 'INSUFFICIENT_ATOMIC_DATA',
                failureReason: 'Missing exact AST branch node specification; generic synthetic reconstruction is forbidden',
              });
              continue;
            }
          } else {
            // 未知或暂不支持的算子
            this.quarantinedRecords.push({
              candidateId: lin.candidateId,
              sourceId: lin.sourceId,
              operatorFamily: lin.operatorFamily ?? 'unsupported',
              declaredFingerprint: lin.candidateFingerprint ?? '',
              reason: 'RECONSTRUCTION_FAILED',
              failureReason: `Unsupported operator family '${lin.operatorFamily}'`,
            });
            continue;
          }

          const fp = computeCandidateFingerprint(evol);
          if (lin.candidateFingerprint && lin.candidateFingerprint !== fp) {
            this.quarantinedRecords.push({
              candidateId: lin.candidateId,
              sourceId: lin.sourceId,
              operatorFamily: lin.operatorFamily,
              declaredFingerprint: lin.candidateFingerprint,
              computedFingerprint: fp,
              reason: 'FINGERPRINT_MISMATCH',
              failureReason: `Reconstructed evol fingerprint ${fp} does not match declared ${lin.candidateFingerprint}`,
            });
            continue;
          }

          const team = rootSrc.team.map(s => ({ monsterId: s.monsterId, badgeIds: [...s.badgeIds] }));

          const lineageSnapshot: ResolvedFormationSnapshot = {
            formationId: lin.candidateId,
            displayName: lin.candidateId,
            canonicalFingerprint: fp,
            calculatorPolicyFingerprint: 'calc_pol_default_v1',
            team,
            evol,
            provenance: `candidate_lineage#${lin.candidateId}`,
            rootR0SourceId: lin.sourceId,
          };
          this.registerSnapshot(lineageSnapshot);
        } catch (err: any) {
          this.quarantinedRecords.push({
            candidateId: lin.candidateId,
            sourceId: lin.sourceId,
            operatorFamily: lin.operatorFamily ?? 'unknown',
            declaredFingerprint: lin.candidateFingerprint ?? '',
            reason: 'RECONSTRUCTION_FAILED',
            failureReason: err?.message || String(err),
          });
        }
      }
    }

    this.initialized = true;
  }

  /** 获取所有被隔离的无效 Lineage/Registry 记录 */
  public getQuarantinedRecords(): QuarantinedLineageRecord[] {
    if (!this.initialized) this.init();
    return [...this.quarantinedRecords];
  }

  /** 显式注册一个已构建的 exact 快照 */
  public registerSnapshot(snapshot: ResolvedFormationSnapshot): void {
    const verifiedFp = computeCandidateFingerprint(snapshot.evol);
    if (snapshot.canonicalFingerprint && snapshot.canonicalFingerprint !== verifiedFp) {
      throw new SnapshotResolutionError(
        `Cannot register '${snapshot.formationId}': declared fingerprint ${snapshot.canonicalFingerprint} does not match exact snapshot ${verifiedFp}`,
        { formationId: snapshot.formationId, declaredFingerprint: snapshot.canonicalFingerprint, verifiedFingerprint: verifiedFp }
      );
    }

    const payload: ResolvedFormationSnapshot = {
      ...snapshot,
      canonicalFingerprint: verifiedFp,
      team: snapshot.team.map(s => ({ monsterId: s.monsterId, badgeIds: [...s.badgeIds] })),
      evol: cloneEvolFormation(snapshot.evol),
    };

    this.snapshotById.set(snapshot.formationId, payload);
    this.snapshotByFp.set(verifiedFp, payload);
  }

  /**
   * 权威解析指定阵型的 Exact Snapshot (Fail-Closed)
   */
  public resolveFormationSnapshot(query: ResolveSnapshotQuery): ResolvedFormationSnapshot {
    if (!this.initialized) {
      this.init();
    }

    // 1. 优先按 formationId 查找
    let candidate = this.snapshotById.get(query.formationId);

    // 2. 检查是否有 t0: 前缀别名
    if (!candidate && !query.formationId.startsWith('t0:')) {
      candidate = this.snapshotById.get(`t0:${query.formationId}`);
    }

    // 3. Fail Closed: 找不到则直接抛出 SnapshotResolutionError
    if (!candidate) {
      throw new SnapshotResolutionError(
        `Failed to resolve exact snapshot for formation '${query.formationId}' (fp: ${query.canonicalFingerprint ?? 'none'}). Fallback to rootSrc is strictly forbidden.`,
        { query }
      );
    }

    // 4. 严格校验传入的 fingerprint (若传入了预期 fingerprint，必须严格匹配)
    if (query.canonicalFingerprint && candidate.canonicalFingerprint !== query.canonicalFingerprint) {
      throw new SnapshotResolutionError(
        `Canonical fingerprint mismatch for '${query.formationId}': queried ${query.canonicalFingerprint}, resolved ${candidate.canonicalFingerprint}`,
        { query, resolvedFp: candidate.canonicalFingerprint }
      );
    }

    // 返回隔离深拷贝副本
    return {
      formationId: candidate.formationId,
      displayName: candidate.displayName,
      canonicalFingerprint: candidate.canonicalFingerprint,
      calculatorPolicyFingerprint: candidate.calculatorPolicyFingerprint,
      team: candidate.team.map(s => ({ monsterId: s.monsterId, badgeIds: [...s.badgeIds] })),
      evol: cloneEvolFormation(candidate.evol),
      provenance: candidate.provenance,
      rootR0SourceId: candidate.rootR0SourceId,
    };
  }

  /**
   * 检查某个 formation 是否已成功注册为 exact snapshot
   */
  public hasSnapshot(formationId: string): boolean {
    if (!this.initialized) this.init();
    return this.snapshotById.has(formationId) || this.snapshotById.has(`t0:${formationId}`);
  }
}

/**
 * 权威全局解析便捷入口函数
 */
export function resolveFormationSnapshot(query: ResolveSnapshotQuery): ResolvedFormationSnapshot {
  return FormationSnapshotResolver.getInstance().resolveFormationSnapshot(query);
}

/**
 * 权威全局注册便捷入口函数
 */
export function registerFormationSnapshot(snapshot: ResolvedFormationSnapshot): void {
  FormationSnapshotResolver.getInstance().registerSnapshot(snapshot);
}
