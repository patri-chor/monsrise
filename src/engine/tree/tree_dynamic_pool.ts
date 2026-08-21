import * as fs from 'node:fs';
import * as path from 'node:path';
import type { EvolFormation } from '../evol_gene';
import { FormationSnapshotResolver } from '../snapshot_resolver';
import { walkEvolNodes } from '../evol_gene';
import { loadProductSources } from '../sources';

export interface PoolMetrics {
  targetW: number;
  targetD: number;
  targetL: number;
  count: number;
  targetScore70Average: number;
  roundWins: number;
  targetHpAverage: number;
}

export interface DynamicPoolEntry {
  formationId: string;
  rootSourceId: string;
  currentSnapshotFingerprint: string;
  previousSnapshotFingerprint: string | null;
  behaviorFingerprint: string;
  currentEvol: EvolFormation;
  l1Metrics?: PoolMetrics;
  l2Metrics?: PoolMetrics;
  score70Aggregate?: number;
  optimizationCycles: number;
  status: 'ACTIVE' | 'REPLACED' | 'RETAINED' | 'ARCHIVED_DUPLICATE';
  lineage: string[];
}

export class TreeDynamicPool {
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

    const sorted = [...active].sort((a, b) => {
      const aScore = a.score70Aggregate ?? -1;
      const bScore = b.score70Aggregate ?? -1;
      if (aScore !== bScore) return aScore - bScore;
      if (a.optimizationCycles !== b.optimizationCycles) return a.optimizationCycles - b.optimizationCycles;
      return a.currentSnapshotFingerprint.localeCompare(b.currentSnapshotFingerprint);
    });

    const selected = sorted.slice(0, limit);
    return {
      selected,
      reason: `Selected up to ${limit} active diverse dynamic pool formations prioritized by lower aggregate Score70 and fewest optimization cycles.`,
    };
  }

  public selectTopFormations(count = 3): DynamicPoolEntry[] {
    const { selected } = this.selectPilotCandidates(count);
    return selected;
  }

  public replaceEntry(formationId: string, updated: Partial<DynamicPoolEntry>): DynamicPoolEntry[] {
    const idx = this.entries.findIndex(e => e.formationId === formationId);
    if (idx !== -1) {
      this.entries[idx] = { ...this.entries[idx], ...updated };
      this.save();
    }
    return this.entries;
  }
}
