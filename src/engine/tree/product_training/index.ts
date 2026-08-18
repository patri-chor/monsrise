// ============================================================
// T036 Phase-1 — index.ts
// 明确公共导出（只暴露 Phase-1 所有权文件的接口）
// ============================================================

// 01_sources
export {
  SOURCES_PATH,
  GIFT_JUNGLE_ID,
  loadProductSources,
  computeSourceFingerprint,
  assertNoGiftJungleV2,
} from './01_sources';
export type { SourceRecord, LoadedSources } from './01_sources';

// 02_candidates
export {
  makeBaselineMeta,
  makeCandidateId,
  isLegalP2Coord,
  getControllablePlacements,
  computeCandidateFingerprint,
} from './02_candidates';
export type {
  OperatorFamily,
  CandidateMetadata,
  CandidateDelta,
  SpatialLocalDelta,
  FormationTransformDelta,
  FormationTransformKind,
  StrategyScheduleBranchDelta,
  MultiMonsterExplorationMeta,
} from './02_candidates';

// 03_validate
export {
  validateCandidateLegality,
  validateGiftJungleRepair,
  rejectIfNoOp,
  validateSpatialLocalDelta,
  validateFormationTransformDelta,
  validateBranchObservability,
} from './03_validate';
export type { ValidationResult } from './03_validate';

// branch_semantics
export {
  conditionObservabilityLevel,
  isR1Observable,
  r1InputToArchetypeInput,
  r2PlusInputToArchetypeInput,
  selectBranchForSideAndRound,
  treeXToProductX,
  productXToTreeX,
  getR1BranchSelection,
  listR1Branches,
  isSideOnlyCondition,
  isSidePlusOpponentFeatureCondition,
  hasFutureStateCondition,
} from './branch_semantics';
export type {
  R1Observable,
  R2PlusObservable,
  ObservabilityLevel,
} from './branch_semantics';
