import { gameEngine, PlacedMonster } from '../game/GameEngine';
import { DB_MONSTERS, BADGE_SPRITES } from '../game/Database';
import { battleSystem, gridToScreen } from '../game/BattleSystem';
import { uiManager } from './UIManager';
import { vfx } from '../game/VfxManager';

export class ReplayUI {
  private _container: HTMLDivElement;
  private _selectedMonsterId: string | null = null;
  private _currentStep: number = 0;
  private _placements: any[] = [];
  private _baseMonsters: PlacedMonster[] = [];
  
  // Placement phase timer
  private _playbackInterval: any = null;
  private _stepIntervalMs: number = 1200; // 1.2s per monster placement

  constructor(container: HTMLDivElement) {
    this._container = container;
  }

  public render(): void {
    // Clean up any ongoing timer/battle simulation from a previous round's replay
    this.onDestroy();

    const roundNum = gameEngine.currentRound;
    // Read placement history for current round
    this._placements = gameEngine.placementHistory[roundNum - 1] || [];
    
    // Base monsters (placed in previous rounds)
    const savedMonsters = gameEngine.savedBoardMonstersBeforeReplay || [];
    this._baseMonsters = savedMonsters.filter(m => m.placedRound < roundNum);

    // Initial setup of board: only base monsters
    this.resetBoardToBaseState();
    
    // Start step sequence
    this._currentStep = 0;
    gameEngine.isReplayPaused = false;
    
    // Build and bind UI
    this.rebuildDOM();
    this.startPlacementPlayback();
  }

  private resetBoardToBaseState(): void {
    // Restore base monsters to their initial layout state (full health, zero cd/shield)
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

  private rebuildDOM(): void {
    const roundNum = gameEngine.currentRound;
    const isCombat = battleSystem.active;
    
    // Get phase labels
    let phaseText = '布阵回放';
    let timerVal = `${this._currentStep} / ${this._placements.length}`;
    
    if (isCombat) {
      phaseText = `${gameEngine.p1Score} - ${gameEngine.p2Score}`;
      timerVal = '40';
    }

    // Scoreboard circles for P1 and P2 drafts
    const p1Draft = gameEngine.teams[0] || [];
    const p2Draft = gameEngine.teams[1] || [];
    const boardMonsters = gameEngine.boardMonsters;
    const p1Board = boardMonsters.filter(m => m.gridX < 5);
    const p2Board = boardMonsters.filter(m => m.gridX >= 6);

    const renderCircle = (monsterId: number, isDead: boolean) => {
      if (monsterId <= 0) return `<div class="scoreboard-circle question">?</div>`;
      const dbMonster = DB_MONSTERS.find(m => m.id === monsterId);
      if (!dbMonster) return `<div class="scoreboard-circle question">?</div>`;
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
    };

    // Avatars
    const dummy = DB_MONSTERS[0];
    const cowboy = DB_MONSTERS[3];
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
        " />
      </div>
    `;
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
        " />
      </div>
    `;

    this._container.innerHTML = `
      <div id="battleView" class="ui-interactive">
        
        <!-- Top HUD Scoreboard -->
        <div class="battle-scoreboard-top">
          <div class="scoreboard-team-row">
            ${Array(8).fill(0).map((_, idx) => {
              const slot = p1Draft[idx];
              if (!slot || slot.monsterId <= 0) return renderCircle(0, false);
              const boardInst = p1Board.find(bm => bm.dbId === slot.monsterId);
              const isDead = isCombat ? (!boardInst || boardInst.isDead) : false;
              return renderCircle(slot.monsterId, isDead);
            }).join('')}
          </div>

          <div class="scoreboard-center-hud">
            ${dummyHtml}
            <div class="scoreboard-center-box">
              <div class="scoreboard-timer">${timerVal}</div>
              <div class="scoreboard-phase-text" style="color: #ffeb3b;">${phaseText} (Round ${roundNum})</div>
            </div>
            ${cowboyHtml}
          </div>

          <div class="scoreboard-team-row">
            ${Array(8).fill(0).map((_, idx) => {
              const slot = p2Draft[idx];
              if (!slot || slot.monsterId <= 0) return renderCircle(0, false);
              const boardInst = p2Board.find(bm => bm.dbId === slot.monsterId);
              const isDead = isCombat ? (!boardInst || boardInst.isDead) : false;
              return renderCircle(slot.monsterId, isDead);
            }).join('')}
          </div>
        </div>

        <!-- 11x5 Grid Overlay over Canvas -->
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

        <!-- DOM Health Bars Overlay (Active during combat) -->
        <div id="hpBarsContainer" class="health-bars-overlay"></div>


        <!-- Replay Controls at bottom (Matching R1, R2, R3 icons/styles) -->
        <div style="
          position: absolute;
          bottom: 40px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          gap: 30px;
          align-items: center;
          z-index: 100;
        ">
          <!-- R1: Pause/Play -->
          <button id="replayPauseBtn" class="ui-interactive" style="
            width: 80px; height: 80px;
            background: url('r1.png') center/contain no-repeat;
            background-color: transparent; border: none; cursor: pointer;
            outline: none;
            transition: filter 0.1s;
          "></button>
          
          <!-- R2: Next Round Replay -->
          <button id="replayNextBtn" class="ui-interactive" style="
            width: 80px; height: 80px;
            background: url('r2.png') center/contain no-repeat;
            background-color: transparent; border: none; cursor: pointer;
            outline: none;
            transition: filter 0.1s;
          "></button>
          
          <!-- R3: Exit Replay -->
          <button id="replayExitBtn" class="ui-interactive" style="
            width: 80px; height: 80px;
            background: url('r3.png') center/contain no-repeat;
            background-color: transparent; border: none; cursor: pointer;
            outline: none;
            transition: filter 0.1s;
          "></button>
        </div>

        <!-- Details Card -->
        <div id="battleDetailsCardContainer" class="details-card" style="display: none; left: 1980px; top: 310px; z-index: 15;"></div>

        <!-- Announcement overlay (Full Screen) -->
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
    this.updateHpBars();
    this.updateDetailsCardContent();
  }

  private startPlacementPlayback(): void {
    if (this._playbackInterval) {
      clearInterval(this._playbackInterval);
    }

    this._playbackInterval = setInterval(() => {
      if (gameEngine.isReplayPaused || battleSystem.active) return;

      if (this._currentStep < this._placements.length) {
        // Place next monster in order
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

          // Add placement visual VFX
          const scrPos = gridToScreen(p.gridX, p.gridY);
          vfx.addParticle(scrPos.x, scrPos.y, 'heal', 0.4, '#5ac54f', 15);
          vfx.addFloatingText(scrPos.x, scrPos.y, newPlaced.data.name, '#5ac54f');
        }

        this._currentStep++;
        
        // Update timer label
        const timerEl = document.querySelector('.scoreboard-timer');
        if (timerEl) {
          timerEl.textContent = `${this._currentStep} / ${this._placements.length}`;
        }
      } else {
        // All placed. Clean up timer and start combat replay!
        clearInterval(this._playbackInterval);
        this._playbackInterval = null;
        this.startReplayBattle();
      }
    }, this._stepIntervalMs);
  }

  private startReplayBattle(): void {
    // Configure BattleSystem callback
    battleSystem.onBattleEndCallback = (winner) => {
      this.handleReplayBattleEnd(winner);
    };

    // Set fixed seed for mulberry32 determinism
    gameEngine.setReplaySeed(gameEngine.currentRound * 1000 + 456);
    
    // Launch combat!
    battleSystem.startBattle();

    // Redraw DOM HUD state
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

    // Auto proceed to next round replay after 2.5s
    setTimeout(() => {
      if (el) el.style.display = 'none';
      
      const nextRound = gameEngine.currentRound + 1;
      const totalRounds = gameEngine.perRoundStats.length;
      
      if (nextRound <= totalRounds) {
        // Go to next round replay
        gameEngine.currentRound = nextRound;
        this.render();
      } else {
        // Finished all round replays
        this.exitReplay();
      }
    }, 2500);
  }

  private exitReplay(): void {
    this.onDestroy();
    
    // Restore states
    gameEngine.isReplaying = false;
    gameEngine.isReplayPaused = false;
    
    if (gameEngine.savedStateBeforeReplay) gameEngine.state = gameEngine.savedStateBeforeReplay;
    if (gameEngine.savedBoardMonstersBeforeReplay) gameEngine.boardMonsters = gameEngine.savedBoardMonstersBeforeReplay;
    if (gameEngine.savedCurrentRoundBeforeReplay) gameEngine.currentRound = gameEngine.savedCurrentRoundBeforeReplay;
    
    uiManager.syncStateWithUI();
  }

  private bindEvents(): void {
    // 1. R1 - Pause / Resume Replay
    const pauseBtn = document.getElementById('replayPauseBtn');
    pauseBtn?.addEventListener('click', () => {
      gameEngine.isReplayPaused = !gameEngine.isReplayPaused;
      
      // Update visual indicator
      if (pauseBtn) {
        if (gameEngine.isReplayPaused) {
          pauseBtn.style.filter = 'brightness(0.5)';
        } else {
          pauseBtn.style.filter = 'none';
        }
      }
    });

    // 2. R2 - Skip / Next Round Replay
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

    // 3. R3 - Exit Replay
    const exitBtn = document.getElementById('replayExitBtn');
    exitBtn?.addEventListener('click', () => {
      this.exitReplay();
    });

    // 4. Grid clicking to select monster details
    const cells = document.querySelectorAll('.battle-grid-cell');
    cells.forEach(cell => {
      cell.addEventListener('click', () => {
        const gridX = parseInt(cell.getAttribute('data-grid-x') || '0', 10);
        const gridY = parseInt(cell.getAttribute('data-grid-y') || '0', 10);
        const monster = gameEngine.getMonsterAt(gridX, gridY);
        
        if (monster) {
          this._selectedMonsterId = monster.id;
        } else {
          this._selectedMonsterId = null;
        }
        this.updateDetailsCardContent();
      });
    });
  }

  public updateReplayFrame(): void {
    if (battleSystem.active) {
      const timerEl = document.querySelector('.scoreboard-timer');
      if (timerEl) {
        timerEl.textContent = `${Math.ceil(battleSystem.timeLeft)}`;
      }
    }
    this.updateHpBars();
    this.updateDetailsCardContent();
  }

  public updateHpBars(): void {
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
        if (effect.type === 'poison') { symbol = '🦠'; color = '#39ff14'; }
        else if (effect.type === 'bleed') { symbol = '🩸'; color = '#f44336'; }
        else if (effect.type === 'burn') { symbol = '🔥'; color = '#ff9800'; }
        else if (effect.type === 'stun') { symbol = '🌀'; color = '#ffeb3b'; }
        else if (effect.type === 'chill') { symbol = '❄️'; color = '#2196f3'; }
        else if (effect.type === 'stealth') { symbol = '👥'; color = '#9c27b0'; }
        else if (effect.type === 'invincible') { symbol = '🛡️'; color = '#ffd700'; }
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
            <div style="
              position: absolute;
              left: 54px;
              top: 20px;
              background:#0d2d52;
              border:1px solid #4ba3e3;
              color:#7dd4ff;
              font-family:'Press Start 2P','Zpix',monospace;
              font-size:12px;
              line-height:1;
              padding:2px 3px;
              display:flex;align-items:center;justify-content:center;
              min-width:10px;
              text-align:center;
              white-space:nowrap;
            ">${m.shield}</div>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  public updateDetailsCardContent(): void {
    const cardContainer = document.getElementById('battleDetailsCardContainer');
    if (!cardContainer) return;

    if (!this._selectedMonsterId) {
      cardContainer.style.display = 'none';
      return;
    }

    const selectedMonster = gameEngine.boardMonsters.find(m => m.id === this._selectedMonsterId);
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
      <div class="details-avatar-frame">
        <img src="all.png" style="
          object-fit: none;
          object-position: -${dbMonster.sx}px -${dbMonster.sy}px;
          width: ${dbMonster.sw}px;
          height: ${dbMonster.sh}px;
        " />
      </div>

      <div class="details-stars-container" style="font-size: 10px; flex-direction: column; align-items: center; gap: 2px;">
        <span style="font-size: 14px; color: #e5c158;">★★★</span>
        <span style="color: #ffffff; font-family: 'Press Start 2P', 'Zpix', monospace; font-weight: bold;">[ ${dbMonster.race} | ${dbMonster.role} ]</span>
      </div>

      <div class="details-name-banner">${dbMonster.name}</div>

      <div class="details-val details-val-hp">${selectedMonster.hp}/${selectedMonster.maxHp}</div>
      <div class="details-val details-val-atk">${selectedMonster.atk}</div>
      <div class="details-val details-val-ats">${selectedMonster.ats.toFixed(2)}</div>
      <div class="details-val details-val-range">${selectedMonster.range}</div>
      <div class="details-val details-val-shield">${selectedMonster.shield}</div>
      <div class="details-val details-val-cd">${dbMonster.skillCd}</div>
      <div class="details-val details-val-speed">${selectedMonster.speed}</div>

      <div class="details-skill-section">
        <div class="details-skill-icon-frame">
          ${this.getSkillIconHtml(dbMonster.skill)}
        </div>
        <div class="details-skill-desc-box">
          <div style="color:#e5c158; font-size:30px; margin-bottom:4px;">${dbMonster.skill} (CD: ${dbMonster.skillCd}s)</div>
          <div>${this.getSkillChineseDescription(dbMonster.id)}</div>
        </div>
      </div>

      <div class="details-badges-section" style="background-color: #b4b3a1;">
        ${badgesHtml}
      </div>
    `;
  }

  private getSkillIconHtml(skillName: string): string {
    let badgeId = 11;
    if (skillName === 'reap') badgeId = 19;
    else if (skillName === 'lightning') badgeId = 4;
    else if (skillName === 'life_link') badgeId = 6;
    else if (skillName === 'incendiary') badgeId = 24;
    else if (skillName === 'recovery') badgeId = 17;
    else if (skillName === 'rush') badgeId = 5;
    
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
      106: "冲锋：战斗开始时向前突进，撞击对手并将其击退两格，造成眩晕。"
    };
    return skillMap[dbId] || "普通攻击：无特殊技能。";
  }

  public onDestroy(): void {
    if (this._playbackInterval) {
      clearInterval(this._playbackInterval);
      this._playbackInterval = null;
    }
    
    // Stop battle if it is replaying
    if (battleSystem.active) {
      battleSystem.active = false;
    }
  }
}
