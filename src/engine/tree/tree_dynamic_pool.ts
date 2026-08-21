import * as fs from 'node:fs';
import * as path from 'node:path';
import { DynamicPoolManager as BaseDynamicPoolManager } from './product_training/generation2/pool/dynamic_pool';
import type { DynamicPoolEntry } from './product_training/generation2/pool/types';

export class TreeDynamicPool {
  private poolPath: string;
  private manager: BaseDynamicPoolManager;

  constructor(poolPath?: string) {
    this.poolPath = poolPath ?? path.join(process.cwd(), 'reports', 'tree-cycle', 'dynamic_t0_pool.json');
    this.manager = new BaseDynamicPoolManager(this.poolPath);
  }

  public initOrLoad(): DynamicPoolEntry[] {
    return this.manager.initOrLoad();
  }

  public selectTopFormations(count = 3): DynamicPoolEntry[] {
    const { selected } = this.manager.selectPilotCandidates(count);
    return selected;
  }

  public replaceEntry(formationId: string, updated: Partial<DynamicPoolEntry>): DynamicPoolEntry[] {
    const entries = this.manager.getEntries();
    const idx = entries.findIndex(e => e.formationId === formationId);
    if (idx !== -1) {
      entries[idx] = { ...entries[idx], ...updated };
      this.manager.save();
    }
    return entries;
  }
}
