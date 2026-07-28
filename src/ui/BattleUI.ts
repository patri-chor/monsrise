import { gameEngine, PlacedMonster } from '../game/GameEngine';
import { DB_MONSTERS, DB_BADGES, getSkillDescription } from '../game/Database';
import { renderAvatarHtml } from './shared/AvatarRenderer';
import { renderDetailCard, renderBadgeImg, renderSpriteImg } from './shared/renderHelpers';
import { battleSystem } from '../game/BattleSystem';
import { uiManager } from './UIManager';
import { networkManager } from '../net/NetworkManager';

export class BattleUI {
  private _container: HTMLDivElement;
  private _selectedMonsterId: string | null = null;
  private _isDragging: boolean = false;
  
  // Countdown timer interval
  private _timerInterval: any = null;
  private _networkBound: boolean = false;
  private _unsubscribers: Array<() => void> = [];

  private get _isOnline(): boolean { return gameEngine.mode === 'online'; }

  private getActiveTeam(): import('../game/GameEngine').TeamSlot[] {
    if (this._isOnline) return gameEngine.teams[0];
    return gameEngine.state === 'PREPARATION_LEFT' ? gameEngine.teams[0] : gameEngine.teams[1];
  }

  constructor(container: HTMLDivElement) {
    this._container = container;
  }

  private renderScoreboardCircle(monsterId: number, isDead: boolean, flip: boolean = false): string {
    if (monsterId <= 0) {
      return `<div class="scoreboard-circle question">?</div>`;
    }
    const dbMonster = DB_MONSTERS.find(m => m.id === monsterId);
    if (!dbMonster) {
      return `<div class="scoreboard-circle question">?</div>`;
    }

    const deadClass = isDead ? 'dead' : '';
    const scaleVal = (168 / dbMonster.sw);
    const scaleX = flip ? -scaleVal : scaleVal;

    return `
      <div class="scoreboard-circle ${deadClass}" style="display: flex; justify-content: center; align-items: center; position: relative;">
        ${renderSpriteImg(dbMonster.sx, dbMonster.sy, dbMonster.sw, dbMonster.sh, {
          absoluteCenter: true,
          transform: `scale(${scaleX}, ${scaleVal})`
        })}
      </div>
    `;
  }

  public render(): void {
    const isP1 = gameEngine.state === 'PREPARATION_LEFT';
    const isP2 = gameEngine.state === 'PREPARATION_RIGHT';
    const isBattle = gameEngine.state === 'BATTLE';

    const currentBudgetLimit = gameEngine.getBudgetLimitForRound(gameEngine.currentRound);
    
    // Timer countdown
    const remainingTime = Math.ceil(
      isBattle ? battleSystem.timeLeft : (isP1 || isP2 ? this.getPrepTimeLeft() : 0)
    );

    // Setup P1 and P2 drafted squads
    const isOnline = this._isOnline;
    const myTeam = gameEngine.teams[0] || [];
    const oppTeam = isOnline ? gameEngine.opponentTeam : (gameEngine.teams[1] || []);
    // 仅在线模式 + 非主机时交换队伍，非在线始终 teams[0]=P1, teams[1]=P2
    const swapTeams = isOnline && !gameEngine.isOnlineHost;
    const p1Draft = swapTeams ? oppTeam : myTeam;
    const p2Draft = swapTeams ? myTeam : oppTeam;
    
    const boardMonsters = gameEngine.boardMonsters;
    const p1Board = boardMonsters.filter(m => m.gridX < 5);
    const p2Board = boardMonsters.filter(m => m.gridX >= 6);
    // Monster IDs already placed by the current active team
    const usedMonsterIds = new Set((isP1 ? p1Board : p2Board).map(m => m.dbId));

    // P1 avatar HTML
    const p1AvatarHtml = renderAvatarHtml(gameEngine.p1AvatarIndex, 'p1-frame');

    // P2 avatar HTML
    const p2AvatarHtml = renderAvatarHtml(gameEngine.p2AvatarIndex, 'p2-frame');

    // Phase text and timer display
    let phaseText = '准备阶段';
    let displayTime = remainingTime;
    if (isBattle) {
      phaseText = `${gameEngine.p1Score} - ${gameEngine.p2Score}`;
      displayTime = 40; // Freeze at 40 during combat
    } else {
      if (gameEngine.state === 'ROUND_END') phaseText = '回合结束';
      if (gameEngine.state === 'GAME_OVER') phaseText = '游戏结束';
    }

    // Budgets and placement counts
    const usedBudget = isP1 ? gameEngine.p1TotalCost : gameEngine.p2TotalCost;


    // Ensure battle background layer is in gameContainer (between canvas and uiOverlay)
    // This prevents it from covering #gameCanvas which renders monsters at z-index:2
    const gameContainer = document.getElementById('gameContainer');
    let bgEl = document.getElementById('battleBgLayer');
    if (!bgEl) {
      bgEl = document.createElement('div');
      bgEl.id = 'battleBgLayer';
      bgEl.className = 'battle-bg-container';
      const uiOverlay = document.getElementById('uiOverlay');
      if (uiOverlay && gameContainer) {
        gameContainer.insertBefore(bgEl, uiOverlay);
      } else if (gameContainer) {
        gameContainer.appendChild(bgEl);
      }
      // Only set innerHTML once on creation — resetting it every frame breaks CSS animations
      bgEl.innerHTML = `
        <div class="battle-bg-inner">
          <div class="bg-layer sky"></div>
          <div class="bg-layer yun layer-far" style="background-image: url('/background/yun1.png');"></div>
          <div class="bg-layer yun layer-near" style="background-image: url('/background/yun2png.png');"></div>
          <div class="bg-layer battle-ground"></div>
        </div>
      `;
    }
    // Sync scale transform from #gameBg (set by resizeUI in main.ts)
    const gameBg = document.getElementById('gameBg');
    if (gameBg) {
      bgEl.style.transform = gameBg.style.transform;
      bgEl.style.transformOrigin = gameBg.style.transformOrigin;
    }

    this._container.innerHTML = `
      <div id="battleView" class="ui-interactive">

        <!-- 退出实验模式按钮 -->
        <button id="exitBattleBtn" class="pixel-btn" style="position: absolute; left: 40px; top: 40px; width: 140px; height: 55px; font-size: 20px; z-index: 100;">退出</button>
        
        <!-- Top HUD Scoreboard -->
        <div class="battle-scoreboard-top">
          <!-- Left side P1 avatars (从右往左排列，靠近头像的在前) -->
          <div class="scoreboard-team-row">
            ${Array(8).fill(0).map((_, idx) => {
              const slotIdx = 7 - idx;
              const slot = p1Draft[slotIdx];
              if (!slot || slot.monsterId <= 0) return this.renderScoreboardCircle(0, false);
              // 在线客场：P1=敌方，左边4个（slotIdx 4-7，即 idx<4）始终遮挡
              const p1Enemy = isOnline && !gameEngine.isOnlineHost;
              if (p1Enemy && idx < 4) {
                return `<div class="scoreboard-circle question">?</div>`;
              }
              return this.renderScoreboardCircle(slot.monsterId, false);
            }).join('')}
          </div>

          <!-- Center timer & avatar display -->
          <div class="scoreboard-center-hud">
            ${p1AvatarHtml}
            <div class="scoreboard-center-box">
              <div class="scoreboard-timer">${displayTime}</div>
              <div class="scoreboard-phase-text">${phaseText}</div>
            </div>
            ${p2AvatarHtml}
          </div>

          <!-- Right side P2 avatars -->
          <div class="scoreboard-team-row">
            ${Array(8).fill(0).map((_, idx) => {
              const slot = p2Draft[idx];
              if (!slot || slot.monsterId <= 0) return this.renderScoreboardCircle(0, false);
              
              // 敌方队伍后4个始终遮挡（非在线 / 在线主场：P2=敌方；在线客场：P2=自己全部可见）
              const p2Enemy = isOnline ? gameEngine.isOnlineHost : true;
              if (p2Enemy && idx >= 4) {
                return `<div class="scoreboard-circle question">?</div>`;
              }
              
              return this.renderScoreboardCircle(slot.monsterId, false, true);
            }).join('')}
          </div>
        </div>

        <!-- 11x5 Grid Overlay over Canvas -->
        <div id="battleGrid" class="battle-grid-overlay">
          ${Array(5).fill(0).map((_, y) => {
            return Array(11).fill(0).map((_, x) => {

              // Grid cell is droppable depending on turn
              const isDroppable = (isP1 && x < 5) || (isP2 && x >= 6);
              const noDropClass = ((isP1 || isP2) && !isDroppable) ? 'no-drop' : '';
              const hasMonster = boardMonsters.some(m => m.gridX === x && m.gridY === y && !m.isDead);
              const occupiedClass = hasMonster ? 'occupied' : '';

              return `
                <div class="battle-grid-cell ${noDropClass} ${occupiedClass}" 
                     data-grid-x="${x}" 
                     data-grid-y="${y}" 
                     data-droppable="${isDroppable}">
                </div>
              `;
            }).join('');
          }).join('')}
        </div>

        <!-- DOM Health Bars Overlay (Active during BATTLE) -->
        <div id="hpBarsContainer" class="health-bars-overlay">
        </div>

        <!-- Bottom HUD Panel (Bench list, remaining budgets) -->
        <div class="battle-hud-bottom">
          <!-- Cost display absolute positioned at top-left -->
          <div class="bench-header-stat" style="position: absolute; left: 258px; top: 52px; z-index: 2;">
            <span>当前预算: ${usedBudget} / ${currentBudgetLimit}</span>
          </div>

          <!-- 8 bench slots -->
          <div class="bench-container" style="z-index: 2;">
              ${(isBattle ? p1Draft : (isP1 ? p1Draft : p2Draft)).map((slot, index) => {
                const dbMonster = DB_MONSTERS.find(m => m.id === slot.monsterId);
                const isUsed = isBattle ? false : (dbMonster ? usedMonsterIds.has(slot.monsterId) : false);
                return `
                  <div class="bench-slot" data-slot-index="${index}" data-used="${isUsed}" draggable="false" ${isUsed ? 'style="filter:grayscale(0.85);cursor:not-allowed;opacity:0.6;"' : ''}>
                    ${dbMonster ? `
                      <div style="
                        width: ${dbMonster.sw * 0.8}px;
                        height: ${dbMonster.sh * 0.8}px;
                        position: relative;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        pointer-events: none;
                      ">
                        ${renderSpriteImg(dbMonster.sx, dbMonster.sy, dbMonster.sw, dbMonster.sh, {
                          absoluteCenter: true,
                          draggable: false,
                          transform: (isP2 && !isBattle) ? 'scale(-0.8, 0.8)' : 'scale(0.8)',
                          extraStyle: 'pointer-events: none;'
                        })}
                      </div>
                      <div class="bench-slot-cost">${dbMonster.cost}费</div>
                    ` : ''}
                  </div>
                `;
              }).join('')}
            </div>
            ${!isBattle ? `<button id="completePrepBtn" class="action-ready-btn"></button>` : ''}
        </div>

        
        <!-- Right Side details card overlay (Visible when a monster is selected) -->
        <div id="battleDetailsCardContainer" class="details-card" style="display: none; left: 1550px; top: 100px; z-index: 15;"></div>
        
        <!-- Center screen announcement overlay (Full Screen) -->
        <div id="battleAnnouncement" style="
          position: absolute;
          left: 0;
          top: 0;
          width: 100%;
          height: 100%;
          font-size: 80px;
          color: #ffffff;
          text-shadow: 6px 6px 0px #000000, -6px -6px 0px #000000, 6px -6px 0px #000000, -6px 6px 0px #000000, 6px 0px 0px #000000, -6px 0px 0px #000000, 0px 6px 0px #000000, 0px -6px 0px #000000;
          background: url('fade.png') center/cover no-repeat;
          background-size: 100% 100%;
          display: none;
          opacity: 0;
          transition: opacity 0.5s ease-in-out;
          justify-content: center;
          align-items: center;
          z-index: 999;
          text-align: center;
          pointer-events: none;
          white-space: nowrap;
        "></div>
        
        <!-- Online waiting overlay (仅用于隐藏确认按钮，无文字无遮罩) -->
        <div id="onlineWaitOverlay" style="
          display: none; z-index: 1000; pointer-events: none;
        "></div>
      </div>
    `;

    this.bindEvents();
    this.startPrepTimer();
    this.updateDetailsCardContent();
    if (this._isOnline) this.bindNetworkForBattle();
  }

  // --- Prep timer logic ---
  private _prepTimeLeft: number = 2000;

  private getPrepTimeLeft(): number {
    return this._prepTimeLeft;
  }

  private startPrepTimer(): void {
    if (gameEngine.state === 'BATTLE') return;

    this._prepTimeLeft = 2000;
    
    if (this._timerInterval) {
      clearInterval(this._timerInterval);
    }

    this._timerInterval = setInterval(() => {
      this._prepTimeLeft -= 1;
      
      // Update timer element directly to avoid re-rendering whole DOM every second (flashing)
      const timerEl = document.querySelector('.scoreboard-timer');
      if (timerEl) {
        timerEl.textContent = `${this._prepTimeLeft}`;
      }

      if (this._prepTimeLeft <= 0) {
        clearInterval(this._timerInterval);
        this.onPrepComplete();
      }
    }, 1000);
  }

  private onPrepComplete(): void {
    clearInterval(this._timerInterval);
    console.log('[Battle] onPrepComplete called, state=', gameEngine.state, 'mode=', gameEngine.mode);

    if (this._isOnline) {
      // 联机模式：发送布阵数据，等待对手
      const placements = gameEngine.boardMonsters
        .filter(m => (gameEngine.isOnlineHost ? m.gridX < 5 : m.gridX >= 6))
        .map(m => ({ monsterId: m.dbId, gridX: m.gridX, gridY: m.gridY }));
      networkManager.syncPlacement(placements);
      networkManager.sendReady();
      this.showWaitingOverlay();
      return;
    }

    if (gameEngine.state === 'PREPARATION_LEFT') {
      gameEngine.state = 'PREPARATION_RIGHT';
      if (gameEngine.mode === 'ai') {
        this.runAIPlacements();
        return;
      }
      uiManager.syncStateWithUI();
    } else if (gameEngine.state === 'PREPARATION_RIGHT') {
      this.showBattleStartAnnouncement();
    }
  }

  private showWaitingOverlay(): void {
    // 仅隐藏确认按钮，无遮罩无文字
    const btn = document.getElementById('completePrepBtn');
    if (btn) btn.style.display = 'none';
  }

  private bindNetworkForBattle(): void {
    if (this._networkBound) return;
    this._networkBound = true;

    this._unsubscribers.push(
      networkManager.on('battleStart', (data) => {
        // 应用对手布阵
        gameEngine.opponentPlacements = [];
        if (data.opponentPlacements) {
          for (const p of data.opponentPlacements) {
            const oppTeam = gameEngine.opponentTeam;
            const slot = oppTeam.find(s => s.monsterId === p.monsterId);
            if (slot) {
              const isP1Placement = !gameEngine.isOnlineHost;
              gameEngine.placeMonster(slot, p.gridX, p.gridY, isP1Placement);
              gameEngine.opponentPlacements.push(p);
            }
          }
        }
        gameEngine.onlineBattleSeed = data.seed;
        gameEngine.setReplaySeed(data.seed);

        // 先切换状态为 BATTLE，避免"开始"动画期间迷雾隐藏怪兽
        gameEngine.state = 'BATTLE';

        // 隐藏等待界面
        const waitEl = document.getElementById('onlineWaitOverlay');
        if (waitEl) waitEl.style.display = 'none';

        this.showBattleStartAnnouncement();
      }),

      networkManager.on('roundResult', (data) => {
        const winner = data.winner;
        gameEngine.roundResults.push(winner);

        const elapsed = Math.max(0, 40 - battleSystem.timeLeft);
        gameEngine.lastRoundElapsed = elapsed;
        gameEngine.saveRoundStats(elapsed);

        const scoreTextEl = document.querySelector('.scoreboard-phase-text');
        if (scoreTextEl) scoreTextEl.textContent = `${gameEngine.p1Score} - ${gameEngine.p2Score}`;

        this.showRoundResultAnnouncement(winner);
      }),

      networkManager.on('opponentDC', () => {
        networkManager.disconnect();
        gameEngine.opponentDisconnected = true;
        const el = document.getElementById('battleAnnouncement');
        if (el) {
          el.textContent = '对手断开连接';
          el.style.display = 'flex';
          el.style.opacity = '1';
          setTimeout(() => {
            gameEngine.state = 'GAME_OVER';
            uiManager.syncStateWithUI();
          }, 2000);
        } else {
          gameEngine.state = 'GAME_OVER';
          uiManager.syncStateWithUI();
        }
      }),

      networkManager.on('placeSync', (data) => {
        if (data.placements) {
          gameEngine.opponentPlacements = data.placements;
        }
      }),
    );
  }

  /** Build AI-compatible game state from current GameEngine board */
  private buildAIState(): AIGameState {
    const board: (any | null)[][] = [];
    for (let y = 0; y < 5; y++) {
      board[y] = new Array(11).fill(null);
    }

    let instanceIdCounter = 1;
    const makeInstance = (m: PlacedMonster) => {
      const owner = m.team === 1 ? 'p1' : 'p2';
      return {
        instanceId: instanceIdCounter++,
        monsterId: m.dbId,
        badgeIds: m.badges?.map(b => b.id) || [],
        position: { x: m.gridX, y: m.gridY },
        owner
      };
    };

    for (const m of gameEngine.boardMonsters) {
      if (m.gridX >= 0 && m.gridX < 11 && m.gridY >= 0 && m.gridY < 5) {
        board[m.gridY][m.gridX] = makeInstance(m);
      }
    }

    const p1Deployed = gameEngine.boardMonsters
      .filter(m => m.gridX < 5)
      .map(m => makeInstance(m));
    const p2Deployed = gameEngine.boardMonsters
      .filter(m => m.gridX >= 6)
      .map(m => makeInstance(m));

    return {
      board,
      players: {
        p1: { side: 'p1', deployed: p1Deployed, remainingBudget: gameEngine.p1RemainingBudget },
        p2: { side: 'p2', deployed: p2Deployed, remainingBudget: gameEngine.p2RemainingBudget }
      },
      round: gameEngine.currentRound,
      phase: 'placing',
      currentPlayer: 'p2',
      nextInstanceId: gameEngine.boardMonsters.length + 1
    };
  }

  /** AI auto-placement: repeatedly call AI to place P2 monsters, then start battle */
  private runAIPlacements(): void {
    console.log('[AI] Starting AI placements...');

    let ai = (gameEngine as any)._aiInstance as BattleAI;
    if (!ai) {
      console.warn('[AI] No stored AI instance found, creating new one.');
      ai = new BattleAI();
      ai.setDifficulty('normal');
      const aiHand: AICard[] = gameEngine.teams[1]
        .filter(s => s.monsterId > 0)
        .map(s => ({ monsterId: s.monsterId, badgeIds: s.badgeIds }));
      ai.buildTeam(aiHand);
    }

    let aiState = this.buildAIState();

    // Available cards from P2 (AI) team
    const cards: AICard[] = gameEngine.teams[1]
      .filter(s => s.monsterId > 0)
      .map(s => ({ monsterId: s.monsterId, badgeIds: s.badgeIds }));

    console.log('[AI] AI team cards:', JSON.stringify(cards));
    console.log('[AI] AI state:', JSON.stringify({
      currentPlayer: aiState.currentPlayer,
      p2Budget: aiState.players.p2.remainingBudget,
      p1Deployed: aiState.players.p1.deployed.length,
      boardOccupied: aiState.board.flat().filter(Boolean).length
    }));

    // AI placement loop — use decide() which leverages the formation engine
    const maxPlacements = 12;
    for (let i = 0; i < maxPlacements; i++) {
      // Rebuild AI state each iteration to reflect current board
      aiState = this.buildAIState();

      console.log(`[AI] Iteration ${i}, budget=${aiState.players.p2.remainingBudget}, cards left=${cards.length}`);

      const decision = ai.decide(aiState, 'p2');
      console.log(`[AI] Decision:`, JSON.stringify(decision?.action));

      if (!decision || !decision.action) {
        console.log('[AI] No action returned, breaking loop');
        break;
      }

      const { monsterId, x, y, badgeIds: _badgeIds } = decision.action;

      // Find team slot matching this monster
      const slot = gameEngine.teams[1].find(s => s.monsterId === monsterId);
      console.log(`[AI] Placing monsterId=${monsterId} at (${x},${y}), slot found=${!!slot}`);

      if (!slot) break;

      // Place via GameEngine
      const placed = gameEngine.placeMonster(slot, x, y, false);
      console.log(`[AI] placeMonster result: ${placed ? 'OK' : 'FAILED'}`);

      if (!placed) {
        // If placement fails, remove this card and try remaining
        const idx = cards.findIndex(c => c.monsterId === monsterId);
        if (idx >= 0) cards.splice(idx, 1);
        continue;
      }

      // Remove used card from available pool
      const cardIdx = cards.findIndex(c => c.monsterId === monsterId);
      if (cardIdx >= 0) cards.splice(cardIdx, 1);
    }

    console.log(`[AI] Placements done. P2 monsters on board: ${gameEngine.boardMonsters.filter(m => m.gridX >= 6).length}`);

    // After all placements, show battle start announcement
    this.showBattleStartAnnouncement();
  }

  /* ============================================
     公告动画（合并自 3 个重复方法）
     ============================================ */

  /** 显示简单公告（出现→消失→回调） */
  private _showSimpleAnnouncement(text: string, onDone: () => void): void {
    const el = document.getElementById('battleAnnouncement');
    if (!el) { onDone(); return; }

    el.textContent = text;
    el.style.display = 'flex';
    el.style.opacity = '0';
    el.offsetHeight; // force reflow
    el.style.opacity = '1';

    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => {
        el.style.display = 'none';
        onDone();
      }, 500);
    }, 1200);
  }

  /** 显示多阶段公告（得分→游戏结束或下一回合） */
  private _showScoreAnnouncement(scoreText: string, isGameOver: boolean, onAdvance: () => void): void {
    const el = document.getElementById('battleAnnouncement');
    if (!el) { onAdvance(); return; }

    el.style.display = 'flex';
    el.style.opacity = '0';

    el.textContent = scoreText;
    el.offsetHeight;
    el.style.opacity = '1';

    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => {
        if (isGameOver) {
          el.textContent = '游戏结束';
          el.style.opacity = '1';
          setTimeout(() => {
            el.style.opacity = '0';
            setTimeout(() => {
              el.style.display = 'none';
              if (gameEngine.mode === 'online') {
                networkManager.leaveMatch();
                gameEngine.mode = 'experimental';
              }
              gameEngine.state = 'GAME_OVER';
              uiManager.syncStateWithUI();
            }, 500);
          }, 1500);
        } else {
          el.textContent = `第 ${gameEngine.currentRound + 1} 回合`;
          el.style.opacity = '1';
          setTimeout(() => {
            el.style.opacity = '0';
            setTimeout(() => {
              el.style.display = 'none';
              onAdvance();
            }, 500);
          }, 1500);
        }
      }, 500);
    }, 1800);
  }

  private showBattleStartAnnouncement(): void {
    this._showSimpleAnnouncement('开始', () => this._doStartBattle());
  }

  private _doStartBattle(): void {
    gameEngine.state = 'BATTLE';
    uiManager.syncStateWithUI();
    battleSystem.startBattle();
    battleSystem.onBattleEndCallback = (winner) => {
      this.showRoundEndAnnouncement(winner);
    };
  }

  private showRoundEndAnnouncement(winner: 1 | 2 | null): void {
    if (this._isOnline) {
      networkManager.sendBattleEnd(winner);
      const scoreText = winner === 1 ? '我方得分' : winner === 2 ? '对手得分' : '平局';
      this._showSimpleAnnouncement(scoreText, () => {});
      return;
    }

    gameEngine.roundResults.push(winner);
    const elapsed = Math.max(0, 40 - battleSystem.timeLeft);
    gameEngine.lastRoundElapsed = elapsed;
    gameEngine.saveRoundStats(elapsed);

    const scoreTextEl = document.querySelector('.scoreboard-phase-text');
    if (scoreTextEl) scoreTextEl.textContent = `${gameEngine.p1Score} - ${gameEngine.p2Score}`;

    const scoreText = winner === 1 ? '我方得分' : winner === 2 ? '对手得分' : '平局';
    const isGameOver = gameEngine.isGameOver();
    this._showScoreAnnouncement(scoreText, isGameOver, () => {
      gameEngine.currentRound += 1;
      gameEngine.state = 'PREPARATION_LEFT' as any;
      gameEngine.resetBoardForNextRound();
      uiManager.syncStateWithUI();
    });
  }

  private showRoundResultAnnouncement(winner: 1 | 2 | null): void {
    const isGameOver = gameEngine.isGameOver();
    const scoreText = winner === 1
      ? (gameEngine.isOnlineHost ? '我方得分' : '对手得分')
      : winner === 2
        ? (gameEngine.isOnlineHost ? '对手得分' : '我方得分')
        : '平局';

    this._showScoreAnnouncement(scoreText, isGameOver, () => {
      gameEngine.currentRound += 1;
      gameEngine.state = gameEngine.isOnlineHost ? 'PREPARATION_LEFT' : 'PREPARATION_RIGHT';
      gameEngine.resetBoardForNextRound();
      networkManager.phase = 'placing';
      uiManager.syncStateWithUI();
    });
  }

  private bindEvents(): void {
    // Exit button
    const exitBtn = document.getElementById('exitBattleBtn');
    exitBtn?.addEventListener('click', () => {
      gameEngine.restartGame();
      uiManager.syncStateWithUI();
    });

    const isP1 = gameEngine.state === 'PREPARATION_LEFT';
    const isP2 = gameEngine.state === 'PREPARATION_RIGHT';

    // Complete button
    const completeBtn = document.getElementById('completePrepBtn');
    completeBtn?.addEventListener('click', () => {
      this.onPrepComplete();
    });

    if (isP1 || isP2) {
      // 1. Custom Drag and Drop System supporting Mouse + Touch (F12 Emulation friendly)
      const benchSlots = document.querySelectorAll('.bench-slot');
      benchSlots.forEach(slot => {
        const startDrag = (e: MouseEvent | TouchEvent, idx: number) => {
          // Block dragging already-placed (used) monsters
          if (slot.getAttribute('data-used') === 'true') return;
          e.preventDefault();
          
          let startX = 0;
          let startY = 0;
          if (e instanceof MouseEvent) {
            startX = e.pageX;
            startY = e.pageY;
          } else {
            if (!e.touches || e.touches.length === 0) return;
            startX = e.touches[0].pageX;
            startY = e.touches[0].pageY;
          }

          const activeTeamSlot = this.getActiveTeam()[idx];
          if (!activeTeamSlot || activeTeamSlot.monsterId <= 0) return;
          const dbMonster = DB_MONSTERS.find(m => m.id === activeTeamSlot.monsterId);
          if (!dbMonster) return;

          let dragEl: HTMLDivElement | null = null;
          let dragStarted = false;

          const onMove = (moveEv: MouseEvent | TouchEvent) => {
            let cx = 0;
            let cy = 0;
            let px = 0;
            let py = 0;
            if (moveEv instanceof MouseEvent) {
              cx = moveEv.clientX;
              cy = moveEv.clientY;
              px = moveEv.pageX;
              py = moveEv.pageY;
            } else {
              if (!moveEv.touches || moveEv.touches.length === 0) return;
              cx = moveEv.touches[0].clientX;
              cy = moveEv.touches[0].clientY;
              px = moveEv.touches[0].pageX;
              py = moveEv.touches[0].pageY;
            }

            const dist = Math.sqrt((px - startX) ** 2 + (py - startY) ** 2);
            if (!dragStarted && dist > 5) {
              dragStarted = true;
              this._isDragging = true;
              document.getElementById('battleGrid')?.classList.add('dragging');

              // Create floating pixel helper
              dragEl = document.createElement('div');
              dragEl.className = 'drag-avatar-helper';
              dragEl.style.position = 'absolute';
              dragEl.style.width = `${dbMonster.sw}px`;
              dragEl.style.height = `${dbMonster.sh}px`;
              dragEl.style.pointerEvents = 'none';
              dragEl.style.zIndex = '9999';
              const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
              dragEl.style.transform = `translate(-50%, -50%) scale(${s})`;

              dragEl.innerHTML = `
                ${renderSpriteImg(dbMonster.sx, dbMonster.sy, dbMonster.sw, dbMonster.sh, {
                  absoluteCenter: true,
                  draggable: false,
                  transform: isP2 ? 'scale(-1, 1)' : 'scale(1)'
                })}
              `;
              document.body.appendChild(dragEl);
            }

            if (dragEl) {
              dragEl.style.left = `${px}px`;
              dragEl.style.top = `${py}px`;

              dragEl.style.display = 'none';
              const target = document.elementFromPoint(cx, cy);
              dragEl.style.display = 'block';

              // Clear previous grid hovers
              document.querySelectorAll('.battle-grid-cell').forEach(c => {
                c.classList.remove('drag-hover');
                c.classList.remove('drag-hover-locked');
                c.classList.remove('drag-target-landing');
                c.classList.remove('drag-atk-range');
              });

              const cell = target?.closest('.battle-grid-cell');
              if (cell && cell.getAttribute('data-droppable') === 'true') {
                const gx = parseInt(cell.getAttribute('data-grid-x') || '0', 10);
                const gy = parseInt(cell.getAttribute('data-grid-y') || '0', 10);
                const occupant = gameEngine.getMonsterAt(gx, gy);
                const isLocked = occupant && occupant.placedRound < gameEngine.currentRound;
                if (isLocked) {
                  cell.classList.add('drag-hover-locked');
                } else {
                  cell.classList.add('drag-hover');

                  // Landing indicator logic for Drill and Iron Monkey
                  if (dbMonster.id === 116) {
                    // Drill (dig) unearthing position (6 cells forward)
                    const dir = isP1 ? 1 : -1;
                    const landX = Math.max(0, Math.min(10, gx + 6 * dir));
                    const landY = gy;
                    const landCell = document.querySelector(`.battle-grid-cell[data-grid-x="${landX}"][data-grid-y="${landY}"]`);
                    if (landCell) landCell.classList.add('drag-target-landing');
                  } else if (dbMonster.id === 117) {
                    // Iron Monkey (throw) target position (4 cells forward from hover)
                    const throwDir = isP1 ? 1 : -1;
                    const destX = Math.max(0, Math.min(10, gx + 4 * throwDir));
                    const destY = gy;
                    const landCell = document.querySelector(`.battle-grid-cell[data-grid-x="${destX}"][data-grid-y="${destY}"]`);
                    if (landCell) landCell.classList.add('drag-target-landing');
                  }
                  
                  // Show attack range
                  if (dbMonster) {
                    if (dbMonster.type === 'melee') {
                      for (let dx = -1; dx <= 1; dx++) {
                        for (let dy = -1; dy <= 1; dy++) {
                          if (dx === 0 && dy === 0) continue;
                          const ax = gx + dx, ay = gy + dy;
                          if (ax < 0 || ax > 10 || ay < 0 || ay > 4) continue;
                          const aCell = document.querySelector(`.battle-grid-cell[data-grid-x="${ax}"][data-grid-y="${ay}"]`);
                          if (aCell) aCell.classList.add('drag-atk-range');
                        }
                      }
                    } else {
                      const rng = dbMonster.range || 5;
                      for (let dx = -rng; dx <= rng; dx++) {
                        for (let dy = -rng; dy <= rng; dy++) {
                          if (dx === 0 && dy === 0) continue;
                          if (Math.abs(dx) + Math.abs(dy) > rng) continue;
                          const ax = gx + dx, ay = gy + dy;
                          if (ax < 0 || ax > 10 || ay < 0 || ay > 4) continue;
                          const aCell = document.querySelector(`.battle-grid-cell[data-grid-x="${ax}"][data-grid-y="${ay}"]`);
                          if (aCell) aCell.classList.add('drag-atk-range');
                        }
                      }
                    }
                  }
                }
              }
            }
          };

          // Bench drag - onEnd
          const onEnd = (endEv: MouseEvent | TouchEvent) => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('touchmove', onMove);
            window.removeEventListener('mouseup', onEnd);
            window.removeEventListener('touchend', onEnd);

            if (!dragStarted) {
              return;
            }

            let cx = 0;
            let cy = 0;
            if (endEv instanceof MouseEvent) {
              cx = endEv.clientX;
              cy = endEv.clientY;
            } else {
              if (endEv.changedTouches && endEv.changedTouches.length > 0) {
                cx = endEv.changedTouches[0].clientX;
                cy = endEv.changedTouches[0].clientY;
              }
            }

            let target: Element | null = null;
            if (dragEl) {
              dragEl.style.display = 'none';
              target = document.elementFromPoint(cx, cy);
              dragEl.style.display = 'block';
              dragEl.remove();
            }

            document.querySelectorAll('.battle-grid-cell').forEach(c => {
              c.classList.remove('drag-hover');
              c.classList.remove('drag-target-landing');
            });
            const cell = target?.closest('.battle-grid-cell');
            if (cell && cell.getAttribute('data-droppable') === 'true') {
              const gridX = parseInt(cell.getAttribute('data-grid-x') || '0', 10);
              const gridY = parseInt(cell.getAttribute('data-grid-y') || '0', 10);

              const activeTeam = this.getActiveTeam();
              const teamSlot = activeTeam[idx];
              if (teamSlot) {
                const placed = gameEngine.placeMonster(teamSlot, gridX, gridY, isP1);
                if (placed) {
                  this.render();
                }
              }
            }

            setTimeout(() => {
              this._isDragging = false;
              document.getElementById('battleGrid')?.classList.remove('dragging');
            }, 50);
          };

          window.addEventListener('mousemove', onMove);
          window.addEventListener('touchmove', onMove, { passive: false });
          window.addEventListener('mouseup', onEnd);
          window.addEventListener('touchend', onEnd);
        };

        const idx = parseInt(slot.getAttribute('data-slot-index') || '0', 10);
        slot.addEventListener('mousedown', (e: any) => startDrag(e, idx));
        slot.addEventListener('touchstart', (e: any) => startDrag(e, idx), { passive: false });
        slot.addEventListener('click', () => {
          if (this._isDragging) return;
          this._selectedMonsterId = `bench_${idx}`;
          this.updateDetailsCardContent();
        });
      });

      // 1.5 Drag and Drop logic for already placed monsters on the grid (to move or swap)
      const gridCells = document.querySelectorAll('.battle-grid-cell');
      gridCells.forEach(gCell => {
        const startGridDrag = (dragEvent: MouseEvent | TouchEvent) => {
          if (!(isP1 || isP2)) return;

          const gX = parseInt(gCell.getAttribute('data-grid-x') || '0', 10);
          const gY = parseInt(gCell.getAttribute('data-grid-y') || '0', 10);
          const sourceMonster = gameEngine.getMonsterAt(gX, gY);

          if (!sourceMonster || sourceMonster.placedRound < gameEngine.currentRound) return;
          dragEvent.preventDefault();
          
          let startX = 0;
          let startY = 0;
          if (dragEvent instanceof MouseEvent) {
            startX = dragEvent.pageX;
            startY = dragEvent.pageY;
          } else {
            if (!dragEvent.touches || dragEvent.touches.length === 0) return;
            startX = dragEvent.touches[0].pageX;
            startY = dragEvent.touches[0].pageY;
          }

          const dbMonster = DB_MONSTERS.find(m => m.id === sourceMonster.dbId);
          if (!dbMonster) return;

          let dragEl: HTMLDivElement | null = null;
          let dragStarted = false;

          const onMove = (moveEv: MouseEvent | TouchEvent) => {
            let cx = 0;
            let cy = 0;
            let px = 0;
            let py = 0;
            if (moveEv instanceof MouseEvent) {
              cx = moveEv.clientX;
              cy = moveEv.clientY;
              px = moveEv.pageX;
              py = moveEv.pageY;
            } else {
              if (!moveEv.touches || moveEv.touches.length === 0) return;
              cx = moveEv.touches[0].clientX;
              cy = moveEv.touches[0].clientY;
              px = moveEv.touches[0].pageX;
              py = moveEv.touches[0].pageY;
            }

            const dist = Math.sqrt((px - startX) ** 2 + (py - startY) ** 2);
            if (!dragStarted && dist > 5) {
              dragStarted = true;
              this._isDragging = true;
              document.getElementById('battleGrid')?.classList.add('dragging');

              // Create floating pixel helper
              dragEl = document.createElement('div');
              dragEl.className = 'drag-avatar-helper';
              dragEl.style.position = 'absolute';
              dragEl.style.width = `${dbMonster.sw}px`;
              dragEl.style.height = `${dbMonster.sh}px`;
              dragEl.style.pointerEvents = 'none';
              dragEl.style.zIndex = '9999';
              const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
              dragEl.style.transform = `translate(-50%, -50%) scale(${s})`;

              dragEl.innerHTML = `
                ${renderSpriteImg(dbMonster.sx, dbMonster.sy, dbMonster.sw, dbMonster.sh, {
                  absoluteCenter: true,
                  draggable: false,
                  transform: sourceMonster.team === 2 ? 'scale(-1, 1)' : 'scale(1)'
                })}
              `;
              document.body.appendChild(dragEl);
            }

            if (dragEl) {
              dragEl.style.left = `${px}px`;
              dragEl.style.top = `${py}px`;

              dragEl.style.display = 'none';
              const target = document.elementFromPoint(cx, cy);
              dragEl.style.display = 'block';

              document.querySelectorAll('.battle-grid-cell').forEach(c => {
                c.classList.remove('drag-hover');
                c.classList.remove('drag-hover-locked');
                c.classList.remove('drag-target-landing');
                c.classList.remove('drag-atk-range');
              });

              const targetCell = target?.closest('.battle-grid-cell');
              if (targetCell && targetCell.getAttribute('data-droppable') === 'true') {
                const tx = parseInt(targetCell.getAttribute('data-grid-x') || '0', 10);
                const ty = parseInt(targetCell.getAttribute('data-grid-y') || '0', 10);
                const occupant = gameEngine.getMonsterAt(tx, ty);
                const isLocked = occupant && occupant.placedRound < gameEngine.currentRound;

                if (isLocked) {
                  targetCell.classList.add('drag-hover-locked');
                } else {
                  targetCell.classList.add('drag-hover');

                  // Landing indicator logic for Drill and Iron Monkey
                  if (dbMonster.id === 116) {
                    // Drill (dig) unearthing position (6 cells forward)
                    const dir = isP1 ? 1 : -1;
                    const landX = Math.max(0, Math.min(10, tx + 6 * dir));
                    const landY = ty;
                    const landCell = document.querySelector(`.battle-grid-cell[data-grid-x="${landX}"][data-grid-y="${landY}"]`);
                    if (landCell) landCell.classList.add('drag-target-landing');
                  } else if (dbMonster.id === 117) {
                    // Iron Monkey (throw) target position (4 cells forward from hover)
                    const throwDir = isP1 ? 1 : -1;
                    const destX = Math.max(0, Math.min(10, tx + 4 * throwDir));
                    const destY = ty;
                    const landCell = document.querySelector(`.battle-grid-cell[data-grid-x="${destX}"][data-grid-y="${destY}"]`);
                    if (landCell) landCell.classList.add('drag-target-landing');
                  }
                  
                  // Show attack range
                  if (dbMonster) {
                    if (dbMonster.type === 'melee') {
                      for (let dx = -1; dx <= 1; dx++) {
                        for (let dy = -1; dy <= 1; dy++) {
                          if (dx === 0 && dy === 0) continue;
                          const ax = tx + dx, ay = ty + dy;
                          if (ax < 0 || ax > 10 || ay < 0 || ay > 4) continue;
                          const aCell = document.querySelector(`.battle-grid-cell[data-grid-x="${ax}"][data-grid-y="${ay}"]`);
                          if (aCell) aCell.classList.add('drag-atk-range');
                        }
                      }
                    } else {
                      const rng = dbMonster.range || 5;
                      for (let dx = -rng; dx <= rng; dx++) {
                        for (let dy = -rng; dy <= rng; dy++) {
                          if (dx === 0 && dy === 0) continue;
                          if (Math.abs(dx) + Math.abs(dy) > rng) continue;
                          const ax = tx + dx, ay = ty + dy;
                          if (ax < 0 || ax > 10 || ay < 0 || ay > 4) continue;
                          const aCell = document.querySelector(`.battle-grid-cell[data-grid-x="${ax}"][data-grid-y="${ay}"]`);
                          if (aCell) aCell.classList.add('drag-atk-range');
                        }
                      }
                    }
                  }
                }
              }
            }
          };

          // Grid drag - onEnd
          const onEnd = (endEv: MouseEvent | TouchEvent) => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('touchmove', onMove);
            window.removeEventListener('mouseup', onEnd);
            window.removeEventListener('touchend', onEnd);

            if (!dragStarted) {
              return;
            }

            let cx = 0;
            let cy = 0;
            if (endEv instanceof MouseEvent) {
              cx = endEv.clientX;
              cy = endEv.clientY;
            } else {
              if (endEv.changedTouches && endEv.changedTouches.length > 0) {
                cx = endEv.changedTouches[0].clientX;
                cy = endEv.changedTouches[0].clientY;
              }
            }

            let target: Element | null = null;
            if (dragEl) {
              dragEl.style.display = 'none';
              target = document.elementFromPoint(cx, cy);
              dragEl.style.display = 'block';
              dragEl.remove();
            }

            document.querySelectorAll('.battle-grid-cell').forEach(c => {
              c.classList.remove('drag-hover');
              c.classList.remove('drag-target-landing');
            });

            const targetCell = target?.closest('.battle-grid-cell');
            const targetBench = target?.closest('.battle-hud-bottom');

            if (targetBench) {
              const removed = gameEngine.removeMonster(sourceMonster.id);
              if (removed) {
                if (this._selectedMonsterId === sourceMonster.id) {
                  this._selectedMonsterId = null;
                }
                this.render();
              }
            } else if (targetCell && targetCell.getAttribute('data-droppable') === 'true') {
              const tx = parseInt(targetCell.getAttribute('data-grid-x') || '0', 10);
              const ty = parseInt(targetCell.getAttribute('data-grid-y') || '0', 10);

              if (tx !== gX || ty !== gY) {
                const occupant = gameEngine.getMonsterAt(tx, ty);
                if (!occupant) {
                  sourceMonster.gridX = tx;
                  sourceMonster.gridY = ty;
                  sourceMonster.initialGridX = tx;
                  sourceMonster.initialGridY = ty;
                  this.render();
                } else if (occupant.placedRound === gameEngine.currentRound) {
                  // Swap!
                  occupant.gridX = gX;
                  occupant.gridY = gY;
                  occupant.initialGridX = gX;
                  occupant.initialGridY = gY;

                  sourceMonster.gridX = tx;
                  sourceMonster.gridY = ty;
                  sourceMonster.initialGridX = tx;
                  sourceMonster.initialGridY = ty;
                  this.render();
                }
              }
            }

            setTimeout(() => {
              this._isDragging = false;
              document.getElementById('battleGrid')?.classList.remove('dragging');
            }, 50);
          };

          window.addEventListener('mousemove', onMove);
          window.addEventListener('touchmove', onMove, { passive: false });
          window.addEventListener('mouseup', onEnd);
          window.addEventListener('touchend', onEnd);
        };

        gCell.addEventListener('mousedown', (e: any) => startGridDrag(e));
        gCell.addEventListener('touchstart', (e: any) => startGridDrag(e), { passive: false });
      });

    }

    // 2. Click on grid cell to select monster (and handle withdrawal if in preparation phase)
    const cells = document.querySelectorAll('.battle-grid-cell');
    cells.forEach(cell => {
      cell.addEventListener('click', () => {
        if (this._isDragging) return;
        const gridX = parseInt(cell.getAttribute('data-grid-x') || '0', 10);
        const gridY = parseInt(cell.getAttribute('data-grid-y') || '0', 10);
        const monster = gameEngine.getMonsterAt(gridX, gridY);
        
        if (monster) {
          // Select monster and show details (same as battle phase)
          this._selectedMonsterId = monster.id;
          this.updateDetailsCardContent();
        } else {
          // Clicked empty space: clear selection
          this._selectedMonsterId = null;
          this.updateDetailsCardContent();
        }
      });
    });
  }

  // Sync health bars with smoothly moving canvas monster entities
  public updateHpBars(): void {
    if (gameEngine.state === 'BATTLE') {
      const timerEl = document.querySelector('.scoreboard-timer');
      if (timerEl) {
        timerEl.textContent = `${Math.ceil(battleSystem.timeLeft)}`;
      }
    }

    const container = document.getElementById('hpBarsContainer');
    if (!container || gameEngine.state !== 'BATTLE') return;

    // HP bars are now rendered in Canvas by Sprite.ts to ensure they are under floating text
    container.innerHTML = '';
  }

  // Cleanup timers and network listeners on destruction
  public onDestroy(): void {
    if (this._timerInterval) {
      clearInterval(this._timerInterval);
    }
    for (const unsub of this._unsubscribers) unsub();
    this._unsubscribers = [];
  }

  public updateDetailsCard(): void {
    this.updateDetailsCardContent();
  }

  public updateDetailsCardContent(): void {
    const cardContainer = document.getElementById('battleDetailsCardContainer');
    if (!cardContainer) return;

    if (!this._selectedMonsterId) {
      cardContainer.style.display = 'none';
      return;
    }

    let selectedMonster: PlacedMonster | null = null;
    if (this._selectedMonsterId.startsWith('bench_')) {
      const idx = parseInt(this._selectedMonsterId.replace('bench_', ''), 10);
      const isP1 = gameEngine.state === 'PREPARATION_LEFT';
      const activeTeamSlot = (isP1 ? gameEngine.teams[0] : gameEngine.teams[1])[idx];
      if (activeTeamSlot && activeTeamSlot.monsterId > 0) {
        const dbMonster = DB_MONSTERS.find(m => m.id === activeTeamSlot.monsterId);
        if (dbMonster) {
          selectedMonster = {
            id: this._selectedMonsterId,
            dbId: dbMonster.id,
            data: dbMonster,
            badges: activeTeamSlot.badgeIds.map(id => {
              const realBadge = DB_BADGES.find(b => b.id === id);
              return realBadge ? { ...realBadge } : { id, name: '未知', desc: '' };
            }),
            gridX: 0,
            gridY: 0,
            initialGridX: 0,
            initialGridY: 0,
            placedRound: gameEngine.currentRound,
            team: isP1 ? 1 : 2,
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
        }
      }
    } else {
      selectedMonster = gameEngine.boardMonsters.find(m => m.id === this._selectedMonsterId) || null;
    }

    if (!selectedMonster || selectedMonster.isDead) {
      this._selectedMonsterId = null;
      cardContainer.style.display = 'none';
      return;
    }

    cardContainer.style.display = 'block';

    const dbMonster = selectedMonster.data;
    
    const maxSlots = Math.max(selectedMonster.badges.length, dbMonster.cost === 4 ? 3 : 2);
    const badgesHtml = Array(maxSlots).fill(0).map((_, badgeIdx) => {
      const badge = selectedMonster.badges[badgeIdx];
      const imgHtml = badge ? renderBadgeImg(badge.id, 64) : '<span style="font-size:24px; color:#5a5a5a;">+</span>';
      const equippedClass = badge ? 'equipped' : '';
      return `<div class="details-badge-slot-frame ${equippedClass}" data-badge-slot="${badgeIdx}">${imgHtml}</div>`;
    }).join('');

    cardContainer.innerHTML = renderDetailCard(dbMonster, {
      hp: selectedMonster.hp,
      maxHp: selectedMonster.maxHp,
      atk: selectedMonster.atk,
      ats: selectedMonster.ats,
      shield: selectedMonster.shield,
      badgesHtml
    }, getSkillDescription(dbMonster));
  }
}
export const CANVAS_W = 1280;
export const CANVAS_H = 720;
