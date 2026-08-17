import '../env';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { Formation } from '../../ai/types';
import type { EvolFormation } from './evol_gene';
import { formationToEvol } from './evol_gene';
import { mapRefTreeToDeck } from './deck_separation';
import { evaluateBatchParallel } from './arena_parallel';
import {
  costOf,
  classifyDeck,
  validateDeck,
  poolForTemplate,
  badgeTemplateFor,
} from './deck_ontology';
import { COMBO_MODULES } from './flow_library';
import { optimizeFormation } from './branch_induct';

export const DEFAULT_OUTPUT_DIR = resolve('reports/new-formation-generation/first-four-cycle');

export interface SeedManifest {
  timestamp: string;
  seedCount: number;
  sourceSeeds: {
    index: number;
    id: string;
    name: string;
    archetype: string;
    cost: number;
  }[];
  panelCount: number;
  evaluationPanel: {
    index: number;
    id: string;
    name: string;
    archetype: string;
  }[];
  effectiveSettings: {
    attemptsPerSeed: number;
    maxRetained: number;
    explorationFloor: number;
    workers: number;
    coarseGames: number;
    coarseSeedBase: number;
    treeSearchSeedBase?: number;
    treeValSeedBase?: number;
  };
}

export interface GeneratedCandidateRecord {
  candidateId: string;
  sourceSeedIndex: number;
  sourceSeedName: string;
  sourceSeedId: string;
  generationSeed: number;
  attemptIndex: number;
  archPath: string;
  modulePath: string;
  coreKey: string;
  referenceFormation: string;
  team: { monsterId: number; badgeIds: number[] }[];
  treeFingerprint: string;
  canonicalKey: string;
  tree: any;
  validation: {
    valid: boolean;
    cost: number;
    size: number;
    hasTactic: boolean;
  };
  coarseEvaluation?: {
    adScore: number;
    winRate: number;
    drawRate: number;
    lossRate: number;
    totalGames: number;
    seedBase: number;
    games: number;
    workers: number;
  };
}

/**
 * 运行时解析 Canonical Source Seeds 与 8 对手 Evaluation Panel
 */
export function resolveSeedsAndPanel(): {
  sourceSeeds: Formation[];
  evaluationPanel: Formation[];
} {
  const sourceSeeds = FORMATION_LIBRARY.slice(0, 4);
  if (sourceSeeds.length !== 4) {
    throw new Error(`[Seed Resolution Error] Expected 4 source seeds from FORMATION_LIBRARY.slice(0, 4), found ${sourceSeeds.length}`);
  }

  const firstSeven = FORMATION_LIBRARY.slice(0, 7);
  const goldenMonkey = FORMATION_LIBRARY.find(f => f.name === '壕炸金猴');

  if (!goldenMonkey) {
    throw new Error(`[Panel Resolution Error] Eighth opponent named '壕炸金猴' not found in FORMATION_LIBRARY.`);
  }

  const firstSevenNames = new Set(firstSeven.map(f => f.name));
  if (firstSevenNames.has('壕炸金猴')) {
    throw new Error(`[Panel Resolution Error] '壕炸金猴' is already among the first seven formations in FORMATION_LIBRARY.`);
  }

  const evaluationPanel = [...firstSeven, goldenMonkey];
  if (evaluationPanel.length !== 8) {
    throw new Error(`[Panel Resolution Error] Evaluation panel must contain exactly 8 opponents, found ${evaluationPanel.length}`);
  }

  return { sourceSeeds, evaluationPanel };
}
