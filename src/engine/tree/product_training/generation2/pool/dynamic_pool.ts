import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DynamicPoolEntry } from './types';
import { FormationSnapshotResolver } from '../../snapshot_resolver';
import { walkEvolNodes } from '../../../evol_gene';
import { loadProductSources } from '../../01_sources';

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

    // 动态从产品源目录中发现所有可用源 (Programmatic Discovery without hard-coded IDs)
    const sources = loadProductSources();
    const seenBehavior = new Set<string>();

    this.entries = sources.executable.map(src => {
      const fid = `t0:${src.id}`;
      const snap = resolver.resolveFormationSnapshot({ formationId: fid });
      const nodes = walkEvolNodes(snap.evol.root);
      const bFp = `${src.id}_${nodes.length}_${nodes.map(n => n.round + ':' + JSON.stringify(n.condition) + ':' + n.placements.map(p => `${p.monsterId}@${p.x},${p.y}`).join(',')).join(';')}`;

      const isDup = seenBehavior.has(bFp);
      seenBehavior.add(bFp);

      const entry: DynamicPoolEntry = {
        formationId: fid,
        rootSourceId: src.id,
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
