import { gameEngine, PlacedMonster } from '../game/GameEngine';
import { DB_MONSTERS, BADGE_SPRITES, DB_BADGES } from '../game/Database';
import { battleSystem } from '../game/BattleSystem';
import { uiManager } from './UIManager';

export class BattleUI {
  private _container: HTMLDivElement;
  private _selectedMonsterId: string | null = null;
  private _isDragging: boolean = false;
  


  // Countdown timer interval
  private _timerInterval: any = null;

  constructor(container: HTMLDivElement) {
    this._container = container;
  }

  private renderScoreboardCircle(monsterId: number, isDead: boolean): string {
    if (monsterId <= 0) {
      return `<div class="scoreboard-circle question">?</div>`;
    }
    const dbMonster = DB_MONSTERS.find(m => m.id === monsterId);
    if (!dbMonster) {
      return `<div class="scoreboard-circle question">?</div>`;
    }

    const deadClass = isDead ? 'dead' : '';

    return `
      <div class="scoreboard-circle ${deadClass}" style="display: flex; justify-content: center; align-items: center; overflow: hidden; position: relative;">
        <img src="all.png" style="
          object-fit: none;
          object-position: -${dbMonster.sx}px -${dbMonster.sy}px;
          width: ${dbMonster.sw}px;
          height: ${dbMonster.sh}px;
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%) scale(${64 / dbMonster.sw});
          transform-origin: center;
          display: block;
          border: none;
          background: transparent;
        " />
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
    const p1Draft = gameEngine.teams[0] || [];
    const p2Draft = gameEngine.teams[1] || [];
    
    const boardMonsters = gameEngine.boardMonsters;
    const p1Board = boardMonsters.filter(m => m.gridX < 5);
    const p2Board = boardMonsters.filter(m => m.gridX >= 6);
    // Monster IDs already placed by the current active team
    const usedMonsterIds = new Set((isP1 ? p1Board : p2Board).map(m => m.dbId));

    // Left dummy avatar
    const dummy = DB_MONSTERS[0];
    const dummyHtml = `
      <div class="player-avatar-frame p1-frame" style="display: flex; justify-content: center; align-items: center; overflow: hidden; position: relative;">
        <img src="all.png" style="
          object-fit: none;
          object-position: -${dummy.sx}px -${dummy.sy}px;
          width: ${dummy.sw}px;
          height: ${dummy.sh}px;
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%) scale(${80 / dummy.sw});
          transform-origin: center;
          display: block;
          border: none;
          background: transparent;
        " />
      </div>
    `;

    // Right cowgirl avatar
    const cowboy = DB_MONSTERS[3];
    const cowboyHtml = `
      <div class="player-avatar-frame p2-frame" style="display: flex; justify-content: center; align-items: center; overflow: hidden; position: relative;">
        <img src="all.png" style="
          object-fit: none;
          object-position: -${cowboy.sx}px -${cowboy.sy}px;
          width: ${cowboy.sw}px;
          height: ${cowboy.sh}px;
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%) scale(${80 / cowboy.sw});
          transform-origin: center;
          display: block;
          border: none;
          background: transparent;
        " />
      </div>
    `;

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


    this._container.innerHTML = `
      <div id="battleView" class="ui-interactive">
        
        <!-- Top HUD Scoreboard -->
        <div class="battle-scoreboard-top">
          <!-- Left side P1 avatars -->
          <div class="scoreboard-team-row">
            ${Array(8).fill(0).map((_, idx) => {
              const slot = p1Draft[idx];
              if (!slot || slot.monsterId <= 0) return this.renderScoreboardCircle(0, false);
              const boardInst = p1Board.find(bm => bm.dbId === slot.monsterId);
              const isDead = isBattle ? (!boardInst || boardInst.isDead) : false;
              return this.renderScoreboardCircle(slot.monsterId, isDead);
            }).join('')}
          </div>

          <!-- Center timer & avatar display -->
          <div class="scoreboard-center-hud">
            ${dummyHtml}
            <div class="scoreboard-center-box">
              <div class="scoreboard-timer">${displayTime}</div>
              <div class="scoreboard-phase-text">${phaseText}</div>
            </div>
            ${cowboyHtml}
          </div>

          <!-- Right side P2 avatars -->
          <div class="scoreboard-team-row">
            ${Array(8).fill(0).map((_, idx) => {
              const slot = p2Draft[idx];
              if (!slot || slot.monsterId <= 0) return this.renderScoreboardCircle(0, false);
              
              // Fog of War: hide P2 team until battle phase
              if (isP1 || isP2) {
                return `<div class="scoreboard-circle question">?</div>`;
              }
              
              const boardInst = p2Board.find(bm => bm.dbId === slot.monsterId);
              const isDead = isBattle ? (!boardInst || boardInst.isDead) : false;
              return this.renderScoreboardCircle(slot.monsterId, isDead);
            }).join('')}
          </div>
        </div>

        <!-- 11x5 Grid Overlay over Canvas -->
        <div id="battleGrid" class="battle-grid-overlay">
          ${Array(5).fill(0).map((_, y) => {
            return Array(11).fill(0).map((_, x) => {

              
              // Zone check
              let zoneClass = 'mid-zone';
              if (x < 5) zoneClass = 'left-zone';
              if (x >= 6) zoneClass = 'right-zone';



              // Grid cell is droppable depending on turn
              const isDroppable = (isP1 && x < 5) || (isP2 && x >= 6);

              return `
                <div class="battle-grid-cell ${zoneClass}" 
                     data-grid-x="${x}" 
                     data-grid-y="${y}" 
                     data-droppable="${isDroppable}">
                  
                  <!-- Canvas handles drawing monster sprites -->


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
          <!-- Purple mask to cover pre-drawn background stats -->
          <div style="position: absolute; left: 16px; top: 16px; width: 1186px; height: 50px; background-color: #8030b6; z-index: 1;"></div>
          
          <!-- Cost display absolute positioned at top-left in both prep and battle phases -->
          <div class="bench-header-stat" style="position: absolute; left: 36px; top: 26px; z-index: 2;">
            <div style="width: 24px; height: 24px; overflow: hidden; position: relative; display: inline-block;">
              <img src="details.png" style="
                position: absolute;
                left: -226px;
                top: -17px;
                width: 395px;
                height: 413px;
                border: none;
              " />
            </div>
            <span>${usedBudget} / ${currentBudgetLimit}</span>
          </div>

          ${isBattle ? '' : `

            <!-- 8 bench slots aligned exactly with bench.png coordinates -->
            <div class="bench-container" style="z-index: 2;">
              ${(isP1 ? p1Draft : p2Draft).map((slot, index) => {
                const dbMonster = DB_MONSTERS.find(m => m.id === slot.monsterId);
                const isUsed = dbMonster ? usedMonsterIds.has(slot.monsterId) : false;
                return `
                  <div class="bench-slot" data-slot-index="${index}" data-used="${isUsed}" draggable="false" ${isUsed ? 'style="filter:grayscale(0.85);cursor:not-allowed;opacity:0.6;"' : ''}>
                    ${dbMonster ? `
                      <div style="
                        width: ${dbMonster.sw * 0.55}px;
                        height: ${dbMonster.sh * 0.55}px;
                        position: relative;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        pointer-events: none;
                      ">
                        <img src="all.png" draggable="false" style="
                          object-fit: none;
                          object-position: -${dbMonster.sx}px -${dbMonster.sy}px;
                          width: ${dbMonster.sw}px;
                          height: ${dbMonster.sh}px;
                          transform: translate(-50%, -50%) ${isP2 ? 'scale(-0.55, 0.55)' : 'scale(0.55)'};
                          transform-origin: center;
                          position: absolute;
                          left: 50%;
                          top: 50%;
                          display: block;
                          border: none;
                          background: transparent;
                          pointer-events: none;
                        " />
                      </div>
                      <div class="bench-slot-cost">${dbMonster.cost}费</div>
                    ` : ''}
                  </div>
                `;
              }).join('')}
            </div>

          `}
        </div>
        
        ${!isBattle ? `<button id="completePrepBtn" class="action-ready-btn"></button>` : ''}

        
        <!-- Right Side details card overlay (Visible when a monster is selected) -->
        <div id="battleDetailsCardContainer" class="details-card" style="display: none; left: 1980px; top: 310px; z-index: 15;"></div>
        
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
      </div>
    `;

    this.bindEvents();
    this.startPrepTimer();
    this.updateDetailsCardContent();
  }

  // --- Prep timer logic ---
  private _prepTimeLeft: number = 20;

  private getPrepTimeLeft(): number {
    return this._prepTimeLeft;
  }

  private startPrepTimer(): void {
    if (gameEngine.state === 'BATTLE') return;

    this._prepTimeLeft = 20;
    
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

    if (gameEngine.state === 'PREPARATION_LEFT') {
      gameEngine.state = 'PREPARATION_RIGHT';
      uiManager.syncStateWithUI();
    } else if (gameEngine.state === 'PREPARATION_RIGHT') {
      // Show "开始" announcement before battle starts
      this.showBattleStartAnnouncement();
    }
  }

  private showBattleStartAnnouncement(): void {
    const el = document.getElementById('battleAnnouncement');
    if (!el) {
      // Fallback: start immediately
      this._doStartBattle();
      return;
    }

    el.textContent = '开始';
    el.style.display = 'flex';
    el.style.opacity = '0';
    el.offsetHeight; // force reflow
    el.style.opacity = '1';

    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => {
        el.style.display = 'none';
        this._doStartBattle();
      }, 500);
    }, 1200);
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
    const el = document.getElementById('battleAnnouncement');
    if (!el) {
      uiManager.syncStateWithUI();
      return;
    }

    // Record this round's result and elapsed time
    gameEngine.roundResults.push(winner);
    const elapsed = Math.max(0, 40 - battleSystem.timeLeft);
    gameEngine.lastRoundElapsed = elapsed;
    gameEngine.saveRoundStats(elapsed);

    // Update scoreboard text dynamically on screen immediately
    const scoreTextEl = document.querySelector('.scoreboard-phase-text');
    if (scoreTextEl) {
      scoreTextEl.textContent = `${gameEngine.p1Score} - ${gameEngine.p2Score}`;
    }

    // Initial state: flex display but fully transparent
    el.style.display = 'flex';
    el.style.opacity = '0';

    if (winner === 1) {
      el.textContent = "我方得分";
    } else if (winner === 2) {
      el.textContent = "对手得分";
    } else {
      el.textContent = "平局";
    }

    // Force reflow and trigger fade in
    el.offsetHeight;
    el.style.opacity = '1';

    const isGameOver = gameEngine.isGameOver();

    // 1. After showing the score text, fade it out
    setTimeout(() => {
      el.style.opacity = '0';

      // 2. Wait for fade-out to finish (500ms), then swap text and fade in the next state
      setTimeout(() => {
        if (isGameOver) {
          el.textContent = "游戏结束";
          el.style.opacity = '1';

          // 3. After showing game over, fade out and transit state
          setTimeout(() => {
            el.style.opacity = '0';
            setTimeout(() => {
              el.style.display = 'none';
              gameEngine.state = 'GAME_OVER';
              uiManager.syncStateWithUI();
            }, 500);
          }, 1500);
        } else {
          el.textContent = `第 ${gameEngine.currentRound + 1} 回合`;
          el.style.opacity = '1';

          // 3. After showing next round, fade out and advance round
          setTimeout(() => {
            el.style.opacity = '0';
            setTimeout(() => {
              el.style.display = 'none';
              gameEngine.currentRound += 1;
              gameEngine.state = 'PREPARATION_LEFT';
              gameEngine.resetBoardForNextRound();
              uiManager.syncStateWithUI();
            }, 500);
          }, 1500);
        }
      }, 500);
    }, 1800);
  }

  private bindEvents(): void {
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

          const activeTeamSlot = (isP1 ? gameEngine.teams[0] : gameEngine.teams[1])[idx];
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

              // Create floating pixel helper
              dragEl = document.createElement('div');
              dragEl.className = 'drag-avatar-helper';
              dragEl.style.position = 'absolute';
              dragEl.style.width = `${dbMonster.sw * 1.1}px`;
              dragEl.style.height = `${dbMonster.sh * 1.1}px`;
              dragEl.style.pointerEvents = 'none';
              dragEl.style.zIndex = '9999';
              const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
              dragEl.style.transform = `translate(-50%, -50%) scale(${s})`;

              dragEl.innerHTML = `
                <img src="all.png" draggable="false" style="
                  object-fit: none;
                  object-position: -${dbMonster.sx}px -${dbMonster.sy}px;
                  width: ${dbMonster.sw}px;
                  height: ${dbMonster.sh}px;
                  transform: translate(-50%, -50%) ${isP2 ? 'scale(-1.1, 1.1)' : 'scale(1.1)'};
                  transform-origin: center;
                  position: absolute;
                  left: 50%;
                  top: 50%;
                  display: block;
                  border: none;
                " />
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
                    // Iron Monkey (throw) target position (closest enemy or 4 cells forward)
                    const team = isP1 ? 1 : 2;
                    const enemies = gameEngine.boardMonsters.filter(m => m.team !== team && !m.isDead);
                    let closestEnemy = null;
                    let minDist = Infinity;
                    for (const e of enemies) {
                      const dx = e.gridX - gx;
                      const dy = e.gridY - gy;
                      const dist = dx * dx + dy * dy;
                      if (dist < minDist) {
                        minDist = dist;
                        closestEnemy = e;
                      }
                    }
                    let destX = gx;
                    let destY = gy;
                    if (closestEnemy) {
                      destX = closestEnemy.gridX;
                      destY = closestEnemy.gridY;
                    } else {
                      const throwDir = isP1 ? 1 : -1;
                      destX = Math.max(0, Math.min(10, gx + 4 * throwDir));
                    }
                    const landCell = document.querySelector(`.battle-grid-cell[data-grid-x="${destX}"][data-grid-y="${destY}"]`);
                    if (landCell) landCell.classList.add('drag-target-landing');
                  }
                }
              }
            }
          };

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

              const activeTeam = isP1 ? gameEngine.teams[0] : gameEngine.teams[1];
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

              // Create floating pixel helper
              dragEl = document.createElement('div');
              dragEl.className = 'drag-avatar-helper';
              dragEl.style.position = 'absolute';
              dragEl.style.width = `${dbMonster.sw * 1.1}px`;
              dragEl.style.height = `${dbMonster.sh * 1.1}px`;
              dragEl.style.pointerEvents = 'none';
              dragEl.style.zIndex = '9999';
              const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
              dragEl.style.transform = `translate(-50%, -50%) scale(${s})`;

              dragEl.innerHTML = `
                <img src="all.png" draggable="false" style="
                  object-fit: none;
                  object-position: -${dbMonster.sx}px -${dbMonster.sy}px;
                  width: ${dbMonster.sw}px;
                  height: ${dbMonster.sh}px;
                  transform: translate(-50%, -50%) ${sourceMonster.team === 2 ? 'scale(-1.1, 1.1)' : 'scale(1.1)'};
                  transform-origin: center;
                  position: absolute;
                  left: 50%;
                  top: 50%;
                  display: block;
                  border: none;
                " />
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
                    const dir = sourceMonster.team === 1 ? 1 : -1;
                    const landX = Math.max(0, Math.min(10, tx + 6 * dir));
                    const landY = ty;
                    const landCell = document.querySelector(`.battle-grid-cell[data-grid-x="${landX}"][data-grid-y="${landY}"]`);
                    if (landCell) landCell.classList.add('drag-target-landing');
                  } else if (dbMonster.id === 117) {
                    // Iron Monkey (throw) target position (closest enemy or 4 cells forward)
                    const team = sourceMonster.team;
                    const enemies = gameEngine.boardMonsters.filter(m => m.team !== team && !m.isDead);
                    let closestEnemy = null;
                    let minDist = Infinity;
                    for (const e of enemies) {
                      const dx = e.gridX - tx;
                      const dy = e.gridY - ty;
                      const dist = dx * dx + dy * dy;
                      if (dist < minDist) {
                        minDist = dist;
                        closestEnemy = e;
                      }
                    }
                    let destX = tx;
                    let destY = ty;
                    if (closestEnemy) {
                      destX = closestEnemy.gridX;
                      destY = closestEnemy.gridY;
                    } else {
                      const throwDir = team === 1 ? 1 : -1;
                      destX = Math.max(0, Math.min(10, tx + 4 * throwDir));
                    }
                    const landCell = document.querySelector(`.battle-grid-cell[data-grid-x="${destX}"][data-grid-y="${destY}"]`);
                    if (landCell) landCell.classList.add('drag-target-landing');
                  }
                }
              }
            }
          };

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
          // Select monster
          this._selectedMonsterId = monster.id;
          this.updateDetailsCardContent();
          
          // Withdraw logic during prep phase
          if ((isP1 || isP2) && cell.getAttribute('data-droppable') === 'true') {
            const removed = gameEngine.removeMonster(monster.id);
            if (removed) {
              if (this._selectedMonsterId === monster.id) {
                this._selectedMonsterId = null;
              }
              this.render();
            } else {
              // Flash alert on retro-title
              const tEl = document.querySelector('.scoreboard-phase-text');
              if (tEl) {
                const oldText = tEl.textContent;
                tEl.textContent = "已锁定！";
                tEl.setAttribute('style', 'color: #ff3333;');
                setTimeout(() => {
                  tEl.textContent = oldText;
                  tEl.removeAttribute('style');
                }, 1500);
              }
            }
          }
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

  // Cleanup timers on destruction
  public onDestroy(): void {
    if (this._timerInterval) {
      clearInterval(this._timerInterval);
    }
  }

  public updateDetailsCard(): void {
    this.updateDetailsCardContent();
  }

  private getSkillIconHtml(skillName: string): string {
    let badgeId = 11; // default to Shield
    if (skillName === 'reap') badgeId = 19;
    else if (skillName === 'lightning') badgeId = 4;
    else if (skillName === 'life_link') badgeId = 6;
    else if (skillName === 'incendiary') badgeId = 24;
    else if (skillName === 'recovery') badgeId = 17;
    else if (skillName === 'rush') badgeId = 5;
    else if (skillName === 'big_cannon') badgeId = 20;
    else if (skillName === 'leap') badgeId = 22;
    else if (skillName === 'shot') badgeId = 20;
    else if (skillName === 'shield') badgeId = 11;
    else if (skillName === 'wind_attack') badgeId = 31;
    else if (skillName === 'heal_sword') badgeId = 7;
    else if (skillName === 'explosive') badgeId = 24;
    else if (skillName === 'open_fire') badgeId = 29;
    else if (skillName === 'unyielding') badgeId = 32;
    else if (skillName === 'dig') badgeId = 21;
    else if (skillName === 'throw') badgeId = 13;
    else if (skillName === 'slash') badgeId = 27;
    else if (skillName === 'shadow') badgeId = 26;
    else if (skillName === 'attack') badgeId = 15;
    else if (skillName === 'cultivation') badgeId = 16;
    else if (skillName === 'anger') badgeId = 22;
    else if (skillName === 'bash') badgeId = 13;
    else if (skillName === 'snowball') badgeId = 25;
    else if (skillName === 'conversion') badgeId = 34;

    const sprite = BADGE_SPRITES[badgeId];
    if (!sprite) return '';
    const scale = 64 / sprite.sw;
    const imgW = 2556 * scale;
    const imgH = 1417 * scale;
    const left = -sprite.sx * scale;
    const top = -sprite.sy * scale;
    return `
      <div style="width: 64px; height: 64px; overflow: hidden; position: relative; display: flex; justify-content: center; align-items: center; background: transparent;">
        <img src="badge.png" style="
          position: absolute;
          left: ${left}px;
          top: ${top}px;
          width: ${imgW}px;
          height: ${imgH}px;
          border: none;
          background: transparent;
        " />
      </div>
    `;
  }

  private getSkillChineseDescription(dbId: number): string {
    const skillMap: Record<number, string> = {
      101: "撕裂：旋转对周围一圈敌人造成 120 伤害，并附带流血效果（流血：每秒受到 40 伤害，持续 3s）。",
      102: "闪电：对范围内最多 4 个敌人造成 570 伤害，并有 50% 概率附加 2 秒眩晕。",
      103: "生命链接：将范围内所有友方的生命值按百分比平均分摊。",
      104: "散弹：普通攻击就是散射五颗子弹；技能会发射燃烧弹击退目标 1 格并施加燃烧。",
      105: "回血连线：战斗开始时连线周围友军，自身攻击伤害时连线友军回血自身血量 2%。",
      106: "冲锋：战斗开始时向前突进，撞击对手并将其击退两格，造成眩晕。",
      107: "蓄力重炮：战斗开始时蓄力 2 秒，发射重炮对直线上敌人造成 13 倍攻击力的毁灭伤害。",
      108: "守护跳跃：跳跃至最近受伤 of 友方身边，对落点周围敌人造成 540 伤害。",
      109: "银色狙击：下一次普通攻击必定造成 4 倍伤害。",
      110: "帝国防护：每 6 秒（及开局）给自己和相邻友方 5 层护盾。护盾可减免 60% 伤害，每受一次伤害减 1 层。",
      111: "旋风斩：旋转大剑对周围一圈敌人造成 2 倍攻击力的范围伤害。",
      112: "守护之剑：使周围友方回复 5% 生命值（生效两次），自己额外回复 8%。",
      113: "爆破普通攻击：普通攻击带有溅射效果，能同时攻击到相邻的怪兽。",
      114: "疯狂扫射：开局攻速提升 200%，攻击力提升 12，持续 2.5s。",
      115: "不屈意志：每 10 秒回血 500；生命值低于 1000 时，所有普通攻击必定暴击。",
      116: "强力钻地：开局向前挖掘 6 格，沿途敌人眩晕，并给自己增加 6 层护盾。",
      117: "铁甲投掷：将身后怪兽向前投出，两个怪兽同时获得 8 层护盾，落点周围造成盾值 45 倍的范围伤害。",
      118: "影子斩击：突进到周围一个目标身后造成 192 伤害，共突进 3 次。",
      119: "忍者瞬移：战斗开始时瞬移到最远敌人身边。每释放两次技能获得 2 秒隐身。",
      120: "金面猴王：使周围 2 格内友方攻击力增加 30，持续 3s。",
      121: "僧侣修行：战斗属性提升，攻击力增加 40，生命上限增加 300，但生命上限扣减 20% 当前血量。",
      122: "野性之怒：每次释放技能攻速增加 10%，可无限叠加。",
      123: "棒球重击：对敌人造成 207 伤害，且每释放两次技能召唤一个小猴参战。",
      124: "极寒雪球：使周围 2 格内怪兽受到寒冷减速（攻速-35%），并造成 2 倍攻击力伤害。",
      125: "战壕转换：吸收周围 1 格所有效果，每吸收一个提升最大血量 30，增加攻击力 50，持续 2 秒。"
    };
    return skillMap[dbId] || "普通攻击：无特殊技能。";
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
    
    const badgesHtml = Array(dbMonster.cost === 4 ? 3 : 2).fill(0).map((_, badgeIdx) => {
      const badge = selectedMonster.badges[badgeIdx];
      let badgeImgHtml = `<span style="font-size:24px; color:#5a5a5a;">+</span>`;
      if (badge) {
        const sprite = BADGE_SPRITES[badge.id];
        if (sprite) {
          const scale = 64 / sprite.sw;
          const imgW = 2556 * scale;
          const imgH = 1417 * scale;
          const left = -sprite.sx * scale;
          const top = -sprite.sy * scale;
          badgeImgHtml = `
            <div style="width: 64px; height: 64px; overflow: hidden; position: relative; display: flex; justify-content: center; align-items: center; background: transparent;">
              <img src="badge.png" style="
                position: absolute;
                left: ${left}px;
                top: ${top}px;
                width: ${imgW}px;
                height: ${imgH}px;
                border: none;
                background: transparent;
              " />
            </div>
          `;
        }
      }

      const equippedClass = badge ? 'equipped' : '';
      return `
        <div class="details-badge-slot-frame ${equippedClass}" data-badge-slot="${badgeIdx}" style="cursor: default;">
          ${badgeImgHtml}
        </div>
      `;
    }).join('');

    cardContainer.innerHTML = `
      <!-- Avatar Frame -->
      <div class="details-avatar-frame">
        <img src="all.png" style="
          object-fit: none;
          object-position: -${dbMonster.sx}px -${dbMonster.sy}px;
          width: ${dbMonster.sw}px;
          height: ${dbMonster.sh}px;
        " />
      </div>

      <!-- Stars and Race/Role -->
      <div class="details-stars-container" style="font-size: 10px; flex-direction: column; align-items: center; gap: 2px;">
        <span style="font-size: 14px; color: #e5c158;">★★★</span>
        <span style="color: #ffffff; font-family: 'Press Start 2P', 'Zpix', monospace; font-weight: bold;">[ ${dbMonster.race} | ${dbMonster.role} ]</span>
      </div>

      <!-- Name banner -->
      <div class="details-name-banner">${dbMonster.name}</div>

      <!-- Stats overlays (values only) -->
      <div class="details-val details-val-hp">${selectedMonster.hp}/${selectedMonster.maxHp}</div>
      <div class="details-val details-val-atk">${selectedMonster.atk}</div>
      <div class="details-val details-val-ats">${selectedMonster.ats.toFixed(2)}</div>
      <div class="details-val details-val-range">${selectedMonster.range}</div>
      <div class="details-val details-val-shield">${selectedMonster.shield}</div>
      <div class="details-val details-val-cd">${dbMonster.skillCd}</div>
      <div class="details-val details-val-speed">${selectedMonster.speed}</div>

      <!-- Skill Box -->
      <div class="details-skill-section">
        <div class="details-skill-icon-frame">
          ${this.getSkillIconHtml(dbMonster.skill)}
        </div>
        <div class="details-skill-desc-box">
          <div style="color:#e5c158; font-size:30px; margin-bottom:4px;">${dbMonster.skill} (CD: ${dbMonster.skillCd}s)</div>
          <div>${this.getSkillChineseDescription(dbMonster.id)}</div>
        </div>
      </div>

      <!-- Equipped Badges Slots -->
      <div class="details-badges-section" style="background-color: #b4b3a1;">
        ${badgesHtml}
      </div>
    `;
  }
}
export const CANVAS_W = 1280;
export const CANVAS_H = 720;
