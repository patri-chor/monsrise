// ============================================================
// src/ui/L1MeleeChallengeManager.ts
// T046 前端 L1 Melee 挑战管理器与玩家本地历史记录 (Client-Side Challenge & History)
//
// 规范要求：
//   - 动态加载 /data/l1_melee_challenge_catalog.json (带 localStorage 缓存 fallback)
//   - 根流派均匀抽样 + 流派内平滑权重抽样
//   - 使用真实树策略 (treeStrategyFor) 执行 AI 放置
//   - 玩家对战历史纯本地 localStorage 持久化 (上限 200 条)，与训练数据物理隔离
// ============================================================

import type { EvolFormation } from '../engine/tree/evol_gene';
import { treeStrategyFor } from '../engine/tree/product_tree_strategy';

export interface L1ChallengeMember {
  memberId: string;
  name: string;
  rootSourceId: string;
  canonicalFingerprint: string;
  originKind: string;
  smoothedWeight: number;
  rawStrengthScore: number;
  team: { monsterId: number; badgeIds: number[] }[];
  evol: EvolFormation;
}

export interface L1ChallengeArchetype {
  archetypeId: string;
  rootSourceId: string;
  displayName: string;
  uniformSelectionWeight: number;
  totalMembers: number;
  members: L1ChallengeMember[];
}

export interface L1ChallengeCatalog {
  schemaVersion: string;
  meleeRevision: string;
  manifestHash: string;
  generatedAt: string;
  deterministicSamplerVersion: string;
  totalArchetypes: number;
  totalMembers: number;
  archetypes: L1ChallengeArchetype[];
}

export interface PlayerChallengeRecord {
  recordId: string;
  completedAt: string;
  playerTeamFingerprint: string;
  selectedOpponentMemberId: string;
  selectedOpponentFingerprint: string;
  rootT0SourceId: string;
  opponentDisplayName: string;
  meleeRevision: string;
  manifestHash: string;
  samplingSeed: number;
  playerSide: 1;
  winner: 0 | 1 | 2; // 1: 玩家胜, 2: AI胜, 0: 平局
  outcome: 'WIN' | 'LOSS' | 'DRAW';
  playerScore: number;
  opponentScore: number;
  roundCount: number;
  schemaVersion: 'T046_PLAYER_HISTORY_V1';
}

const STORAGE_KEY_HISTORY = 'monsrise.l1ChallengeHistory.v1';
const STORAGE_KEY_CACHED_CATALOG = 'monsrise.cachedL1Catalog.v1';
const MAX_HISTORY_RECORDS = 200;

export class L1MeleeChallengeManager {
  private static _instance: L1MeleeChallengeManager | null = null;
  private _catalog: L1ChallengeCatalog | null = null;
  private _currentOpponent: L1ChallengeMember | null = null;
  private _currentSeed: number = 0;

  public static getInstance(): L1MeleeChallengeManager {
    if (!this._instance) {
      this._instance = new L1MeleeChallengeManager();
    }
    return this._instance;
  }

  /** 获取当前激活的对手快照 */
  public getCurrentOpponent(): L1ChallengeMember | null {
    return this._currentOpponent;
  }

  public getCurrentSeed(): number {
    return this._currentSeed;
  }

  /** 加载最新 L1 挑战目录（网络优先，fallback 缓存） */
  public async loadCatalog(): Promise<L1ChallengeCatalog> {
    if (this._catalog) return this._catalog;

    try {
      const resp = await fetch('/data/l1_melee_challenge_catalog.json?t=' + Date.now());
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.archetypes && data.archetypes.length > 0) {
          this._catalog = data;
          try {
            localStorage.setItem(STORAGE_KEY_CACHED_CATALOG, JSON.stringify(data));
          } catch (e) {
            console.warn('[L1Challenge] Failed to cache catalog to localStorage', e);
          }
          return this._catalog!;
        }
      }
    } catch (err) {
      console.warn('[L1Challenge] Network fetch failed, falling back to cache', err);
    }

    // Fallback 尝试从 localStorage 读取
    try {
      const cachedStr = localStorage.getItem(STORAGE_KEY_CACHED_CATALOG);
      if (cachedStr) {
        const cached = JSON.parse(cachedStr);
        if (cached && cached.archetypes && cached.archetypes.length > 0) {
          this._catalog = cached;
          return this._catalog!;
        }
      }
    } catch (e) {
      console.error('[L1Challenge] Cache load failed', e);
    }

    throw new Error('无法加载 L1 挑战目录，请检查网络或静态资源');
  }

  /** 均匀流派 + 权重成员抽样 */
  public sampleOpponent(seed?: number): { opponent: L1ChallengeMember; archetype: L1ChallengeArchetype; seed: number } {
    if (!this._catalog || this._catalog.archetypes.length === 0) {
      throw new Error('L1 挑战目录尚未加载完成');
    }

    const currentSeed = seed !== undefined ? seed : Math.floor(Math.random() * 1000000);
    this._currentSeed = currentSeed;

    // 简单伪随机生成器 (基于 seed)
    let s = currentSeed;
    const rng = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };

    // 1. 均匀选择流派
    const archIdx = Math.floor(rng() * this._catalog.archetypes.length);
    const archetype = this._catalog.archetypes[archIdx];

    // 2. 流派内按 smoothedWeight 轮盘赌抽样
    const totalWeight = archetype.members.reduce((acc, m) => acc + (m.smoothedWeight || 0.1), 0);
    let r = rng() * totalWeight;
    let selectedMember = archetype.members[0];

    for (const mem of archetype.members) {
      const w = mem.smoothedWeight || 0.1;
      if (r <= w) {
        selectedMember = mem;
        break;
      }
      r -= w;
    }

    this._currentOpponent = selectedMember;
    return { opponent: selectedMember, archetype, seed: currentSeed };
  }

  /** 为对战引擎执行对手放置决策（基于树策略） */
  public executeOpponentPlacements(gameEngine: any, round: number): void {
    if (!this._currentOpponent || !this._currentOpponent.evol) {
      console.warn('[L1Challenge] No current opponent evol tree, skipping tree placement');
      return;
    }

    try {
      const strategy = treeStrategyFor(this._currentOpponent.evol);
      const enemyRevealed = (gameEngine.teams[0] || []).filter((s: any) => s && s.monsterId > 0);
      const enemyOnBoard = (gameEngine.monsters || []).filter((m: any) => m.side === 1);
      const ownOnBoard = (gameEngine.monsters || []).filter((m: any) => m.side === 2);

      const ctx = {
        round,
        side: 2 as const,
        budget: gameEngine.roundBudget || 4,
        enemyRevealedHand: enemyRevealed,
        enemyMonsters: enemyOnBoard,
        ownMonsters: ownOnBoard,
      };

      const intents = strategy(ctx);
      console.log(`[L1Challenge] Strategy produced ${intents.length} intents for round ${round}:`, intents);

      const oppTeam = gameEngine.teams[1] || [];
      for (const intent of intents) {
        const slot = oppTeam.find((s: any) => s && s.monsterId === intent.monsterId);
        if (slot) {
          gameEngine.placeMonster(slot, intent.plannedX, intent.plannedY, false);
        }
      }
    } catch (e) {
      console.error('[L1Challenge] Error executing tree strategy placements:', e);
    }
  }

  /** 获取本地对战历史记录 */
  public getHistory(): PlayerChallengeRecord[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
      if (!raw) return [];
      return JSON.parse(raw);
    } catch (e) {
      console.error('[L1Challenge] Failed to parse history from localStorage', e);
      return [];
    }
  }

  /** 记录对战结果到本地 localStorage（严格隔离，绝不写回训练数据） */
  public recordBattleOutcome(opts: {
    playerTeam: { monsterId: number; badgeIds: number[] }[];
    playerScore: number;
    opponentScore: number;
    winner: 0 | 1 | 2;
    roundCount: number;
  }): PlayerChallengeRecord | null {
    if (!this._currentOpponent || !this._catalog) return null;

    const outcome: 'WIN' | 'LOSS' | 'DRAW' =
      opts.winner === 1 ? 'WIN' : opts.winner === 2 ? 'LOSS' : 'DRAW';

    const playerFp = opts.playerTeam
      .filter(s => s.monsterId > 0)
      .map(s => s.monsterId)
      .sort((a, b) => a - b)
      .join(',');

    const record: PlayerChallengeRecord = {
      recordId: 'rec_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      completedAt: new Date().toISOString(),
      playerTeamFingerprint: playerFp || 'custom_team',
      selectedOpponentMemberId: this._currentOpponent.memberId,
      selectedOpponentFingerprint: this._currentOpponent.canonicalFingerprint,
      rootT0SourceId: this._currentOpponent.rootSourceId,
      opponentDisplayName: this._currentOpponent.name,
      meleeRevision: this._catalog.meleeRevision,
      manifestHash: this._catalog.manifestHash,
      samplingSeed: this._currentSeed,
      playerSide: 1,
      winner: opts.winner,
      outcome,
      playerScore: opts.playerScore,
      opponentScore: opts.opponentScore,
      roundCount: opts.roundCount,
      schemaVersion: 'T046_PLAYER_HISTORY_V1',
    };

    const history = this.getHistory();
    history.unshift(record);
    if (history.length > MAX_HISTORY_RECORDS) {
      history.length = MAX_HISTORY_RECORDS;
    }

    try {
      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(history));
      console.log(`[L1Challenge] Recorded player match outcome: ${outcome} (${opts.playerScore}-${opts.opponentScore})`);
    } catch (e) {
      console.error('[L1Challenge] Failed to save record to localStorage', e);
    }

    return record;
  }

  /** 清空本地对战历史记录 */
  public clearHistory(): void {
    try {
      localStorage.removeItem(STORAGE_KEY_HISTORY);
      console.log('[L1Challenge] Cleared player challenge history');
    } catch (e) {
      console.error('[L1Challenge] Failed to clear history', e);
    }
  }

  /** 汇总历史战绩统计 */
  public getHistorySummary(): {
    total: number;
    wins: number;
    losses: number;
    draws: number;
    winRate: number;
    byArchetype: Record<string, { total: number; wins: number; losses: number; draws: number }>;
  } {
    const history = this.getHistory();
    let wins = 0, losses = 0, draws = 0;
    const byArchetype: Record<string, { total: number; wins: number; losses: number; draws: number }> = {};

    for (const r of history) {
      if (r.outcome === 'WIN') wins++;
      else if (r.outcome === 'LOSS') losses++;
      else draws++;

      const arch = r.rootT0SourceId || 'unknown';
      if (!byArchetype[arch]) {
        byArchetype[arch] = { total: 0, wins: 0, losses: 0, draws: 0 };
      }
      byArchetype[arch].total++;
      if (r.outcome === 'WIN') byArchetype[arch].wins++;
      else if (r.outcome === 'LOSS') byArchetype[arch].losses++;
      else byArchetype[arch].draws++;
    }

    const total = history.length;
    const winRate = total > 0 ? wins / total : 0;

    return { total, wins, losses, draws, winRate, byArchetype };
  }
}
