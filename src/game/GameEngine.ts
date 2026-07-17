import { DB_MONSTERS, MonsterData, BadgeData, DB_BADGES } from './Database';
import { badgeOnPlace, badgeGetAtsMultiplier } from './BadgeSystem';

export type GameState =
  | 'TEAM_EDIT'
  | 'PREPARATION_LEFT'
  | 'PREPARATION_RIGHT'
  | 'BATTLE'
  | 'ROUND_END'
  | 'GAME_OVER'
  | 'REPLAY';


export interface PlacedMonster {
  id: string; // Unique combat instance ID
  dbId: number;
  data: MonsterData;
  badges: BadgeData[];
  gridX: number;
  gridY: number;
  initialGridX: number;
  initialGridY: number;
  placedRound: number; // The round it was placed
  team: 1 | 2;
  
  // Real-time battle states
  hp: number;
  maxHp: number;
  atk: number;
  ats: number;
  range: number;
  speed: number;
  shield: number;
  skillCdProgress: number; // in seconds
  flashTime?: number;
  
  // Statuses
  isDead: boolean;
  statusEffects: {
    type: 'poison' | 'bleed' | 'stun' | 'chill' | 'burn' | 'stealth' | 'invincible';
    duration: number;
    value?: number;
    source?: any;
    tickTimer?: number;
  }[];
  state: 'idle' | 'walk' | 'attack' | 'skill';
}

// 10 Teams, each with 8 slots.
// Slot contains monster ID and up to 2/3 badges.
export interface TeamSlot {
  monsterId: number;
  badgeIds: number[];
}

export class GameEngine {
  private static _instance: GameEngine | null = null;
  public static get instance(): GameEngine {
    if (!GameEngine._instance) {
      GameEngine._instance = new GameEngine();
    }
    return GameEngine._instance;
  }

  // State
  public state: GameState = 'TEAM_EDIT';
  public currentRound: number = 1;
  public maxRounds: number = 5;
  public p1Score: number = 0;
  public p2Score: number = 0;
  public lastRoundElapsed: number = 0;
  
  // Modes: 'experimental' (play self left then right) or 'match' (unimplemented)
  public mode: 'experimental' | 'match' = 'experimental';

  // 10 Teams
  public teams: TeamSlot[][] = [];
  public selectedTeamIndex: number = 0;

  // Monsters currently on the board
  public boardMonsters: PlacedMonster[] = [];

  // Match statistics (accumulated for charts at game over)
  public combatStats: {
    monsterId: number;
    name: string;
    team: 1 | 2;
    killCount: number;
    damageDealt: number;
    damageTaken: number;
    healingDone: number;
    healingReceived: number;
  }[] = [];

  // Per-round outcome: 1=P1 won, 2=P2 won, null=draw
  public roundResults: (1 | 2 | null)[] = [];

  // Per-round combat stats snapshots
  public perRoundStats: {
    monsterId: number;
    name: string;
    team: 1 | 2;
    killCount: number;
    damageDealt: number;
    damageTaken: number;
    healingDone: number;
    healingReceived: number;
  }[][] = [];

  // Per-round elapsed times
  public perRoundElapsed: number[] = [];

  // Per-round placement history for replay (both teams, ordered by placement time)
  public placementHistory: {
    team: 1 | 2;
    monsterId: number;
    gridX: number;
    gridY: number;
    orderIdx: number;
  }[][] = [];

  // Current round placements being accumulated
  public currentRoundPlacements: {
    team: 1 | 2;
    monsterId: number;
    gridX: number;
    gridY: number;
    orderIdx: number;
  }[] = [];

  // Saved variables for pre-replay restoration
  public savedStateBeforeReplay: GameState | null = null;
  public savedBoardMonstersBeforeReplay: PlacedMonster[] = [];
  public savedCurrentRoundBeforeReplay: number = 0;

  // Replay flags and seed
  public isReplaying: boolean = false;
  public isReplayPaused: boolean = false;
  private _replaySeed: number = 0;

  public setReplaySeed(seed: number): void {
    this._replaySeed = seed;
  }

  public random(): number {
    // Mulberry32 pseudo-random generator
    let t = this._replaySeed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }


  private constructor() {
    this.loadTeams();
  }

  // Load squad layouts and index from localStorage
  private loadTeams(): void {
    try {
      const savedTeams = localStorage.getItem('monsrise_teams');
      if (savedTeams) {
        this.teams = JSON.parse(savedTeams);
        // Ensure every slot has a badgeIds array to prevent runtime crashes from old localStorage schemas
        for (const team of this.teams) {
          for (const slot of team) {
            if (!slot || typeof slot !== 'object') continue;
            if (!slot.badgeIds) {
              slot.badgeIds = [];
            }
          }
        }
      } else {
        this.initDefaultTeams();
      }
      
      const savedIndex = localStorage.getItem('monsrise_selected_team_index');
      if (savedIndex) {
        this.selectedTeamIndex = parseInt(savedIndex, 10);
      }
    } catch (e) {
      console.error('Failed to load teams from localStorage:', e);
      this.initDefaultTeams();
    }
  }

  // Save squad layouts and index to localStorage
  public saveTeams(): void {
    try {
      localStorage.setItem('monsrise_teams', JSON.stringify(this.teams));
      localStorage.setItem('monsrise_selected_team_index', this.selectedTeamIndex.toString());
    } catch (e) {
      console.error('Failed to save teams to localStorage:', e);
    }
  }

  // Setup default squads so user doesn't start empty
  private initDefaultTeams(): void {
    this.teams = [];
    // 10 teams
    for (let t = 0; t < 10; t++) {
      const team: TeamSlot[] = [];
      // 8 slots per team
      for (let s = 0; s < 8; s++) {
        // Assign some default monsters from DB
        const dbIdx = (t * 8 + s) % DB_MONSTERS.length;
        const monster = DB_MONSTERS[dbIdx];
        const badgeIds: number[] = [];
        // Default empty badges
        team.push({
          monsterId: monster.id,
          badgeIds: badgeIds
        });
      }
      this.teams.push(team);
    }
  }

  // Get active team (8 slots)
  public get activeTeam(): TeamSlot[] {
    return this.teams[this.selectedTeamIndex];
  }

  // Budget calculations
  public getBudgetLimitForRound(round: number): number {
    if (round === 1) return 4;
    if (round === 2) return 8;
    if (round === 3) return 12;
    if (round === 4) return 14;
    return 16;
  }

  public get p1TotalCost(): number {
    return this.boardMonsters
      .filter(m => m.gridX < 5) // Left side
      .reduce((sum, m) => sum + m.data.cost, 0);
  }

  public get p2TotalCost(): number {
    return this.boardMonsters
      .filter(m => m.gridX >= 6) // Right side
      .reduce((sum, m) => sum + m.data.cost, 0);
  }

  public get p1RemainingBudget(): number {
    const limit = this.getBudgetLimitForRound(this.currentRound);
    return limit - this.p1TotalCost;
  }

  public get p2RemainingBudget(): number {
    const limit = this.getBudgetLimitForRound(this.currentRound);
    return limit - this.p2TotalCost;
  }

  // Add monster to board
  public placeMonster(
    slot: TeamSlot,
    gridX: number,
    gridY: number,
    isPlayer1: boolean
  ): PlacedMonster | null {
    // Check bounds & zones
    // P1: columns 0-4. P2: columns 6-10
    if (isPlayer1 && (gridX < 0 || gridX > 4)) return null;
    if (!isPlayer1 && (gridX < 6 || gridX > 10)) return null;
    if (gridY < 0 || gridY > 4) return null;

    // Check if space is occupied
    const existing = this.getMonsterAt(gridX, gridY);
    if (existing) return null;

    // Prevent duplicate: same monster type can only exist once per team
    const teamMonsters = this.boardMonsters.filter(m =>
      isPlayer1 ? m.gridX < 5 : m.gridX >= 6
    );
    if (teamMonsters.some(m => m.dbId === slot.monsterId)) return null;

    const dbMonster = DB_MONSTERS.find(m => m.id === slot.monsterId);
    if (!dbMonster) return null;

    // Check budget
    const remaining = isPlayer1 ? this.p1RemainingBudget : this.p2RemainingBudget;
    if (remaining < dbMonster.cost) {
      return null; // Budget exceeded
    }

    const badges = slot.badgeIds
      .map(id => DB_BADGES.find(b => b.id === id))
      .filter((b): b is BadgeData => !!b);

    const placed: PlacedMonster = {
      id: `${isPlayer1 ? 'p1' : 'p2'}_r${this.currentRound}_x${gridX}_y${gridY}`,
      dbId: dbMonster.id,
      data: dbMonster,
      badges: badges,
      gridX: gridX,
      gridY: gridY,
      initialGridX: gridX,
      initialGridY: gridY,
      placedRound: this.currentRound,
      team: isPlayer1 ? 1 : 2,
      
      hp: dbMonster.hp,
      maxHp: dbMonster.hp,
      atk: dbMonster.atk,
      ats: dbMonster.ats,
      range: dbMonster.range,
      speed: dbMonster.speed,
      shield: 0,
      skillCdProgress: 0,
      
      isDead: false,
      statusEffects: [],
      state: 'idle'
    };

    // Apply immediate badge stat modifications
    badgeOnPlace(placed);
    placed.ats *= badgeGetAtsMultiplier(placed);

    this.boardMonsters.push(placed);

    // Record placement for replay
    const team: 1 | 2 = isPlayer1 ? 1 : 2;
    this.currentRoundPlacements.push({
      team,
      monsterId: dbMonster.id,
      gridX,
      gridY,
      orderIdx: this.currentRoundPlacements.length
    });

    return placed;
  }

  // Remove monster placed in CURRENT round
  public removeMonster(monsterId: string): boolean {
    const idx = this.boardMonsters.findIndex(m => m.id === monsterId);
    if (idx === -1) return false;

    const m = this.boardMonsters[idx];
    // Cannot remove/move monsters from previous rounds
    if (m.placedRound < this.currentRound) {
      return false;
    }

    // Remove from current round placement history too
    const pIdx = this.currentRoundPlacements.findIndex(p => p.monsterId === m.dbId && p.team === m.team);
    if (pIdx !== -1) {
      this.currentRoundPlacements.splice(pIdx, 1);
    }

    this.boardMonsters.splice(idx, 1);
    return true;
  }


  public getMonsterAt(gridX: number, gridY: number): PlacedMonster | null {
    return this.boardMonsters.find(m => m.gridX === gridX && m.gridY === gridY) || null;
  }

  public resetBoardForNextRound(): void {
    // Keep boardMonsters, but restore stats and position from database config
    for (const m of this.boardMonsters) {
      m.hp = m.data.hp;
      m.maxHp = m.data.hp;
      m.atk = m.data.atk;
      m.ats = m.data.ats;
      m.range = m.data.range;
      m.speed = m.data.speed;
      m.shield = 0;
      m.skillCdProgress = 0;
      m.isDead = false;
      m.statusEffects = [];
      (m as any).skillAnimationTimeLeft = 0;
      (m as any).digging = false;
      (m as any).resurrecting = false;
      (m as any).noSprite = false;
      (m as any).phalanxAtkAdded = 0;
      m.gridX = m.initialGridX;
      m.gridY = m.initialGridY;

      // Re-apply badge stat modifications
      badgeOnPlace(m);
    }
  }

  public clearStats(): void {
    this.combatStats = [];
  }

  public isGameOver(): boolean {
    const maxScore = Math.max(this.p1Score, this.p2Score);
    const minScore = Math.min(this.p1Score, this.p2Score);
    const remainingRounds = this.maxRounds - this.currentRound;
    return maxScore >= 3 || (maxScore > minScore + remainingRounds) || this.currentRound >= this.maxRounds;
  }

  public recordStat(monster: PlacedMonster, dmgD: number, dmgT: number, heal: number, healRcv: number = 0, kills: number = 0): void {
    let stat = this.combatStats.find(s => s.monsterId === monster.dbId && s.team === monster.team);
    if (!stat) {
      stat = {
        monsterId: monster.dbId,
        name: monster.data.name,
        team: monster.team,
        killCount: 0,
        damageDealt: 0,
        damageTaken: 0,
        healingDone: 0,
        healingReceived: 0
      };
      this.combatStats.push(stat);
    }
    stat.killCount += kills;
    stat.damageDealt += dmgD;
    stat.damageTaken += dmgT;
    stat.healingDone += heal;
    stat.healingReceived += healRcv;
  }

  public saveRoundStats(elapsed: number): void {
    // Snapshot current round stats
    this.perRoundStats.push(this.combatStats.map(s => ({ ...s })));
    this.perRoundElapsed.push(elapsed);
    // Snapshot placement history
    this.placementHistory.push([...this.currentRoundPlacements]);
    this.currentRoundPlacements = [];
    // Reset combat stats for next round
    this.combatStats = [];
  }

  public restartGame(): void {
    this.currentRound = 1;
    this.p1Score = 0;
    this.p2Score = 0;
    this.lastRoundElapsed = 0;
    this.boardMonsters = [];
    this.roundResults = [];
    this.perRoundStats = [];
    this.perRoundElapsed = [];
    this.placementHistory = [];
    this.currentRoundPlacements = [];
    this.clearStats();
    this.state = 'TEAM_EDIT';
  }
}
export const gameEngine = GameEngine.instance;
