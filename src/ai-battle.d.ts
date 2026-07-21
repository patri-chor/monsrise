// Type declarations for BattleAI global (loaded via ai-bundle.iife.js)

interface AIAction {
  monsterId: number;
  badgeIds: number[];
  x: number;
  y: number;
}

interface AIDecision {
  action: AIAction | null;
  log?: any;
}

interface AIBuildTeamResult {
  cards: { monsterId: number; badgeIds: number[] }[];
  formationName: string;
  archetype: string;
  matchScore: number;
}

interface AIFormationResult {
  handIds: Set<number>;
  formation: { id: string; name: string; archetype: string; team: { monsterId: number; badgeIds: number[] }[] };
  score: number;
  matches: any[];
}

interface AIGameState {
  board: (any | null)[][];
  players: {
    p1: { side: string; deployed: any[]; remainingBudget: number };
    p2: { side: string; deployed: any[]; remainingBudget: number };
  };
  round: number;
  phase: string;
  currentPlayer: string;
  nextInstanceId: number;
}

interface AICard {
  monsterId: number;
  badgeIds: number[];
}

declare class BattleAI {
  constructor();
  createGame(): AIGameState;
  cloneGame(state: AIGameState): AIGameState;
  getAvailableSlots(state: AIGameState): { x: number; y: number }[];
  getRoundBudget(round: number): number;
  buildTeam(hand: AICard[]): AIBuildTeamResult;
  setDifficulty(level: 'easy' | 'normal' | 'hard'): void;
  setSearchDepth(depth: number): void;
  setFormationMode(on: boolean): void;
  resetFormation(): void;
  decide(state: AIGameState, side?: string): AIDecision;
  decideWithCards(state: AIGameState, cards: AICard[], side?: string): AIDecision;
  decideWithFormation(hand: any[], round: number, state: AIGameState): any;
  validateAction(state: AIGameState, action: AIAction): { valid: boolean; error?: string };
  applyAction(state: AIGameState, action: AIAction): AIGameState;
  advancePhase(state: AIGameState): AIGameState;
  getBadge(id: number): any;
}
