import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DynamicPoolEntry } from './types';
import { FormationSnapshotResolver } from '../../snapshot_resolver';
import { walkEvolNodes } from '../../../evol_gene';

export class DynamicPoolManager {
  private poolFilePath: string;
  private entries: DynamicPoolEntry[] = [];

  constructor(poolFilePath?: string) {
    this.poolFilePath = poolFilePath ?? path.join(process.cwd(), 'reports', 'tree-cycle', 'dynamic-t0-pool', 'current_pool.json');
  }

  public initOrLoad(): DynamicPoolEntry[] {
    if (fs.existsSync(this.poolFilePath)) {
      const data = JSON.parse(fs.readFileSync(this.poolFilePath, 'utf-8'));
      this.entries = data.entries ?? [];
      return this.entries;
    }

    const resolver = FormationSnapshotResolver.getInstance();
    resolver.init();

    // 初始化加载所有 T0 阵型作为动态池候选
    const t0Ids = ['t0:all2rush', 't0:golden_boom', 't0:all2prayer', 't0:gift_jungle'];
    const seenBehavior = new Set<string>();

    this.entries = t0Ids.map(fid => {
      const snap = resolver.resolveFormationSnapshot({ formationId: fid });
      const nodes = walkEvolNodes(snap.evol.root);
      const bFp = `${fid}_${nodes.length}_${nodes.map(n => n.round + ':' + n.placements.map(p => p.monsterId).join(',')).join(';')}`;

      const isDup = seenBehavior.has(bFp);
      seenBehavior.add(bFp);

      const entry: DynamicPoolEntry = {
        formationId: fid,
        rootSourceId: fid,
        currentSnapshotFingerprint: snap.canonicalFingerprint,
        previousSnapshotFingerprint: null,
        behaviorFingerprint: bFp,
        currentEvol: snap.evol,
        optimizationCycles: 0,
        status: isDup ? 'ARCHIVED_DUPLICATE' : 'ACTIVE',
        lineage: [snap.canonicalFingerprint],
      };
      return entry;
    });

    this.save();
    return this.entries;
  }

  public getEntries(): DynamicPoolEntry[] {
    return this.entries;
  }

  public getActiveEntries(): DynamicPoolEntry[] {
    return this.entries.filter(e => e.status === 'ACTIVE');
  }

  public save(): void {
    const dir = path.dirname(this.poolFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.poolFilePath, JSON.stringify({ entries: this.entries, updatedAt: new Date().toISOString() }, null, 2), 'utf-8');
  }

  public selectPilotCandidates(limit = 3): { selected: DynamicPoolEntry[]; reason: string } {
    const active = this.getActiveEntries();

    // 按得分指标/优化周期/指纹确定性排序
    const sorted = [...active].sort((a, b) => {
      const aScore = a.score70Aggregate ?? -1;
      const bScore = b.score70Aggregate ?? -1;
      if (aScore !== bScore) return aScore - bScore; // 优先选择得分较低（较弱）需要优化的阵型
      if (a.optimizationCycles !== b.optimizationCycles) return a.optimizationCycles - b.optimizationCycles;
      return a.currentSnapshotFingerprint.localeCompare(b.currentSnapshotFingerprint);
    });

    const selected = sorted.slice(0, limit);
    return {
      selected,
      reason: `Selected up to ${limit} active diverse dynamic pool formations prioritized by lower aggregate Score70 and fewest optimization cycles.`,
    };
  }
}
