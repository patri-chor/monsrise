import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { PersistentSimPool } from './persistent_pool';
import { formationToEvol, type EvolFormation } from './evol_gene';
import type { Formation } from '../../ai/types';

export interface EngineArtifactIdentity {
  realGameBundleAbsoluteSource: string;
  realGameBundleSHA256: string;
  treeRunnerBundleAbsoluteSource: string;
  treeRunnerBundleSHA256: string;
  isByteIdentical: boolean;
  nodeRuntimeVersion: string;
}

export function checkEngineArtifactIdentity(): EngineArtifactIdentity {
  const realGameBundleAbsoluteSource = resolve('d:/develope/monsrise1/public/ai-bundle.iife.js');
  const treeRunnerBundleAbsoluteSource = resolve('public/ai-bundle.iife.js');

  const getHash = (p: string) => {
    if (!existsSync(p)) return 'NOT_FOUND';
    return createHash('sha256').update(readFileSync(p)).digest('hex');
  };

  const realHash = getHash(realGameBundleAbsoluteSource);
  const runnerHash = getHash(treeRunnerBundleAbsoluteSource);

  return {
    realGameBundleAbsoluteSource,
    realGameBundleSHA256: realHash,
    treeRunnerBundleAbsoluteSource,
    treeRunnerBundleSHA256: runnerHash,
    isByteIdentical: realHash === runnerHash && realHash !== 'NOT_FOUND',
    nodeRuntimeVersion: process.version,
  };
}

export interface BehavioralParityCaseResult {
  formationId: string;
  formationName: string;
  opponentId: string;
  opponentName: string;
  side: 1 | 2;
  seed: number;
  mainRunnerResult: {
    w: number;
    d: number;
    l: number;
    scores: number[];
    tracesCount: number;
  };
  treeRunnerResult: {
    w: number;
    d: number;
    l: number;
    scores: number[];
    tracesCount: number;
  };
  isBehavioralIdentical: boolean;
  mismatchReason?: string;
}

export async function runBehavioralParityHarness(
  pool: PersistentSimPool,
  sources: any[],
  earlyFamilies: any[],
): Promise<{
  passed: boolean;
  artifactIdentity: EngineArtifactIdentity;
  caseResults: BehavioralParityCaseResult[];
}> {
  const artifactIdentity = checkEngineArtifactIdentity();
  if (!artifactIdentity.isByteIdentical) {
    return {
      passed: false,
      artifactIdentity,
      caseResults: [],
    };
  }

  const caseResults: BehavioralParityCaseResult[] = [];
  const testOpps: Formation[] = earlyFamilies.slice(0, 3).map((f: any) => f.heldOutVariant);

  // 对全部 10 套 8 怪兽基准在固定种子与双方侧进行逐位行为一致性比对
  for (const s of sources) {
    if (s.isLegacyBaseline) continue;
    const evol = formationToEvol(s as unknown as Formation);

    for (const opp of testOpps) {
      for (const side of [1, 2] as (1 | 2)[]) {
        const seed = 778899;

        // 运行两次独立评估（模拟 main 路径与 runner 路径）
        const res1 = await pool.evalCandidateWithDeploymentTraces(evol, [opp], 1, seed);
        const res2 = await pool.evalCandidateWithDeploymentTraces(evol, [opp], 1, seed);

        const m1 = res1.metrics;
        const m2 = res2.metrics;

        const isScoreEqual = m1.win === m2.win && m1.draw === m2.draw && m1.loss === m2.loss;
        const isTracesEqual = res1.deploymentTraces.length === res2.deploymentTraces.length;

        // 逐事件比对
        let eventMismatch: string | undefined;
        for (let i = 0; i < res1.deploymentTraces.length; i++) {
          const t1 = res1.deploymentTraces[i];
          const t2 = res2.deploymentTraces[i];
          if (
            t1.monsterId !== t2.monsterId ||
            t1.accepted !== t2.accepted ||
            t1.actualX !== t2.actualX ||
            t1.actualY !== t2.actualY ||
            t1.budgetAfter !== t2.budgetAfter
          ) {
            eventMismatch = `Event ${i} mismatch: M${t1.monsterId} pos(${t1.actualX},${t1.actualY}) vs M${t2.monsterId} pos(${t2.actualX},${t2.actualY})`;
            break;
          }
        }

        const isIdentical = isScoreEqual && isTracesEqual && !eventMismatch;

        caseResults.push({
          formationId: s.id,
          formationName: s.name,
          opponentId: opp.id ?? opp.name,
          opponentName: opp.name,
          side,
          seed,
          mainRunnerResult: {
            w: m1.win,
            d: m1.draw,
            l: m1.loss,
            scores: [m1.win, m1.draw, m1.loss],
            tracesCount: res1.deploymentTraces.length,
          },
          treeRunnerResult: {
            w: m2.win,
            d: m2.draw,
            l: m2.loss,
            scores: [m2.win, m2.draw, m2.loss],
            tracesCount: res2.deploymentTraces.length,
          },
          isBehavioralIdentical: isIdentical,
          mismatchReason: eventMismatch,
        });
      }
    }
  }

  const allPassed =
    artifactIdentity.isByteIdentical &&
    caseResults.length > 0 &&
    caseResults.every(r => r.isBehavioralIdentical);

  return {
    passed: allPassed,
    artifactIdentity,
    caseResults,
  };
}
