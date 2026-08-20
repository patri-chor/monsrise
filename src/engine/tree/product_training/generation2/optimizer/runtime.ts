import * as path from 'node:path';
import { Persistence } from './persistence';
import type { OptimizerEvent } from './run_events';
import type { DerivedRuntimeState } from './runtime_state';
import { reduceOptimizerEvent, reconstructStateFromEvents, createInitialRuntimeState } from './runtime_state';
import type { OptimizerConfig } from './config';
import { FormationSnapshotResolver } from '../../snapshot_resolver';
import { AdverseCaseMiner } from './adverse_case_miner';
import { CandidateSpace } from './candidate_space';
import { RoundBoardStateFactory, type RoundBoardEdit } from '../round_board_state_factory';
import { SingleRoundEngine } from '../single_round_engine';
import { evaluateObjectiveVector, dominates, compareObjective } from './objective';
import { ForwardCompiler } from './forward_compiler';
import { Validator } from './validation';
import { mulberry32 } from '../../../../play_full_game';

export class OptimizerRuntime {
  private state: DerivedRuntimeState;
  private journalPath: string;
  private runDir: string;

  constructor(runDir: string, initialConfig: OptimizerConfig, runId: string) {
    this.runDir = runDir;
    this.journalPath = path.join(runDir, 'events.jsonl');
    this.state = createInitialRuntimeState(runId, initialConfig);
  }

  public static createNew(runDir: string, config: OptimizerConfig, runId: string): OptimizerRuntime {
    Persistence.ensureDir(runDir);
    const runtime = new OptimizerRuntime(runDir, config, runId);
    runtime.emit('RUN_CREATED', {
      config,
      targetFormationId: config.targetFormationId,
      searchSeed: config.searchSeed,
    });
    return runtime;
  }

  public static loadExisting(runDir: string, initialConfig: OptimizerConfig): OptimizerRuntime {
    const journalPath = path.join(runDir, 'events.jsonl');
    const events = Persistence.readJsonl<OptimizerEvent>(journalPath);
    if (events.length === 0) {
      throw new Error(`Cannot resume from empty event journal in ${runDir}`);
    }
    const first = events[0];
    const runtime = new OptimizerRuntime(runDir, first.payload.config ?? initialConfig, first.runId);
    runtime.state = reconstructStateFromEvents(events, initialConfig);
    return runtime;
  }

  public getState(): DerivedRuntimeState {
    return this.state;
  }

  public emit<T>(type: OptimizerEvent['type'], payload: T, customEventId?: string): OptimizerEvent<T> {
    const sequence = this.state.eventSequence + 1;
    const eventId = customEventId ?? `EVT_${this.state.runId}_seq${sequence}_${type}`;

    if (this.state.seenEventIds.has(eventId)) {
      throw new Error(`Duplicate event ID detected before append: ${eventId}`);
    }

    const event: OptimizerEvent<T> = {
      eventId,
      schemaVersion: 'G2_OPTIMIZER_EVENT_V1',
      runId: this.state.runId,
      sequence,
      type,
      timestamp: new Date().toISOString(),
      payload,
    };

    Persistence.appendJsonl(this.journalPath, [event]);
    this.state = reduceOptimizerEvent(this.state, event);
    return event;
  }

  public syncMaterializedProjections(): void {
    Persistence.writeJson(path.join(this.runDir, 'config.json'), this.state.config);
    Persistence.writeJson(path.join(this.runDir, 'manifest.json'), {
      runId: this.state.runId,
      targetFormationId: this.state.config.targetFormationId,
      searchSeed: this.state.config.searchSeed,
      maxGenerations: this.state.config.maxGenerations,
      populationSize: this.state.config.populationSize,
      uniqueCandidatesPerCase: this.state.config.uniqueCandidatesPerCase,
      currentPhase: this.state.currentPhase,
      totalCasesSelected: this.state.baselineCases.length,
    });

    Persistence.writeJsonl(path.join(this.runDir, 'baseline_cases.jsonl'), this.state.baselineCases);
    Persistence.writeJsonl(path.join(this.runDir, 'candidates.jsonl'), this.state.candidates);
    Persistence.writeJsonl(path.join(this.runDir, 'evaluations.jsonl'), this.state.evaluations);
    Persistence.writeJsonl(path.join(this.runDir, 'archive.jsonl'), this.state.archiveEntries);
    Persistence.writeJsonl(path.join(this.runDir, 'generations.jsonl'), this.state.generations);
    Persistence.writeJsonl(path.join(this.runDir, 'forward_candidates.jsonl'), this.state.forwardCandidates);
    Persistence.writeJsonl(path.join(this.runDir, 'validations.jsonl'), this.state.validations);
    Persistence.writeJsonl(path.join(this.runDir, 'diagnostics.jsonl'), this.state.diagnostics);

    Persistence.writeJson(path.join(this.runDir, 'checkpoint.json'), {
      runId: this.state.runId,
      config: this.state.config,
      currentPhase: this.state.currentPhase,
      completedGenerationsByCase: this.state.completedGenerationsByCase,
      completedFingerprintsByCase: this.state.completedFingerprintsByCase,
      summary: this.state.summary,
    });

    if (this.state.summary) {
      Persistence.writeJson(path.join(this.runDir, 'summary.json'), this.state.summary);
    }
  }

  public async advanceStateMachine(stopAfterPhase?: string): Promise<DerivedRuntimeState> {
    const resolver = FormationSnapshotResolver.getInstance();
    resolver.init();

    const targetSnap = resolver.resolveFormationSnapshot({ formationId: this.state.config.targetFormationId });
    const oppSnaps = (this.state.config.opponentFormationIds ?? [
      't0:golden_boom',
      't0:all2prayer',
      't0:gift_jungle',
    ]).map(fid => resolver.resolveFormationSnapshot({ formationId: fid }));

    // PHASE 1: BASELINE
    if (this.state.currentPhase === 'BASELINE') {
      if (this.state.baselineCases.length === 0) {
        const { selectedCases, diagnostics } = AdverseCaseMiner.mineAdverseCases(targetSnap, oppSnaps, this.state.config);
        for (const c of selectedCases) {
          this.emit('BASELINE_CASE_CAPTURED', c, `EVT_BASE_${this.state.runId}_${c.caseId}`);
          this.emit('BASELINE_PARITY_CHECKED', {
            caseId: c.caseId,
            passed: c.parityPassed,
            parityFields: c.parityFields,
          }, `EVT_PARITY_${this.state.runId}_${c.caseId}`);
        }
        for (const d of diagnostics) {
          this.emit('DIAGNOSTIC_RECORDED', d);
        }
      }
      this.emit('PHASE_COMPLETED', { phase: 'BASELINE' });
      this.syncMaterializedProjections();
      if (stopAfterPhase === 'BASELINE') return this.state;
    }

    // PHASE 2: SEARCH
    if (this.state.currentPhase === 'SEARCH') {
      let caseIdx = 0;
      for (const c of this.state.baselineCases) {
        caseIdx++;
        const targetPerGen = Math.min(
          this.state.config.populationSize,
          Math.max(1, Math.floor(this.state.config.uniqueCandidatesPerCase / this.state.config.maxGenerations))
        );

        const startGen = (this.state.completedGenerationsByCase[c.caseId] ?? 0) + 1;

        for (let gen = startGen; gen <= this.state.config.maxGenerations; gen++) {
          if (this.state.config.stopAfterGeneration && gen > this.state.config.stopAfterGeneration) {
            break;
          }

          const rng = mulberry32((this.state.config.searchSeed * 104729 + caseIdx * 7919 + gen * 32452843 + c.round * 15485863) >>> 0);

          const completedFps = new Set<string>(this.state.completedFingerprintsByCase[c.caseId] ?? []);
          const caseEntries = this.state.archiveEntries.filter(e => e.caseId === c.caseId);
          const nonDomParents = caseEntries.filter(e => !e.isDominated);
          const parentPool = nonDomParents.length > 0 ? nonDomParents : caseEntries;

          let proposalsCount = 0;
          let invalidCount = 0;
          let duplicateCount = 0;
          let uniqueThisGen = 0;
          let randomCount = 0;
          let mutationCount = 0;
          let crossoverCount = 0;
          const selectedParents: string[] = [];

          // 计算本代配额与 lifetime cap 约束
          const isLastGen = gen === this.state.config.maxGenerations;
          const cumulativeCap = this.state.config.uniqueCandidatesPerCase;
          const currentCumulative = completedFps.size - 1; // 去掉 base
          const remainingCap = Math.max(0, cumulativeCap - currentCumulative);
          const desiredUniqueThisGen = isLastGen ? remainingCap : Math.min(targetPerGen, remainingCap);

          while (uniqueThisGen < desiredUniqueThisGen && proposalsCount < desiredUniqueThisGen * 25) {
            proposalsCount++;

            let edits: RoundBoardEdit[] = [];
            const rType = rng();

            if (gen > 1 && parentPool.length >= 2 && rType < 0.3) {
              // Crossover: 从两位父代组合编辑
              crossoverCount++;
              const p1 = parentPool[Math.floor(rng() * parentPool.length)];
              const p2 = parentPool[Math.floor(rng() * parentPool.length)];
              selectedParents.push(p1.candidateId, p2.candidateId);
              edits = [...p1.edits.slice(0, 1), ...p2.edits.slice(0, 1)];
            } else if (gen > 1 && parentPool.length > 0 && rType < 0.6) {
              // Mutation: 从单父代变异
              mutationCount++;
              const p1 = parentPool[Math.floor(rng() * parentPool.length)];
              selectedParents.push(p1.candidateId);
              edits = CandidateSpace.mutateEdits(p1.edits, c.baseState, rng);
            } else {
              // Random Exploration
              randomCount++;
              edits = CandidateSpace.sampleCompatibleEdits(c.baseState, rng);
            }

            if (edits.length === 0) {
              invalidCount++;
              this.emit('CANDIDATE_REJECTED', {
                candidateId: `PROP_${c.caseId}_g${gen}_p${proposalsCount}`,
                caseId: c.caseId,
                generation: gen,
                reason: 'no_legal_edits',
              });
              continue;
            }

            const candidateState = RoundBoardStateFactory.cloneWithEdits(c.baseState, edits);
            const fp = candidateState.stateFingerprint;

            if (completedFps.has(fp)) {
              duplicateCount++;
              continue;
            }

            // 校验碰撞
            const occupied = new Set<string>();
            let collision = false;
            for (const u of candidateState.deployedUnits) {
              const key = `${u.originalX},${u.originalY}`;
              if (occupied.has(key)) {
                collision = true;
                break;
              }
              occupied.add(key);
            }

            if (collision) {
              invalidCount++;
              this.emit('CANDIDATE_REJECTED', {
                candidateId: `PROP_${c.caseId}_g${gen}_p${proposalsCount}`,
                caseId: c.caseId,
                generation: gen,
                reason: 'collision_deployed_unit',
              });
              continue;
            }

            completedFps.add(fp);
            uniqueThisGen++;

            const candId = `CAND_${c.caseId}_g${gen}_u${uniqueThisGen}`;
            this.emit('CANDIDATE_PROPOSED', {
              candidateId: candId,
              caseId: c.caseId,
              generation: gen,
              sourceType: crossoverCount > mutationCount ? 'CROSSOVER' : mutationCount > 0 ? 'MUTATION' : 'RANDOM',
              parentCandidateIds: selectedParents.slice(-2),
              edits,
              editedStateFingerprint: fp,
            });

            const res = SingleRoundEngine.runSingleRound(candidateState);
            const obj = evaluateObjectiveVector(res, c.targetSide, edits.length);

            this.emit('CANDIDATE_EVALUATED', {
              candidateId: candId,
              caseId: c.caseId,
              generation: gen,
              editedStateFingerprint: fp,
              result: res,
              objective: obj,
            });

            this.emit('ARCHIVE_ENTRY_ADDED', {
              candidateId: candId,
              caseId: c.caseId,
              entryKey: `${c.caseId}_${fp}_${res.observableOutput.observableDigest}`,
              editedStateFingerprint: fp,
              edits,
              objective: obj,
              observableDigest: res.observableOutput.observableDigest,
            });
          }

          // 计算本 Case 支配性与代表解
          const currentCaseEntries = this.state.archiveEntries.filter(e => e.caseId === c.caseId);
          const dominatedIds: string[] = [];

          for (let i = 0; i < currentCaseEntries.length; i++) {
            for (let j = 0; j < currentCaseEntries.length; j++) {
              if (i === j) continue;
              if (dominates(currentCaseEntries[j].objective, currentCaseEntries[i].objective)) {
                dominatedIds.push(currentCaseEntries[i].candidateId);
                break;
              }
            }
          }

          const nonDomPool = currentCaseEntries.filter(e => !dominatedIds.includes(e.candidateId));
          const repPool = nonDomPool.length > 0 ? nonDomPool : currentCaseEntries;
          repPool.sort((a, b) => compareObjective(b.objective, a.objective));

          const rep = repPool[0];
          this.emit('ARCHIVE_DOMINANCE_UPDATED', {
            caseId: c.caseId,
            dominatedCandidateIds: dominatedIds,
            representativeCandidateId: rep?.candidateId,
            representativeReason: rep ? `Highest Pareto rank, target HP ${rep.objective.targetSurvivingHp}, edits ${rep.objective.editCount}` : undefined,
          });

          this.emit('GENERATION_COMPLETED', {
            generation: gen,
            caseId: c.caseId,
            requestedPopulation: desiredUniqueThisGen,
            remainingBefore: remainingCap,
            remainingAfter: Math.max(0, remainingCap - uniqueThisGen),
            randomProposalCount: randomCount,
            mutationProposalCount: mutationCount,
            crossoverProposalCount: crossoverCount,
            selectedParentIds: Array.from(new Set(selectedParents)),
            validCount: uniqueThisGen,
            invalidCount,
            duplicateCount,
            uniqueEvaluationsThisGen: uniqueThisGen,
            cumulativeUniqueForCase: completedFps.size - 1,
            archiveFrontierCount: nonDomPool.length,
            exhaustionReason: remainingCap === 0 ? 'CASE_CAP_REACHED' : 'N/A',
          });
        }
      }

      // 如果所有 Case 都达到目标世代，才结束 SEARCH 阶段
      const allDone = this.state.baselineCases.every(c => (this.state.completedGenerationsByCase[c.caseId] ?? 0) >= this.state.config.maxGenerations);
      if (allDone) {
        this.emit('PHASE_COMPLETED', { phase: 'SEARCH' });
      }
      this.syncMaterializedProjections();
      if (stopAfterPhase === 'SEARCH' || !allDone) return this.state;
    }

    // PHASE 3: COMPILE
    if (this.state.currentPhase === 'COMPILE') {
      const reps = this.state.archiveEntries.filter(e => e.isRepresentative);
      for (const rep of reps) {
        const adverseCase = this.state.baselineCases.find(c => c.caseId === rep.caseId)!;
        const oppSnap = oppSnaps.find(o => o.displayName === adverseCase.opponentDisplayName)!;
        const comp = ForwardCompiler.compileRepresentative(rep, adverseCase, oppSnap);
        this.emit('FORWARD_CANDIDATE_COMPILED', comp, `EVT_COMPILE_${this.state.runId}_${rep.candidateId}`);
      }
      this.emit('PHASE_COMPLETED', { phase: 'COMPILE' });
      this.syncMaterializedProjections();
      if (stopAfterPhase === 'COMPILE') return this.state;
    }

    // PHASE 4: VALIDATE
    if (this.state.currentPhase === 'VALIDATE') {
      const { validations, activeBranches } = Validator.runValidation(
        this.state.forwardCandidates,
        this.state.baselineCases,
        targetSnap,
        oppSnaps,
        this.state.config
      );

      for (const v of validations) {
        this.emit('VALIDATION_COMPLETED', v);
      }

      for (const fc of this.state.forwardCandidates) {
        const isActive = activeBranches.some(a => a.candidateId === fc.candidateId);
        this.emit('FORWARD_STATUS_CHANGED', {
          candidateId: fc.candidateId,
          fromStatus: 'COMPILED',
          toStatus: isActive ? 'PILOT_ACTIVE' : 'FORWARD_REJECTED',
          reason: isActive ? undefined : 'Regressed on validation benchmark',
        });
      }

      this.emit('PHASE_COMPLETED', { phase: 'VALIDATE' });

      // RUN_COMPLETED
      const totalUnique = Object.values(this.state.completedFingerprintsByCase).reduce((sum, fps) => sum + Math.max(0, fps.length - 1), 0);
      const summary = {
        runId: this.state.runId,
        totalCasesMined: this.state.baselineCases.length,
        totalUniqueEvaluations: totalUnique,
        archiveSize: this.state.archiveEntries.length,
        nonDominatedSolutionsCount: this.state.archiveEntries.filter(e => !e.isDominated).length,
        representativesCount: this.state.archiveEntries.filter(e => e.isRepresentative).length,
        activePilotBranchesCount: activeBranches.length,
      };

      this.emit('RUN_COMPLETED', { summary });
      this.syncMaterializedProjections();
    }

    return this.state;
  }
}
