import { gameEngine, TeamSlot } from '../game/GameEngine';
import { DB_MONSTERS, DB_BADGES, BADGE_SPRITES, getSkillDescription } from '../game/Database';
import { renderSkillIconHtml } from '../game/IconMapping';
import { uiManager } from './UIManager';
import { requestFullscreen } from '../main';
import gsap from 'gsap';

export class TeamEditorUI {
  private _container: HTMLDivElement;
  
  // Selected slot index in squad (0-7)
  private _selectedSlotIndex: number = 0;
  
  // Modal states
  private _activeMonsterSelectIndex: number | null = null; // slot index to switch monster
  private _activeBadgeSelectIndex: number | null = null;   // badge index to change (0, 1, or 2)
  private _previewMonster: any = null;                      // monster data for right-side detail preview
  private _currentTab: 'monster' | 'badge' = 'monster';

  // Random cloud assets
  private _randomYunFar: string = '';
  private _randomYunNear: string = '';
  private _chosenClouds: { idx: number; top: number; duration: number; delay: number }[] = [];
  private _bgRendered: boolean = false;

  constructor(container: HTMLDivElement) {
    this._container = container;
    this.initRandomClouds();
    this.initCloudSprites();
  }

  private initRandomClouds(): void {
    const cloudPool = [
      '/background/yun1.png',
      '/background/yun2png.png',
      '/background/yun3.png'
    ];
    // Random select far layer
    const farIdx = Math.floor(Math.random() * cloudPool.length);
    this._randomYunFar = cloudPool[farIdx];

    // Random select near layer, avoid duplication
    const remainingPool = cloudPool.filter(url => url !== this._randomYunFar);
    const nearIdx = Math.floor(Math.random() * remainingPool.length);
    this._randomYunNear = remainingPool[nearIdx];
  }

  private initCloudSprites(): void {
    const availableIndices = [1, 2, 3, 4, 5, 6, 7];
    for (let i = 0; i < 4; i++) {
      const rIdx = Math.floor(Math.random() * availableIndices.length);
      const cloudIdx = availableIndices.splice(rIdx, 1)[0];
      this._chosenClouds.push({
        idx: cloudIdx,
        top: 50 + Math.random() * 250,
        duration: 90 + Math.random() * 90,
        delay: -Math.random() * 90
      });
    }
  }

  private getSkillIconHtml(skillName: string): string {
    return renderSkillIconHtml(skillName);
  }

  private updateDetailsCard(monster: any): void {
    this._previewMonster = monster;
    const activeTeam = gameEngine.activeTeam;
    const activeSlot = activeTeam[this._selectedSlotIndex];
    const detailCard = this._container.querySelector('.details-card') as HTMLElement | null;
    if (!detailCard) return;

    detailCard.style.zIndex = '101';
    detailCard.innerHTML = `
      <!-- Avatar -->
      <div class="details-avatar-frame">
        ${monster ? `
          <img src="all.png" style="
            object-fit: none;
            object-position: -${monster.sx}px -${monster.sy}px;
            width: ${monster.sw}px;
            height: ${monster.sh}px;
          " />
        ` : ''}
      </div>

      <!-- Stars -->
      <div class="details-stars-container">★★★</div>

      <!-- Meta info -->
      <div class="details-type-tag">[ ${monster.race} | ${monster.role} ]</div>
      <div class="details-name-banner">${monster.name}</div>

      <!-- Stats text overlays -->
      <div class="details-val details-val-hp">${monster.hp}/${monster.hp}</div>
      <div class="details-val details-val-atk">${monster.atk}</div>
      <div class="details-val details-val-ats">${monster.ats}</div>
      <div class="details-val details-val-range">${monster.range}</div>
      <div class="details-val details-val-shield">0</div>
      <div class="details-val details-val-cd">${monster.skillCd}s</div>
      <div class="details-val details-val-speed">${monster.speed}</div>

      <!-- Skill Box -->
      <div class="details-skill-section">
        <div class="details-skill-icon-frame">
          ${this.getSkillIconHtml(monster.skill)}
        </div>
        <div class="details-skill-desc-box">
          <div style="color:#e5c158; font-size:18px; margin-bottom:4px;">${monster.skill} (CD: ${monster.skillCd}s)</div>
          <div>${getSkillDescription(monster)}</div>
        </div>
      </div>

      <!-- Equipped Badges Slots -->
      <div class="details-badges-section">
        ${Array(monster.cost === 4 ? 3 : 2).fill(0).map((_, badgeIdx) => {
          const badgeId = (activeSlot && activeSlot.badgeIds) ? activeSlot.badgeIds[badgeIdx] : undefined;
          const badge = DB_BADGES.find(b => b.id === badgeId);
          
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
            <div class="details-badge-slot-frame ${equippedClass}" data-badge-slot="${badgeIdx}">
              ${badgeImgHtml}
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  public render(): void {
    const activeTeam = gameEngine.activeTeam;
    const selectedMonster = this._previewMonster || DB_MONSTERS.find(
      m => m.id === activeTeam[this._selectedSlotIndex]?.monsterId
    ) || DB_MONSTERS[0];
    
    const activeSlot = activeTeam[this._selectedSlotIndex];

    const teamEditorContent = this.buildTeamEditorContent(activeTeam, selectedMonster, activeSlot);

    const modalsContent = '';

    if (!this._bgRendered) {
      // First render: full HTML including background (ship, clouds, sky)
      this._container.innerHTML = `
      <!-- Multi-layered Airship Background -->
      <div class="team-editor-bg-container">
        <div class="bg-layer sky"></div>
        <div class="bg-layer yun layer-far" style="background-image: url('${this._randomYunFar}');"></div>
        <div class="bg-layer yun layer-near" style="background-image: url('${this._randomYunNear}');"></div>
        
        <!-- Separate cloud sprites from yun4.png -->
        ${this._chosenClouds.map(c => `
          <div class="cloud-sprite cloud-${c.idx}" style="
            top: ${c.top}px;
            animation: floatCloud ${c.duration}s linear infinite;
            animation-delay: ${c.delay}s;
          "></div>
        `).join('')}

        <div class="ship-enter-wrapper">
          <div class="bg-layer ship"></div>
        </div>
      </div>

      <div id="teamEditor" class="ui-interactive${gameEngine.fromOpening ? ' anim-in' : ''}">
        ${teamEditorContent}
      </div>
      ${modalsContent}
    `;
      this._bgRendered = true;
    } else {
      // Subsequent renders: only update #teamEditor UI and modals (background persists, no animation replay)
      const editorEl = this._container.querySelector('#teamEditor') as HTMLElement | null;
      if (editorEl) {
        editorEl.classList.remove('anim-in');
        editorEl.innerHTML = teamEditorContent;
      }
      // Replace modals
      this._container.querySelectorAll('.modal-overlay').forEach(m => m.remove());
      if (modalsContent.trim()) {
        this._container.insertAdjacentHTML('beforeend', modalsContent);
      }
    }

    this.bindEvents();

    // Reset opening animation flag after first render
    if (gameEngine.fromOpening) {
      gameEngine.fromOpening = false;
    }
  }

  /** Extract #teamEditor inner HTML for reuse (render + opening transition) */
  private buildTeamEditorContent(activeTeam: any, selectedMonster: any, activeSlot: any): string {
    return `
        <!-- Left Panel: Tabs + Grid + Buttons -->
        <div class="editor-left-panel">
          
          <!-- Tabs container -->
          <div class="squad-tabs-container">
            ${Array(5).fill(0).map((_, tIdx) => {
              const activeClass = gameEngine.selectedTeamIndex === tIdx ? 'active' : '';
              return `<button class="squad-tab-btn ${activeClass}" data-team-index="${tIdx}"></button>`;
            }).join('')}
          </div>

          <!-- Squad Grid container -->
          <div class="squad-grid-container">
            ${activeTeam.map((slot: TeamSlot, index: number) => {
              const monster = DB_MONSTERS.find(m => m.id === slot.monsterId);
              return `
                <div class="squad-cell" data-index="${index}">
                  ${monster ? `
                    <img src="all.png" style="
                      object-fit: none;
                      object-position: -${monster.sx}px -${monster.sy}px;
                      width: ${monster.sw}px;
                      height: ${monster.sh}px;
                    " />
                  ` : ''}
                </div>
              `;
            }).join('')}
          </div>

        </div>

        <!-- Bottom Actions (now outside left panel) -->
        <div class="editor-actions-container">
          <button id="teamEditModeBtn" class="bottom-action-btn ${this._currentTab === 'monster' ? 'active' : ''}">队伍编辑</button>
          <button id="badgeEditModeBtn" class="bottom-action-btn ${this._currentTab === 'badge' ? 'active' : ''}">徽章编辑</button>
          <button id="searchMatchBtn" class="bottom-action-btn">实验模式</button>
          <button id="createMatchBtn" class="bottom-action-btn">AI对战</button>
          <button id="joinMatchBtn" class="bottom-action-btn">搜索对战</button>
        </div>

        <!-- Right Panel: Monster details card -->
        <div class="details-card" style="${this._previewMonster ? 'z-index: 101;' : ''}">
          <!-- Avatar -->
          <div class="details-avatar-frame">
            ${selectedMonster ? `
              <img src="all.png" style="
                object-fit: none;
                object-position: -${selectedMonster.sx}px -${selectedMonster.sy}px;
                width: ${selectedMonster.sw}px;
                height: ${selectedMonster.sh}px;
              " />
            ` : ''}
          </div>

          <!-- Stars -->
          <div class="details-stars-container">★★★</div>

          <!-- Meta info -->
          <div class="details-type-tag">[ ${selectedMonster.race} | ${selectedMonster.role} ]</div>
          <div class="details-name-banner">${selectedMonster.name}</div>

          <!-- Stats text overlays (absolute positioned over details background) -->
          <div class="details-val details-val-hp">${selectedMonster.hp}/${selectedMonster.hp}</div>
          <div class="details-val details-val-atk">${selectedMonster.atk}</div>
          <div class="details-val details-val-ats">${selectedMonster.ats}</div>
          <div class="details-val details-val-range">${selectedMonster.range}</div>
          <div class="details-val details-val-shield">0</div>
          <div class="details-val details-val-cd">${selectedMonster.skillCd}s</div>
          <div class="details-val details-val-speed">${selectedMonster.speed}</div>

          <!-- Skill Box -->
          <div class="details-skill-section">
            <div class="details-skill-icon-frame">
              ${this.getSkillIconHtml(selectedMonster.skill)}
            </div>
            <div class="details-skill-desc-box">
              <div style="color:#e5c158; font-size:18px; margin-bottom:4px;">${selectedMonster.skill} (CD: ${selectedMonster.skillCd}s)</div>
              <div>${getSkillDescription(selectedMonster)}</div>
            </div>
          </div>

          <!-- Equipped Badges Slots -->
          <div class="details-badges-section">
            ${Array(selectedMonster.cost === 4 ? 3 : 2).fill(0).map((_, badgeIdx) => {
              const badgeId = (activeSlot && activeSlot.badgeIds) ? activeSlot.badgeIds[badgeIdx] : undefined;
              const badge = DB_BADGES.find(b => b.id === badgeId);
              
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
                <div class="details-badge-slot-frame ${equippedClass}" data-badge-slot="${badgeIdx}">
                  ${badgeImgHtml}
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Monster Selection panel (sibling of left panel and details-card) -->
        ${this._activeMonsterSelectIndex !== null ? this.renderMonsterSelectModal() : ''}

        <!-- Badge Selection panel (sibling of left panel and details-card) -->
        ${this._activeBadgeSelectIndex !== null ? this.renderBadgeSelectModal() : ''}
      </div>
    `;

    this.bindEvents();
    if (this._activeMonsterSelectIndex !== null) {
      document.getElementById('teamEditor')?.classList.add('monster-selecting');
      setTimeout(() => {
        const modal = this._container.querySelector('.monster-select-panel') as HTMLElement | null;
        if (modal) {
          modal.classList.add('open');
          gsap.fromTo(modal,
            { y: 1200, opacity: 1 },
            { y: 0, opacity: 1, duration: 0.5, ease: 'power2.out' }
          );
        }
      }, 50);
    }
    if (this._activeBadgeSelectIndex !== null) {
      document.getElementById('teamEditor')?.classList.add('monster-selecting');
      setTimeout(() => {
        const modal = this._container.querySelector('.badge-select-panel') as HTMLElement | null;
        if (modal) {
          modal.classList.add('open');
          gsap.fromTo(modal,
            { y: 1200, opacity: 1 },
            { y: 0, opacity: 1, duration: 0.5, ease: 'power2.out' }
          );
        }
      }, 50);
    }
    this.afterRenderModal();
  }

  /** Render opening screen: background (sky/clouds/ship) + start button overlay */
  public renderOpening(): void {
    this._container.innerHTML = `
      <div class="team-editor-bg-container">
        <div class="bg-layer sky"></div>
        <div class="bg-layer yun layer-far" style="background-image: url('${this._randomYunFar}');"></div>
        <div class="bg-layer yun layer-near" style="background-image: url('${this._randomYunNear}');"></div>
        ${this._chosenClouds.map(c => `
          <div class="cloud-sprite cloud-${c.idx}" style="
            top: ${c.top}px;
            animation: floatCloud ${c.duration}s linear infinite;
            animation-delay: ${c.delay}s;
          "></div>
        `).join('')}
      </div>
      <div class="opening-screen">
        <div class="start-logo">
          <button id="startGameBtn"></button>
        </div>
      </div>
    `;
    this._bgRendered = true;
    this.bindOpeningEvents();
  }

  /** Start button click → reveal team editor UI with slide-in animation */
  private bindOpeningEvents(): void {
    document.getElementById('startGameBtn')?.addEventListener('click', () => {
      // 进入全屏（隐藏状态栏/地址栏）
      requestFullscreen();
      // Remove button overlay
      this._container.querySelector('.opening-screen')?.remove();
      // Insert ship (triggers CSS shipEnter animation on DOM insert)
      const bgContainer = this._container.querySelector('.team-editor-bg-container');
      if (bgContainer) {
        bgContainer.insertAdjacentHTML('beforeend', `
          <div class="ship-enter-wrapper">
            <div class="bg-layer ship"></div>
          </div>
        `);
      }
      // Create team editor panels with anim-in class
      const editorDiv = document.createElement('div');
      editorDiv.id = 'teamEditor';
      editorDiv.className = 'ui-interactive anim-in';
      const activeTeam = gameEngine.activeTeam;
      const selectedMonster = this._previewMonster || DB_MONSTERS.find(
        m => m.id === activeTeam[this._selectedSlotIndex]?.monsterId
      ) || DB_MONSTERS[0];
      const activeSlot = activeTeam[this._selectedSlotIndex];
      editorDiv.innerHTML = this.buildTeamEditorContent(activeTeam, selectedMonster, activeSlot);
      this._container.appendChild(editorDiv);
      // Also add modals if needed
      const modalsContent = `
        ${this._activeMonsterSelectIndex !== null ? this.renderMonsterSelectModal() : ''}
        ${this._activeBadgeSelectIndex !== null ? this.renderBadgeSelectModal() : ''}
      `;
      if (modalsContent.trim()) {
        this._container.insertAdjacentHTML('beforeend', modalsContent);
      }
      // Bind all UI interaction events
      this.bindEvents();
      // Update game state
      gameEngine.state = 'TEAM_EDIT';
    });
  }

  private bindEvents(): void {
    // Squad select tabs ("1 2 3 4 5")
    const tabs = document.querySelectorAll('.squad-tab-btn');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const teamIdx = parseInt(tab.getAttribute('data-team-index') || '0', 10);
        gameEngine.selectedTeamIndex = teamIdx;
        gameEngine.saveTeams();
        this.render();
      });
    });

    // Grid Cell Selection: click to open monster select panel or badge select panel based on current mode Tab
    const cells = document.querySelectorAll('.squad-cell');
    cells.forEach(c => {
      c.addEventListener('click', () => {
        const index = parseInt(c.getAttribute('data-index') || '0', 10);
        this._selectedSlotIndex = index;
        if (this._currentTab === 'badge') {
          const slot = gameEngine.activeTeam[index];
          if (!slot || slot.monsterId === 0) {
            alert("请先在此位置上阵怪兽！");
            return;
          }
          this._activeBadgeSelectIndex = 0; // Default configure badge index 0 for this monster
        } else {
          this._activeMonsterSelectIndex = index;
        }
        this.render();
      });
    });

    // Badge Slots Click
    const badgeSlots = document.querySelectorAll('.details-badge-slot-frame');
    badgeSlots.forEach(slot => {
      slot.addEventListener('click', () => {
        const badgeIdx = parseInt(slot.getAttribute('data-badge-slot') || '0', 10);
        this._activeBadgeSelectIndex = badgeIdx;
        this.render();
      });
    });

    // Bottom Action Buttons
    const searchMatch = document.getElementById('searchMatchBtn');
    searchMatch?.addEventListener('click', () => {
      // Transition to experimental mode prep left
      gameEngine.state = 'PREPARATION_LEFT';
      gameEngine.resetBoardForNextRound();
      uiManager.syncStateWithUI();
    });

    const createMatch = document.getElementById('createMatchBtn');
    createMatch?.addEventListener('click', () => {
      // AI Battle mode: generate AI team and start preparation
      const ai = new BattleAI();
      ai.setDifficulty('normal');
      const aiHand: AICard[] = DB_MONSTERS.map(m => ({
        monsterId: m.id,
        badgeIds: []
      }));
      const aiTeamResult = ai.buildTeam(aiHand);

      // Copy player's selected team to teams[0]
      gameEngine.teams[0] = gameEngine.teams[gameEngine.selectedTeamIndex].map(s => ({
        monsterId: s.monsterId,
        badgeIds: [...s.badgeIds]
      }));

      const aiTeamSlots: { monsterId: number; badgeIds: number[] }[] = aiTeamResult.cards.map(
        (m: { monsterId: number; badgeIds: number[] }) => ({
          monsterId: m.monsterId,
          badgeIds: m.badgeIds
        })
      );
      while (aiTeamSlots.length < 8) {
        aiTeamSlots.push({ monsterId: 0, badgeIds: [] });
      }
      
      gameEngine.teams[1] = aiTeamSlots;
      (gameEngine as any)._aiInstance = ai;
      gameEngine.mode = 'ai';
      gameEngine.state = 'PREPARATION_LEFT';
      gameEngine.resetBoardForNextRound();
      uiManager.syncStateWithUI();
    });

    const joinMatch = document.getElementById('joinMatchBtn');
    joinMatch?.addEventListener('click', () => {
      // 保存当前队伍到 teams[0]
      gameEngine.teams[0] = gameEngine.teams[gameEngine.selectedTeamIndex].map(s => ({
        monsterId: s.monsterId,
        badgeIds: [...s.badgeIds]
      }));
      gameEngine.mode = 'online';
      gameEngine.state = 'MATCH_LOBBY';
      uiManager.syncStateWithUI();
    });

    const teamEditModeBtn = document.getElementById('teamEditModeBtn');
    teamEditModeBtn?.addEventListener('click', () => {
      this._currentTab = 'monster';
      this.switchTabPage('monster');
    });

    const badgeEditModeBtn = document.getElementById('badgeEditModeBtn');
    badgeEditModeBtn?.addEventListener('click', () => {
      this._currentTab = 'badge';
      this.switchTabPage('badge');
    });

    // Online confirm button - no longer needed, flow handled in LobbyUI
  }

  /** GSAP page transition: close current modal panel → open target tab modal panel */
  private switchTabPage(targetTab: 'monster' | 'badge'): void {
    const editorEl = this._container.querySelector('#teamEditor') as HTMLElement | null;
    if (!editorEl) return;

    // Find currently open modal panel
    const oldPanel: HTMLElement | null = targetTab === 'monster'
      ? this._container.querySelector('.badge-select-panel.open')
      : this._container.querySelector('.monster-select-panel.open');

    const clearOldPanel = () => {
      editorEl.classList.remove('monster-selecting');
      if (oldPanel) {
        oldPanel.classList.remove('open');
      }
    };

    const renderAndAnimateIn = () => {
      clearOldPanel();

      // Set modal states for target tab
      if (targetTab === 'monster') {
        this._activeBadgeSelectIndex = null;
        this._activeMonsterSelectIndex = 0;
        this._previewMonster = null;
      } else {
        this._activeMonsterSelectIndex = null;
        this._activeBadgeSelectIndex = 0;
        this._previewMonster = null;
      }

      // Render new content
      const activeTeam = gameEngine.activeTeam;
      const selectedMonster = DB_MONSTERS.find(
        m => m.id === activeTeam[this._selectedSlotIndex]?.monsterId
      ) || DB_MONSTERS[0];
      const activeSlot = activeTeam[this._selectedSlotIndex];

      editorEl.classList.remove('anim-in');
      editorEl.innerHTML = this.buildTeamEditorContent(activeTeam, selectedMonster, activeSlot);
      this.bindEvents();
      this.afterRenderModal();

      // Animate new panel in
      requestAnimationFrame(() => {
        editorEl.classList.add('monster-selecting');
        const newPanel: HTMLElement | null = targetTab === 'monster'
          ? this._container.querySelector('.monster-select-panel')
          : this._container.querySelector('.badge-select-panel');
        if (newPanel) {
          newPanel.classList.add('open');
          gsap.fromTo(newPanel,
            { y: 1200, opacity: 1 },
            { y: 0, opacity: 1, duration: 0.5, ease: 'power2.out' }
          );
        }
      });
    };

    if (oldPanel) {
      // Animate old panel out downwards, then render new
      gsap.to(oldPanel, {
        y: 1200, opacity: 1, duration: 0.6, ease: 'power2.in',
        onComplete: renderAndAnimateIn
      });
    } else {
      renderAndAnimateIn();
    }
  }

  // --- Modal Rendering ---
  private renderMonsterSelectModal(): string {
    const activeTeam = gameEngine.activeTeam;
    return `
      <div class="monster-select-panel">
        <div class="modal-grid-scroll">
          ${DB_MONSTERS.map(m => {
            const isSelected = activeTeam.some(slot => slot.monsterId === m.id);
            const activeClass = isSelected ? 'active' : '';
            return `
              <div class="modal-monster-card ${activeClass}" data-monster-id="${m.id}">
                <img src="all.png" style="
                  object-fit: none;
                  object-position: -${m.sx}px -${m.sy}px;
                  width: ${m.sw}px;
                  height: ${m.sh}px;
                  transform: scale(0.8);
                  transform-origin: center;
                " />
                <div class="modal-monster-name">${m.name}</div>
                <div class="modal-monster-cost">${m.cost} 费</div>
              </div>
            `;
          }).join('')}
        </div>
        <button id="closeMonsterModalBtn" class="pixel-btn" style="width: 240px; height: 60px; font-size: 24px; align-self: center;">返回</button>
      </div>
    `;
  }

  private renderBadgeSelectModal(): string {
    const activeSlot = gameEngine.activeTeam[this._selectedSlotIndex];
    return `
      <div class="badge-select-panel">
        <div class="badge-grid-scroll">
          ${(() => {
            const badgeCardsHtmls: string[] = [];

            // Unequip card as index 0
            const unequipCard = `
              <div class="modal-badge-card" data-badge-id="0">
                <div style="width: 100px; height: 100px; display: flex; justify-content: center; align-items: center; border: 3px dashed #ff3333; border-radius: 50%; margin-bottom: 8px; box-sizing: border-box;">
                  <span style="font-size: 36px; color: #ff3333;">×</span>
                </div>
                <div class="modal-badge-name" style="color: #ff3333; font-family: 'Press Start 2P', 'Zpix', monospace; font-size: 16px; text-shadow: 1px 1px 0px #000;">卸下徽章</div>
              </div>
            `;
            badgeCardsHtmls.push(unequipCard);

            const BADGE_GROUPS: number[][] = [
              [23, 8, 17, 6, 7, 11, 28, 30],   // 韧性、厚皮、大厨、回环、吸血、预防、加固、反应装甲
              [3, 22, 21, 20, 5, 1, 10],        // 破盾、鲁莽、反击、狙击、助跑、穿透
              [25, 27, 4, 2, 9],               // 中毒、献祭、元素涌动、凋零
              [32, 24, 33, 18],                // 巫毒、复活、礼物、延伸、蓄能
              [16, 13, 12, 29, 35]             // 结阵攻、结阵守、哨位、接力
            ];
            const groupedIds = new Set<number>();
            BADGE_GROUPS.flat().forEach(id => groupedIds.add(id));

            const renderBadgeCard = (b: any): string => {
              const isUsed = activeSlot && activeSlot.badgeIds.some((id: number, idx: number) => idx !== this._activeBadgeSelectIndex && id === b.id);
              const cardStyle = isUsed ? 'opacity: 0.4; pointer-events: none; filter: grayscale(1);' : '';
              const sprite = BADGE_SPRITES[b.id];
              let badgeHtml = '';
              if (sprite) {
                const scale = 100 / sprite.sw;
                const imgW = 2556 * scale;
                const imgH = 1417 * scale;
                const left = -sprite.sx * scale;
                const top = -sprite.sy * scale;
                badgeHtml = `
                  <div style="width: 100px; height: 100px; overflow: hidden; position: relative; display: flex; justify-content: center; align-items: center; background: transparent; flex-shrink: 0; margin-bottom: 8px; border-radius: 50%;">
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
              return `
                <div class="modal-badge-card" data-badge-id="${b.id}" style="${cardStyle}">
                  ${badgeHtml}
                  <div class="modal-badge-name">${b.name}</div>
                </div>
              `;
            };

            for (const group of BADGE_GROUPS) {
              for (const id of group) {
                const b = DB_BADGES.find(b => b.id === id);
                if (b) badgeCardsHtmls.push(renderBadgeCard(b));
              }
            }
            for (const b of DB_BADGES) {
              if (!groupedIds.has(b.id)) {
                badgeCardsHtmls.push(renderBadgeCard(b));
              }
            }

            // Pack every 6 cards into a row
            const rows: string[] = [];
            for (let i = 0; i < badgeCardsHtmls.length; i += 6) {
              const chunk = badgeCardsHtmls.slice(i, i + 6);
              rows.push(`
                <div class="badge-row">
                  ${chunk.join('')}
                </div>
              `);
            }
            return rows.join('');
          })()}
        </div>
        <button id="closeBadgeModalBtn" class="pixel-btn" style="width: 240px; height: 60px; font-size: 24px; align-self: center;">返回</button>
      </div>
    `;
  }

  // Bind events for dynamically generated modals
  public afterRenderModal(): void {
    // Bind monster selecting events
    this.bindMonsterCardEvents();

    // Close monster modal triggers exit animations
    const closeMonster = document.getElementById('closeMonsterModalBtn');
    if (closeMonster) {
      closeMonster.addEventListener('click', () => {
        const modal = this._container.querySelector('.monster-select-panel');
        document.getElementById('teamEditor')?.classList.remove('monster-selecting');
        if (modal) {
          gsap.to(modal, {
            y: 1200, duration: 0.6, ease: 'power2.in',
            onComplete: () => {
              this._previewMonster = null;
              this._activeMonsterSelectIndex = null;
              this.render();
            }
          });
        } else {
          this._previewMonster = null;
          this._activeMonsterSelectIndex = null;
          this.render();
        }
      });
    }

    const closeBadge = document.getElementById('closeBadgeModalBtn');
    if (closeBadge) {
      closeBadge.addEventListener('click', () => {
        const panel = this._container.querySelector('.badge-select-panel');
        document.getElementById('teamEditor')?.classList.remove('monster-selecting');
        if (panel) {
          gsap.to(panel, {
            y: 1200, duration: 0.6, ease: 'power2.in',
            onComplete: () => {
              this._previewMonster = null;
              this._activeBadgeSelectIndex = null;
              this.render();
            }
          });
        } else {
          this._previewMonster = null;
          this._activeBadgeSelectIndex = null;
          this.render();
        }
      });
    }

    // Badge card: single click selects (equips) and slides out
    const badgeCards = document.querySelectorAll('.modal-badge-card');
    badgeCards.forEach(card => {
      card.addEventListener('click', () => {
        const badgeId = parseInt(card.getAttribute('data-badge-id') || '0', 10);
        if (this._activeBadgeSelectIndex !== null) {
          const activeSlot = gameEngine.activeTeam[this._selectedSlotIndex];
          if (activeSlot) {
            if (badgeId === 0) {
              // Unequip
              activeSlot.badgeIds[this._activeBadgeSelectIndex] = 0;
              activeSlot.badgeIds = activeSlot.badgeIds.filter(id => id > 0);
            } else {
              const alreadyHas = activeSlot.badgeIds.some((id, idx) => idx !== this._activeBadgeSelectIndex && id === badgeId);
              if (alreadyHas) {
                alert("一个怪兽不能选择两个相同的徽章！");
                return;
              }
              activeSlot.badgeIds[this._activeBadgeSelectIndex] = badgeId;
            }
            gameEngine.saveTeams();

            // Slide out panel using GSAP
            const panel = this._container.querySelector('.badge-select-panel');
            document.getElementById('teamEditor')?.classList.remove('monster-selecting');
            if (panel) {
              gsap.to(panel, {
                y: 1200, duration: 0.6, ease: 'power2.in',
                onComplete: () => {
                  this._previewMonster = null;
                  this._activeBadgeSelectIndex = null;
                  this.render();
                }
              });
            } else {
              this._previewMonster = null;
              this._activeBadgeSelectIndex = null;
              this.render();
            }
          }
        }
      });
    });
  }

  private refreshMonsterGrid(): void {
    const gridScroll = this._container.querySelector('.modal-grid-scroll');
    if (!gridScroll) return;

    const activeTeam = gameEngine.activeTeam;
    gridScroll.innerHTML = DB_MONSTERS.map(m => {
      const isSelected = activeTeam.some(slot => slot.monsterId === m.id);
      const activeClass = isSelected ? 'active' : '';
      return `
        <div class="modal-monster-card ${activeClass}" data-monster-id="${m.id}">
          <img src="all.png" style="
            object-fit: none;
            object-position: -${m.sx}px -${m.sy}px;
            width: ${m.sw}px;
            height: ${m.sh}px;
            transform: scale(0.8);
            transform-origin: center;
          " />
          <div class="modal-monster-name">${m.name}</div>
          <div class="modal-monster-cost">${m.cost} 费</div>
        </div>
      `;
    }).join('');

    this.bindMonsterCardEvents();
  }

  private bindMonsterCardEvents(): void {
    const monsterCards = this._container.querySelectorAll('.modal-monster-card');
    monsterCards.forEach(card => {
      card.addEventListener('click', () => {
        const id = parseInt(card.getAttribute('data-monster-id') || '0', 10);
        const monster = DB_MONSTERS.find(m => m.id === id) || null;
        if (!monster) return;

        // Update details card
        this.updateDetailsCard(monster);

        const activeTeam = gameEngine.activeTeam;
        const currentSlotIdx = activeTeam.findIndex(slot => slot.monsterId === id);

        if (currentSlotIdx !== -1) {
          // Already equipped: Single click un-equips (remove from team)
          activeTeam[currentSlotIdx].monsterId = 0;
          activeTeam[currentSlotIdx].badgeIds = [];
          gameEngine.saveTeams();
          this.refreshMonsterGrid();
        } else {
          // Not equipped: Single click equips (put in first empty slot)
          let targetSlotIdx = -1;
          if (this._activeMonsterSelectIndex !== null && activeTeam[this._activeMonsterSelectIndex].monsterId === 0) {
            targetSlotIdx = this._activeMonsterSelectIndex;
          } else {
            targetSlotIdx = activeTeam.findIndex(slot => slot.monsterId === 0);
          }

          if (targetSlotIdx !== -1) {
            activeTeam[targetSlotIdx].monsterId = id;
            activeTeam[targetSlotIdx].badgeIds = [];
            this._activeMonsterSelectIndex = targetSlotIdx; // Point to new slot
            gameEngine.saveTeams();
            this.refreshMonsterGrid();
          } else {
            alert("队伍已满！请先点击已选中的怪兽将其撤下，再进行选择。");
          }
        }
      });
    });
  }

  // Override standard render to handle afterRender callbacks for modals
  public renderWithModalChecks(): void {
    this.render();
    if (this._activeMonsterSelectIndex !== null || this._activeBadgeSelectIndex !== null) {
      this.afterRenderModal();
    }
  }
}
