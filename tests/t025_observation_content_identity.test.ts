import * as assertStrict from 'node:assert/strict';
import { buildObservationKey, getCandidateObservationFingerprint, getSourceFixtureObservationFingerprint } from '../src/engine/tree/experience_training_pipeline';

const base = { team: [{ monsterId: 110, badgeIds: [23, 8] }], tree: { id: 'root', placements: [{ monsterId: 110, x: 9, y: 2 }], children: [] } };
const moved = { team: [{ monsterId: 110, badgeIds: [23, 8] }], tree: { id: 'root', placements: [{ monsterId: 110, x: 9, y: 3 }], children: [] } };
const badgeChanged = { team: [{ monsterId: 110, badgeIds: [8, 23] }], tree: base.tree };
const baseFingerprint = getCandidateObservationFingerprint(base);
assertStrict.notEqual(baseFingerprint, getCandidateObservationFingerprint(moved));
assertStrict.notEqual(baseFingerprint, getCandidateObservationFingerprint(badgeChanged));
assertStrict.notEqual(getSourceFixtureObservationFingerprint([{ id: 'source-a', version: 1 }]), getSourceFixtureObservationFingerprint([{ id: 'source-a', version: 2 }]));
const smokeKey = buildObservationKey({ schemaVersion: '1.2.0', protocolVersion: 'T024_COMPLETE_RUN_IDENTITY', runKind: 'SMOKE', phase: 'screen', candidateId: 'cand', candidateFp: baseFingerprint, sourceFixtureFp: getSourceFixtureObservationFingerprint([{ id: 'source-a', version: 1 }]), panelId: 'early-seven', sideCoverage: 'both', seedScheduleId: 'schedule-1', gamesPerCell: 1, codeCommit: 'test' });
const formalKey = buildObservationKey({ schemaVersion: '1.2.0', protocolVersion: 'T024_COMPLETE_RUN_IDENTITY', runKind: 'FORMAL_SCREEN', phase: 'screen', candidateId: 'cand', candidateFp: baseFingerprint, sourceFixtureFp: getSourceFixtureObservationFingerprint([{ id: 'source-a', version: 1 }]), panelId: 'early-seven', sideCoverage: 'both', seedScheduleId: 'schedule-1', gamesPerCell: 10, codeCommit: 'test' });
assertStrict.notEqual(smokeKey, formalKey);
console.log('T025 observation content identity passed');