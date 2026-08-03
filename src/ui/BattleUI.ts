import { gameEngine, PlacedMonster } from '../game/GameEngine';
import { DB_MONSTERS, DB_BADGES, getSkillDescription } from '../game/Database';
import { renderAvatarHtml } from './shared/AvatarRenderer';
import { renderDetailCard, renderBadgeImg, renderSpriteImg } from './shared/renderHelpers';
import { battleSystem, gridToScreen } from '../game/BattleSystem';
import { uiManager } from './UIManager';
import { networkManager } from '../net/NetworkManager';
import { vfx } from '../game/VfxManager';

// 联机等待状态需跨 BattleUI 实例持久化（syncStateWithUI 会重建实例）
let _globalIsWaiting: boolean = false;

export class BattleUI {
  private _container: HTMLDivElement;
  private _isReplay: boolean = false;
  private _selectedMonsterId: string | null = null;
  private _lastRenderedMonsterId: string | null = null;
  private _isDragging: boolean = false;
  
  // Countdown timer interval
  private _timerInterval: any = null;
  private _networkBound: boolean = false;
  private _unsubscribers: Array<() => void> = [];

  // Replay state
  private _currentStep: number = 0;
  private _placements: any[] = [];
  private _baseMonsters: PlacedMonster[] = [];
  private _playbackInterval: any = null;
  private _stepIntervalMs: number = 1200;

  private get _isOnline(): boolean { return gameEngine.mode === 'online'; }

  private getActiveTeam(): import('../game/GameEngine').TeamSlot[] {
    if (this._isOnline) return gameEngine.teams[0];
    return gameEngine.state === 'PREPARATION_LEFT' ? gameEngine.teams[0] : gameEngine.teams[1];
  }

  constructor(container: HTMLDivElement, isReplay: boolean = false) {
    this._container = container;
    this._isReplay = isReplay;
  }

  private renderScoreboardCircle(monsterId: number, isDead: boolean, flip: boolean = false, dataAttrs: string = ''): string {
    if (monsterId <= 0) {
      return `<div class="scoreboard-circle question">?</div>`;
    }
    const dbMonster = DB_MONSTERS.find(m => m.id === monsterId);
    if (!dbMonster) {
      return `<div class="scoreboard-circle question">?</div>`;
    }

    const deadClass = isDead ? 'dead' : '';
    const scaleVal = (150 / dbMonster.sw) * dbMonster.scale;
    const scaleX = flip ? -scaleVal : scaleVal;

    return `
      <div class="scoreboard-circle ${deadClass}" ${dataAttrs} style="display: flex; justify-content: center; align-items: center; position: relative;">
        ${renderSpriteImg(dbMonster.sx, dbMonster.sy, dbMonster.sw, dbMonster.sh, {
          absoluteCenter: true,
          transform: `scale(${scaleX}, ${scaleVal})`
        })}
      </div>
    `;
  }

  public render(): void {
    if (this._isReplay) {
      this._renderReplay();
      return;
    }

    const isP1 = gameEngine.state === 'PREPARATION_LEFT';
    const isP2 = gameEngine.state === 'PREPARATION_RIGHT';
    const isBattle = gameEngine.state === 'BATTLE';
    const showHUD = !isBattle && !_globalIsWaiting;

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

    // P1 avatar HTML (positioned under top bar, showing through holes)
    const p1AvatarHtml = renderAvatarHtml(gameEngine.p1AvatarIndex, 'p1-frame', 135, false,
      'position:absolute;left:calc(50% - 269px);top:18px;z-index:9;');

    // P2 avatar HTML
    const p2AvatarHtml = renderAvatarHtml(gameEngine.p2AvatarIndex, 'p2-frame', 135, true,
      'position:absolute;left:calc(50% + 131px);top:18px;z-index:9;');

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


    // Ensure battle background layers are in gameContainer
    // Sky+clouds below canvas (z-index:2), ground below canvas (z-index:3)
    const gameContainer = document.getElementById('gameContainer');
    const gameCanvas = document.getElementById('gameCanvas');
    let bgEl = document.getElementById('battleBgLayer');
    let groundEl = document.getElementById('battleGroundLayer');

    if (!bgEl) {
      bgEl = document.createElement('div');
      bgEl.id = 'battleBgLayer';
      bgEl.className = 'battle-bg-container';
      if (gameCanvas && gameContainer) {
        gameContainer.insertBefore(bgEl, gameCanvas);
      } else if (gameContainer) {
        gameContainer.appendChild(bgEl);
      }
      bgEl.innerHTML = `
        <div class="battle-bg-inner">
          <div class="bg-layer sky"></div>
          <div class="bg-layer yun layer-far" style="background-image: url('/background/yun1.png');"></div>
          <div class="bg-layer yun layer-near" style="background-image: url('/background/yun2.png');"></div>
        </div>
      `;
    }
    if (!groundEl) {
      groundEl = document.createElement('div');
      groundEl.id = 'battleGroundLayer';
      groundEl.className = 'battle-ground-layer';
      if (gameCanvas && gameContainer) {
        gameContainer.insertBefore(groundEl, gameCanvas);
      } else if (gameContainer) {
        gameContainer.appendChild(groundEl);
      }
      groundEl.innerHTML = `
        <div class="battle-ground-wrapper">
          <div class="bg-layer battle-ground"></div>
        </div>
      `;
    }

    // Sync scale transform from #gameBg (set by resizeUI in main.ts)
    const gameBg = document.getElementById('gameBg');
    if (gameBg) {
      bgEl.style.transform = gameBg.style.transform;
      bgEl.style.transformOrigin = gameBg.style.transformOrigin;
      groundEl.style.transform = gameBg.style.transform;
      groundEl.style.transformOrigin = gameBg.style.transformOrigin;
    }

    this._container.innerHTML = `
      <div id="battleView" class="ui-interactive">

        <!-- Avatar layer (under top bar, same transform) -->
        <div style="position:absolute;top:0;left:50%;transform:translateX(-50%) scale(0.8);transform-origin:top center;width:2606px;height:216px;z-index:9;pointer-events:none;">
          ${p1AvatarHtml}
          ${p2AvatarHtml}
        </div>

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
              return this.renderScoreboardCircle(slot.monsterId, false, false,
                `data-team="0" data-slot="${slotIdx}" data-monster-id="${slot.monsterId}"`);
            }).join('')}
          </div>

          <!-- Center timer display -->
          <div class="scoreboard-center-hud">
            <div class="scoreboard-center-box">
              <div class="scoreboard-timer">${displayTime}</div>
              <div class="scoreboard-phase-text">${phaseText}</div>
            </div>
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
              
              return this.renderScoreboardCircle(slot.monsterId, false, true,
                `data-team="1" data-slot="${idx}" data-monster-id="${slot.monsterId}"`);
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

        ${showHUD ? `
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
                          transform: (isP2 && !isBattle) ? `scale(${-0.8 * dbMonster.scale}, ${0.8 * dbMonster.scale})` : `scale(${0.8 * dbMonster.scale})`,
                          extraStyle: 'pointer-events: none;'
                        })}
                      </div>
                      <div class="bench-slot-cost">${dbMonster.cost}费</div>
                    ` : ''}
                  </div>
                `;
              }).join('')}
            </div>
            <button id="exitBattleBtn" class="exit-battle-btn"></button><button id="completePrepBtn" class="action-ready-btn"></button>
        </div>
        ` : ''}

        
        <!-- Right Side details card overlay (Visible when a monster is selected) -->
        <div id="battleDetailsCardContainer" class="details-card" style="display: none; left: 1590px; top: 80px; z-index: 6;"></div>
        
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
          background: url('fight/fade.png') center/cover no-repeat;
          background-size: 100% 100%;
          display: none;
          opacity: 0;
          transition: opacity 0.5s ease-in-out;
          justify-content: center;
          align-items: center;
          z-index: 40;
          pointer-events: none;
          white-space: nowrap;
        "></div>
        
        <!-- Online waiting overlay (仅用于隐藏确认按钮，无文字无遮罩) -->
        <div id="onlineWaitOverlay" style="
          display: none; z-index: 45; pointer-events: none;
        "></div>
      </div>
    `;

    // 战斗 UI 延迟入场：仅从队伍界面过渡时应用
    if (document.body.getAttribute('data-battle-transition') === 'true') {
      document.body.removeAttribute('data-battle-transition');
      const battleView = document.getElementById('battleView');
      if (battleView) {
        battleView.classList.add('delayed-ui');
        // 入场动画完成后移除类，恢复点击
        setTimeout(() => {
          battleView.classList.remove('delayed-ui');
        }, 2500);
      }
    }

    this.bindEvents();
    this.startPrepTimer();
    this.updateDetailsCardContent();
    if (this._isOnline) this.bindNetworkForBattle();
  }

  private _renderReplay(): void {
    this.onDestroy();

    const roundNum = gameEngine.currentRound;
    this._placements = gameEngine.placementHistory[roundNum - 1] || [];

    const savedMonsters = gameEngine.savedBoardMonstersBeforeReplay || [];
    this._baseMonsters = savedMonsters.filter(m => m.placedRound < roundNum);

    this.resetBoardToBaseState();
    this._currentStep = 0;
    gameEngine.isReplayPaused = false;

    const isCombat = battleSystem.active;
    let phaseText = '布阵回放';
    let timerVal = `0 / ${this._placements.length}`;
    if (isCombat) {
      phaseText = `${gameEngine.p1Score} - ${gameEngine.p2Score}`;
      timerVal = '40';
    }

    const p1Draft = gameEngine.teams[0] || [];
    const p2Draft = gameEngine.teams[1] || [];
    const boardMonsters = gameEngine.boardMonsters;
    const p1Board = boardMonsters.filter(m => m.gridX < 5);
    const p2Board = boardMonsters.filter(m => m.gridX >= 6);

    const p1AvatarHtml = renderAvatarHtml(gameEngine.p1AvatarIndex, 'p1-frame', 135, false,
      'position:absolute;left:calc(50% - 269px);top:18px;z-index:9;');
    const p2AvatarHtml = renderAvatarHtml(gameEngine.p2AvatarIndex, 'p2-frame', 135, true,
      'position:absolute;left:calc(50% + 131px);top:18px;z-index:9;');

    this._container.innerHTML = `
      <div id="battleView" class="ui-interactive">

        <!-- Avatar layer (under top bar, same transform) -->
        <div style="position:absolute;top:0;left:50%;transform:translateX(-50%) scale(0.8);transform-origin:top center;width:2606px;height:216px;z-index:9;pointer-events:none;">
          ${p1AvatarHtml}
          ${p2AvatarHtml}
        </div>

        <div class="battle-scoreboard-top">
          <div class="scoreboard-team-row">
            ${Array(8).fill(0).map((_, idx) => {
              const slot = p1Draft[idx];
              if (!slot || slot.monsterId <= 0) return this.renderScoreboardCircle(0, false);
              const boardInst = p1Board.find(bm => bm.dbId === slot.monsterId);
              const isDead = isCombat ? (!boardInst || boardInst.isDead) : false;
              return this.renderScoreboardCircle(slot.monsterId, isDead);
            }).join('')}
          </div>
          <div class="scoreboard-center-hud">
            <div class="scoreboard-center-box">
              <div class="scoreboard-timer">${timerVal}</div>
              <div class="scoreboard-phase-text" style="color: #ffeb3b;">${phaseText} (Round ${roundNum})</div>
            </div>
          </div>
          <div class="scoreboard-team-row">
            ${Array(8).fill(0).map((_, idx) => {
              const slot = p2Draft[idx];
              if (!slot || slot.monsterId <= 0) return this.renderScoreboardCircle(0, false);
              const boardInst = p2Board.find(bm => bm.dbId === slot.monsterId);
              const isDead = isCombat ? (!boardInst || boardInst.isDead) : false;
              return this.renderScoreboardCircle(slot.monsterId, isDead);
            }).join('')}
          </div>
        </div>

        <div id="battleGrid" class="battle-grid-overlay">
          ${Array(5).fill(0).map((_, y) => {
            return Array(11).fill(0).map((_, x) => {
              let zoneClass = 'mid-zone';
              if (x < 5) zoneClass = 'left-zone';
              if (x >= 6) zoneClass = 'right-zone';
              return `<div class="battle-grid-cell ${zoneClass}" data-grid-x="${x}" data-grid-y="${y}"></div>`;
            }).join('');
          }).join('')}
        </div>

        <div id="hpBarsContainer" class="health-bars-overlay"></div>

        <div style="position: absolute; bottom: 40px; left: 50%; transform: translateX(-50%); display: flex; gap: 30px; align-items: center; z-index: 100;">
          <button id="replayPauseBtn" class="ui-interactive" style="width: 80px; height: 80px; background: url('fight/r1.png') center/contain no-repeat; background-color: transparent; border: none; cursor: pointer; outline: none; transition: filter 0.1s;"></button>
          <button id="replayNextBtn" class="ui-interactive" style="width: 80px; height: 80px; background: url('fight/r2.png') center/contain no-repeat; background-color: transparent; border: none; cursor: pointer; outline: none; transition: filter 0.1s;"></button>
          <button id="replayExitBtn" class="ui-interactive" style="width: 80px; height: 80px; background: url('fight/r3.png') center/contain no-repeat; background-color: transparent; border: none; cursor: pointer; outline: none; transition: filter 0.1s;"></button>
        </div>

        <div id="battleDetailsCardContainer" class="details-card" style="display: none; left: 1590px; top: 80px; z-index: 6;"></div>

        <div id="battleAnnouncement" style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; font-size: 80px; color: #ffffff; text-shadow: 6px 6px 0px #000000, -6px -6px 0px #000000, 6px -6px 0px #000000, -6px 6px 0px #000000, 6px 0px 0px #000000, -6px 0px 0px #000000, 0px 6px 0px #000000, 0px -6px 0px #000000; background: url('fight/fade.png') center/cover no-repeat; background-size: 100% 100%; display: none; justify-content: center; align-items: center; z-index: 999; text-align: center; pointer-events: none; white-space: nowrap;"></div>
      </div>
    `;

    this.bindEvents();
    this.updateDetailsCardContent();
    this.startPlacementPlayback();
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
    _globalIsWaiting = true;
    uiManager.syncStateWithUI();
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

        // 隐藏等待界面
        const waitEl = document.getElementById('onlineWaitOverlay');
        if (waitEl) waitEl.style.display = 'none';

        // showBattleStartAnnouncement 内部会设置 state=BATTLE、同步 UI、显示公告
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
    _globalIsWaiting = false;

    // Phase 1: 切换到 BATTLE 状态 → 敌方怪兽可见 → HUD 隐藏
    gameEngine.state = 'BATTLE';
    uiManager.syncStateWithUI();

    // Phase 2: 等 Canvas 渲染完怪兽后，再显示 "开始" 公告，动画结束后才启动战斗
    requestAnimationFrame(() => {
      this._showSimpleAnnouncement('开始', () => {
        battleSystem.startBattle();
        battleSystem.onBattleEndCallback = (winner) => {
          this.showRoundEndAnnouncement(winner);
        };
      });
    });
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
    if (this._isReplay) {
      this._bindReplayEvents();
      return;
    }

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
              dragEl.style.zIndex = '50';
              const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
              dragEl.style.transform = `translate(-50%, -50%) scale(${s})`;

              dragEl.innerHTML = `
                ${renderSpriteImg(dbMonster.sx, dbMonster.sy, dbMonster.sw, dbMonster.sh, {
                  absoluteCenter: true,
                  draggable: false,
                  transform: isP2 ? `scale(${-dbMonster.scale}, ${dbMonster.scale})` : `scale(${dbMonster.scale})`
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
              c.classList.remove('drag-hover-locked');
              c.classList.remove('drag-atk-range');
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
              dragEl.style.zIndex = '50';
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
              c.classList.remove('drag-hover-locked');
              c.classList.remove('drag-atk-range');
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
        
        if (monster && monster.dbId !== 126) {
          // Select monster and show details (same as battle phase)
          this._selectedMonsterId = monster.id;
          this.updateDetailsCardContent();
        } else {
          // Clicked empty space or mini monkey: clear selection
          this._selectedMonsterId = null;
          this.updateDetailsCardContent();
        }
      });
    });

    // 3. Scoreboard circle click → show detail card
    const circles = document.querySelectorAll('.scoreboard-circle');
    circles.forEach(circle => {
      const monsterId = circle.getAttribute('data-monster-id');
      if (!monsterId) return;
      circle.addEventListener('click', (e) => {
        e.stopPropagation();
        const team = circle.getAttribute('data-team') || '0';
        const slot = circle.getAttribute('data-slot') || '0';
        this._selectedMonsterId = `sb_${team}_${slot}`;
        this.updateDetailsCardContent();
      });
    });
  }

  private _bindReplayEvents(): void {
    // Replay control buttons
    const pauseBtn = document.getElementById('replayPauseBtn');
    pauseBtn?.addEventListener('click', () => {
      gameEngine.isReplayPaused = !gameEngine.isReplayPaused;
      if (pauseBtn) {
        pauseBtn.style.filter = gameEngine.isReplayPaused ? 'brightness(0.5)' : 'none';
      }
    });

    const nextBtn = document.getElementById('replayNextBtn');
    nextBtn?.addEventListener('click', () => {
      const nextRound = gameEngine.currentRound + 1;
      const totalRounds = gameEngine.perRoundStats.length;
      if (nextRound <= totalRounds) {
        gameEngine.currentRound = nextRound;
        this.render();
      } else {
        this.exitReplay();
      }
    });

    const exitBtn = document.getElementById('replayExitBtn');
    exitBtn?.addEventListener('click', () => {
      this.exitReplay();
    });

    // Grid click to select monster detail
    const cells = document.querySelectorAll('.battle-grid-cell');
    cells.forEach(cell => {
      cell.addEventListener('click', () => {
        const gridX = parseInt(cell.getAttribute('data-grid-x') || '0', 10);
        const gridY = parseInt(cell.getAttribute('data-grid-y') || '0', 10);
        const monster = gameEngine.getMonsterAt(gridX, gridY);
        if (monster && monster.dbId !== 126) {
          this._selectedMonsterId = monster.id;
        } else {
          this._selectedMonsterId = null;
        }
        this.updateDetailsCardContent();
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
    if (this._playbackInterval) {
      clearInterval(this._playbackInterval);
      this._playbackInterval = null;
    }
    if (battleSystem.active && this._isReplay) {
      battleSystem.active = false;
    }
    for (const unsub of this._unsubscribers) unsub();
    this._unsubscribers = [];
  }

  public updateDetailsCard(): void {
    // If selection changed or card hidden, do full rebuild
    if (this._selectedMonsterId !== this._lastRenderedMonsterId) {
      this.updateDetailsCardContent();
      this._lastRenderedMonsterId = this._selectedMonsterId;
      return;
    }

    // Same monster selected: only update dynamic values (HP, shield)
    if (!this._selectedMonsterId) return;

    let selectedMonster: PlacedMonster | null = null;
    if (this._selectedMonsterId.startsWith('bench_') || this._selectedMonsterId.startsWith('sb_')) {
      // Bench/sb monsters don't change dynamically, skip
      return;
    }
    selectedMonster = gameEngine.boardMonsters.find(m => m.id === this._selectedMonsterId) || null;
    if (!selectedMonster || selectedMonster.isDead) {
      this._selectedMonsterId = null;
      this.updateDetailsCardContent();
      this._lastRenderedMonsterId = null;
      return;
    }

    const hpEl = document.querySelector('#battleDetailsCardContainer .details-val-hp') as HTMLElement;
    const atkEl = document.querySelector('#battleDetailsCardContainer .details-val-atk') as HTMLElement;
    const atsEl = document.querySelector('#battleDetailsCardContainer .details-val-ats') as HTMLElement;
    if (hpEl) hpEl.textContent = `${selectedMonster.hp}/${selectedMonster.maxHp}`;
    if (atkEl) atkEl.textContent = `${selectedMonster.atk}`;
    if (atsEl) atsEl.textContent = `${typeof selectedMonster.ats === 'number' ? selectedMonster.ats.toFixed(2) : selectedMonster.ats}`;
  }

  public updateDetailsCardContent(): void {
    const cardContainer = document.getElementById('battleDetailsCardContainer');
    if (!cardContainer) return;

    if (!this._selectedMonsterId) {
      cardContainer.style.display = 'none';
      cardContainer.classList.remove('visible');
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
    } else if (this._selectedMonsterId.startsWith('sb_')) {
      // 计分板头像点击
      const parts = this._selectedMonsterId.split('_');
      const teamIdx = parseInt(parts[1], 10);
      const slotIdx = parseInt(parts[2], 10);
      const draftSlot = gameEngine.teams[teamIdx]?.[slotIdx];
      if (draftSlot && draftSlot.monsterId > 0) {
        const dbMonster = DB_MONSTERS.find(m => m.id === draftSlot.monsterId);
        if (dbMonster) {
          // 先尝试找已放置的怪兽（获取运行时 hp/atk 等）
          const boardMonster = gameEngine.boardMonsters.find(
            m => m.dbId === dbMonster.id && m.team === (teamIdx + 1)
          );
          if (boardMonster && !boardMonster.isDead) {
            selectedMonster = boardMonster;
          } else {
            selectedMonster = {
              id: this._selectedMonsterId,
              dbId: dbMonster.id,
              data: dbMonster,
              badges: draftSlot.badgeIds.map(id => {
                const realBadge = DB_BADGES.find(b => b.id === id);
                return realBadge ? { ...realBadge } : { id, name: '未知', desc: '' };
              }),
              gridX: 0, gridY: 0,
              initialGridX: 0, initialGridY: 0,
              placedRound: gameEngine.currentRound,
              team: (teamIdx + 1) as 1 | 2,
              hp: dbMonster.hp, maxHp: dbMonster.hp,
              atk: dbMonster.atk, ats: dbMonster.ats,
              range: dbMonster.range, speed: dbMonster.speed,
              shield: 0, skillCdProgress: 0,
              isDead: false, statusEffects: [],
              state: 'idle'
            };
          }
        }
      }
    } else {
      selectedMonster = gameEngine.boardMonsters.find(m => m.id === this._selectedMonsterId) || null;
    }

    if (!selectedMonster || selectedMonster.isDead || selectedMonster.dbId === 126 || selectedMonster.data.isSummon) {
      this._selectedMonsterId = null;
      cardContainer.style.display = 'none';
      cardContainer.classList.remove('visible');
      return;
    }

    cardContainer.style.display = 'block';
    cardContainer.classList.add('visible');

    const dbMonster = selectedMonster.data;
    
    const maxSlots = Math.max(selectedMonster.badges.length, dbMonster.cost === 4 ? 3 : 2);
    const badgesHtml = Array(maxSlots).fill(0).map((_, badgeIdx) => {
      const badge = selectedMonster.badges[badgeIdx];
      const imgHtml = badge ? renderBadgeImg(badge.id, 115) : '<span style="font-size:24px; color:#5a5a5a;">+</span>';
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

    this._lastRenderedMonsterId = this._selectedMonsterId;
  }

  // ==================== Replay Methods ====================

  private resetBoardToBaseState(): void {
    gameEngine.boardMonsters = this._baseMonsters.map(m => ({
      ...m,
      hp: m.maxHp,
      shield: 0,
      skillCdProgress: 0,
      isDead: false,
      statusEffects: [],
      gridX: m.initialGridX,
      gridY: m.initialGridY
    }));
  }

  private startPlacementPlayback(): void {
    if (this._playbackInterval) {
      clearInterval(this._playbackInterval);
    }

    this._playbackInterval = setInterval(() => {
      if (gameEngine.isReplayPaused || battleSystem.active) return;

      if (this._currentStep < this._placements.length) {
        const p = this._placements[this._currentStep];
        const savedMonsters = gameEngine.savedBoardMonstersBeforeReplay || [];
        const originalMonster = savedMonsters.find(
          m => m.dbId === p.monsterId && m.team === p.team && m.placedRound === gameEngine.currentRound
        );

        if (originalMonster) {
          const newPlaced: PlacedMonster = {
            ...originalMonster,
            hp: originalMonster.maxHp,
            shield: 0,
            skillCdProgress: 0,
            isDead: false,
            statusEffects: [],
            gridX: p.gridX,
            gridY: p.gridY,
            initialGridX: p.gridX,
            initialGridY: p.gridY
          };
          gameEngine.boardMonsters.push(newPlaced);

          const scrPos = gridToScreen(p.gridX, p.gridY);
          vfx.addParticle(scrPos.x, scrPos.y, 'heal', 0.4, '#5ac54f', 15);
          vfx.addFloatingText(scrPos.x, scrPos.y, newPlaced.data.name, '#5ac54f');
        }

        this._currentStep++;

        const timerEl = document.querySelector('.scoreboard-timer');
        if (timerEl) {
          timerEl.textContent = `${this._currentStep} / ${this._placements.length}`;
        }
      } else {
        clearInterval(this._playbackInterval);
        this._playbackInterval = null;
        this.startReplayBattle();
      }
    }, this._stepIntervalMs);
  }

  private startReplayBattle(): void {
    battleSystem.onBattleEndCallback = (winner) => {
      this.handleReplayBattleEnd(winner);
    };

    gameEngine.setReplaySeed(gameEngine.currentRound * 1000 + 456);
    battleSystem.startBattle();

    const timerEl = document.querySelector('.scoreboard-timer');
    if (timerEl) timerEl.textContent = `${Math.ceil(battleSystem.timeLeft)}`;
    const phaseEl = document.querySelector('.scoreboard-phase-text');
    if (phaseEl) phaseEl.textContent = `战斗回放 (Round ${gameEngine.currentRound})`;
  }

  private handleReplayBattleEnd(winner: 1 | 2 | null): void {
    const el = document.getElementById('battleAnnouncement');
    if (el) {
      if (winner === 1) {
        el.textContent = "我方获胜";
      } else if (winner === 2) {
        el.textContent = "对手获胜";
      } else {
        el.textContent = "平局";
      }
      el.style.display = 'flex';
    }

    setTimeout(() => {
      if (el) el.style.display = 'none';

      const nextRound = gameEngine.currentRound + 1;
      const totalRounds = gameEngine.perRoundStats.length;

      if (nextRound <= totalRounds) {
        gameEngine.currentRound = nextRound;
        this.render();
      } else {
        this.exitReplay();
      }
    }, 2500);
  }

  public exitReplay(): void {
    this.onDestroy();

    gameEngine.isReplaying = false;
    gameEngine.isReplayPaused = false;

    if (gameEngine.savedStateBeforeReplay) gameEngine.state = gameEngine.savedStateBeforeReplay;
    if (gameEngine.savedBoardMonstersBeforeReplay) gameEngine.boardMonsters = gameEngine.savedBoardMonstersBeforeReplay;
    if (gameEngine.savedCurrentRoundBeforeReplay) gameEngine.currentRound = gameEngine.savedCurrentRoundBeforeReplay;

    uiManager.syncStateWithUI();
  }

  public updateReplayFrame(): void {
    if (battleSystem.active) {
      const timerEl = document.querySelector('.scoreboard-timer');
      if (timerEl) {
        timerEl.textContent = `${Math.ceil(battleSystem.timeLeft)}`;
      }
    }
    this._updateReplayHpBars();
    this.updateDetailsCard();
  }

  private _updateReplayHpBars(): void {
    const container = document.getElementById('hpBarsContainer');
    if (!container) return;

    if (!battleSystem.active) {
      container.innerHTML = '';
      return;
    }

    const living = gameEngine.boardMonsters.filter(m => !m.isDead);
    const gridW = 1380;
    const gridH = 707;
    const leftOffset = 588;
    const topOffset = 236;

    container.innerHTML = living.map(m => {
      const scrPos = battleSystem.screenPositions.get(m.id);
      if (!scrPos) return '';

      const pctX = ((scrPos.x - leftOffset) / gridW) * 100;
      const pctY = ((scrPos.y - topOffset) / gridH) * 100;
      const hpPercent = (m.hp / m.maxHp) * 100;

      const uniqueEffects = m.statusEffects.filter((effect, idx, self) =>
        self.findIndex(e => e.type === effect.type) === idx
      );

      const statusIconsHtml = uniqueEffects.map(effect => {
        let symbol = '';
        let color = '#fff';
        if (effect.type === 'poison') { symbol = '\u{1F9E0}'; color = '#39ff14'; }
        else if (effect.type === 'bleed') { symbol = '\u{1FA78}'; color = '#f44336'; }
        else if (effect.type === 'burn') { symbol = '\u{1F525}'; color = '#ff9800'; }
        else if (effect.type === 'stun') { symbol = '\u{1F300}'; color = '#ffeb3b'; }
        else if (effect.type === 'chill') { symbol = '\u{2744}\u{FE0F}'; color = '#2196f3'; }
        else if (effect.type === 'stealth') { symbol = '\u{1F465}'; color = '#9c27b0'; }
        else if (effect.type === 'invincible') { symbol = '\u{1F6E1}\u{FE0F}'; color = '#ffd700'; }
        else if (effect.type === 'fortified') { symbol = '\u{1FAA8}'; color = '#8b7355'; }
        return `<span style="font-size: 15px; color: ${color}; filter: drop-shadow(1px 1px 0px #000);">${symbol}</span>`;
      }).join('');

      const hasSkill = m.data.skillCd > 0;
      const skillPct = hasSkill ? Math.min(100, (m.skillCdProgress / m.data.skillCd) * 100) : 0;

      return `
        <div class="hp-bar-wrapper" style="
          left: ${pctX}%; 
          top: ${pctY}%; 
          transform: translate(-50%, -100%) translateY(-32px);
          width: 50px;
          position: absolute;
        ">
          <div class="status-effects-bar" style="display:flex;gap:2px;justify-content:center;height:18px;margin-bottom:2px;width:50px;">
            ${statusIconsHtml}
          </div>
          <div class="hp-bar-container" style="width:50px;height:8px;background-color:#000;border:1px solid #5a5a5a;padding:1px;display:flex;align-items:center;box-sizing:border-box;">
            <div class="hp-bar-fill" style="width:${hpPercent}%;height:4px;background-color:#5ac54f;"></div>
          </div>
          ${hasSkill ? `
            <div class="skill-bar-container" style="width:50px;height:4px;background-color:#000;border:1px solid #5a5a5a;padding:1px;margin-top:2px;display:flex;align-items:center;box-sizing:border-box;">
              <div class="skill-bar-fill" style="width:${skillPct}%;height:2px;background-color:#ffd700;"></div>
            </div>
          ` : ''}
          ${m.shield > 0 ? `
            <div style="position: absolute; left: 54px; top: 20px; background:#0d2d52; border:1px solid #4ba3e3; color:#7dd4ff; font-family:'Press Start 2P','Zpix',monospace; font-size:12px; line-height:1; padding:2px 3px; display:flex;align-items:center;justify-content:center; min-width:10px; text-align:center; white-space:nowrap;">${m.shield}</div>
          ` : ''}
        </div>
      `;
    }).join('');
  }
}
export const CANVAS_W = 1280;
export const CANVAS_H = 720;
