import { gameEngine } from '../game/GameEngine';
import { DB_MONSTERS, DB_BADGES, BADGE_SPRITES, getSkillDescription } from '../game/Database';
import { uiManager } from './UIManager';

const TAB_LEFT_COORDS = [62, 156, 250, 344, 438];

const CELL_COORDS = [
  { x: 75, y: 335, w: 260, h: 260 },
  { x: 360, y: 335, w: 265, h: 260 },
  { x: 650, y: 335, w: 260, h: 260 },
  { x: 940, y: 335, w: 260, h: 260 },
  { x: 75, y: 620, w: 260, h: 265 },
  { x: 360, y: 620, w: 265, h: 265 },
  { x: 650, y: 620, w: 260, h: 265 },
  { x: 940, y: 620, w: 260, h: 265 }
];

export class TeamEditorUI {
  private _container: HTMLDivElement;
  
  // Selected slot index in squad (0-7)
  private _selectedSlotIndex: number = 0;
  
  // Modal states
  private _activeMonsterSelectIndex: number | null = null; // slot index to switch monster
  private _activeBadgeSelectIndex: number | null = null;   // badge index to change (0, 1, or 2)
  private _previewMonster: any = null;                      // monster data for right-side detail preview

  constructor(container: HTMLDivElement) {
    this._container = container;
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

  /**
   * Directly update the details card DOM only (no full re-render).
   * Avoids flickering in the monster select modal since the scroll
   * position and DOM for the modal grid are not touched.
   */
  private updateDetailsCard(monster: any): void {
    this._previewMonster = monster;
    const activeTeam = gameEngine.activeTeam;
    const activeSlot = activeTeam[this._selectedSlotIndex];
    const detailCard = this._container.querySelector('.details-card') as HTMLElement | null;
    if (!detailCard) return;

    detailCard.style.zIndex = '101';
    detailCard.innerHTML = `
      <!-- Avatar Frame -->
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

      <!-- Stars and Race/Role -->
      <div class="details-stars-container" style="font-size: 10px; flex-direction: column; align-items: center; gap: 2px;">
        <span style="font-size: 14px; color: #e5c158;">★★★</span>
        <span style="color: #ffffff; font-family: 'Press Start 2P', 'Zpix', monospace; font-weight: bold;">[ ${monster.race} | ${monster.role} ]</span>
      </div>

      <!-- Name banner -->
      <div class="details-name-banner">${monster.name}</div>

      <!-- Stats overlays (values only) -->
      <div class="details-val details-val-hp">${monster.hp}/${monster.hp}</div>
      <div class="details-val details-val-atk">${monster.atk}</div>
      <div class="details-val details-val-ats">${monster.ats}</div>
      <div class="details-val details-val-range">${monster.range}</div>
      <div class="details-val details-val-shield">0</div>
      <div class="details-val details-val-cd">${monster.skillCd}</div>
      <div class="details-val details-val-speed">${monster.speed}</div>

      <!-- Skill Box -->
      <div class="details-skill-section">
        <div class="details-skill-icon-frame">
          ${this.getSkillIconHtml(monster.skill)}
        </div>
        <div class="details-skill-desc-box">
          <div style="color:#e5c158; font-size:10px; margin-bottom:4px;">${monster.skill} (CD: ${monster.skillCd}s)</div>
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

    this._container.innerHTML = `
      <div id="teamEditor" class="ui-interactive">
        
        ${Array(5).fill(0).map((_, tIdx) => {
          const activeClass = gameEngine.selectedTeamIndex === tIdx ? 'active' : '';
          return `<button class="squad-tab-btn ${activeClass}" data-team-index="${tIdx}" style="left: ${TAB_LEFT_COORDS[tIdx]}px;"></button>`;
        }).join('')}

        <!-- Squad Grid Cells absolute-positioned -->
        ${activeTeam.map((slot, index) => {
          const monster = DB_MONSTERS.find(m => m.id === slot.monsterId);
          const isSelected = index === this._selectedSlotIndex ? 'active' : '';
          const coord = CELL_COORDS[index];
          return `
            <div class="squad-cell ${isSelected}" data-index="${index}" style="left: ${coord.x}px; top: ${coord.y}px; width: ${coord.w}px; height: ${coord.h}px;">
              ${monster ? `
                <img src="all.png" style="
                  object-fit: none;
                  object-position: -${monster.sx}px -${monster.sy}px;
                  width: ${monster.sw}px;
                  height: ${monster.sh}px;
                " />
              ` : ''}
              <button class="pixel-btn monster-switch-btn" data-switch-index="${index}">+</button>
            </div>
          `;
        }).join('')}
        
        <!-- Bottom Action Buttons overlaid on background -->
        <button id="searchMatchBtn" class="bottom-action-btn" style="left: 160px; top: 935px; width: 255px; height: 90px;"></button>
        <button id="createMatchBtn" class="bottom-action-btn" style="left: 505px; top: 935px; width: 255px; height: 90px;"></button>
        <button id="joinMatchBtn" class="bottom-action-btn" style="left: 860px; top: 935px; width: 255px; height: 90px;"></button>

        <!-- Right Side details card -->
        <div class="details-card" style="${this._previewMonster ? 'z-index: 101;' : ''}">
          <!-- Avatar Frame -->
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

          <!-- Stars and Race/Role -->
          <div class="details-stars-container" style="font-size: 10px; flex-direction: column; align-items: center; gap: 2px;">
            <span style="font-size: 14px; color: #e5c158;">★★★</span>
            <span style="color: #ffffff; font-family: 'Press Start 2P', 'Zpix', monospace; font-weight: bold;">[ ${selectedMonster.race} | ${selectedMonster.role} ]</span>
          </div>

          <!-- Name banner -->
          <div class="details-name-banner">${selectedMonster.name}</div>

          <!-- Stats overlays (values only) -->
          <div class="details-val details-val-hp">${selectedMonster.hp}/${selectedMonster.hp}</div>
          <div class="details-val details-val-atk">${selectedMonster.atk}</div>
          <div class="details-val details-val-ats">${selectedMonster.ats}</div>
          <div class="details-val details-val-range">${selectedMonster.range}</div>
          <div class="details-val details-val-shield">0</div>
          <div class="details-val details-val-cd">${selectedMonster.skillCd}</div>
          <div class="details-val details-val-speed">${selectedMonster.speed}</div>

          <!-- Skill Box -->
          <div class="details-skill-section">
            <div class="details-skill-icon-frame">
              ${this.getSkillIconHtml(selectedMonster.skill)}
            </div>
            <div class="details-skill-desc-box">
              <div style="color:#e5c158; font-size:10px; margin-bottom:4px;">${selectedMonster.skill} (CD: ${selectedMonster.skillCd}s)</div>
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
      </div>

      <!-- Modals (Initially hidden, conditionally appended) -->
      ${this._activeMonsterSelectIndex !== null ? this.renderMonsterSelectModal() : ''}
      ${this._activeBadgeSelectIndex !== null ? this.renderBadgeSelectModal() : ''}
    `;

    this.bindEvents();
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

    // Grid Cell Selection
    const cells = document.querySelectorAll('.squad-cell');
    cells.forEach(c => {
      c.addEventListener('click', (e) => {
        const index = parseInt(c.getAttribute('data-index') || '0', 10);
        
        // If clicked switch button, ignore cell click
        const target = e.target as HTMLElement;
        if (target.classList.contains('monster-switch-btn')) return;

        this._selectedSlotIndex = index;
        this.render();
      });
    });

    // Switch buttons inside cells
    const switchBtns = document.querySelectorAll('.monster-switch-btn');
    switchBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const index = parseInt(btn.getAttribute('data-switch-index') || '0', 10);
        this._activeMonsterSelectIndex = index;
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
      alert("对战模式（暂未开放）：两名玩家同时布阵，且开始战斗前无法看到对方操作。");
    });

    const joinMatch = document.getElementById('joinMatchBtn');
    joinMatch?.addEventListener('click', () => {
      alert("对战模式（暂未开放）：请使用【实验模式】进行同屏体验。");
    });
  }

  // --- Modal Rendering ---
  private renderMonsterSelectModal(): string {
    const activeTeam = gameEngine.activeTeam;
    return `
      <div class="modal-overlay" style="justify-content: flex-start; padding-left: 10%;">\n        <div class="modal-content pixel-panel">
          <div class="modal-grid-scroll">
            ${DB_MONSTERS.map(m => {
              const isUsed = activeTeam.some((slot, idx) => idx !== this._activeMonsterSelectIndex && slot.monsterId === m.id);
              const cardStyle = isUsed ? 'opacity: 0.4; pointer-events: none; filter: grayscale(1);' : '';
              return `
                <div class="modal-monster-card" data-monster-id="${m.id}" style="${cardStyle}">
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
          <button id="closeMonsterModalBtn" class="pixel-btn" style="width: 240px; height: 60px; font-size: 24px; align-self: center;">取消</button>
        </div>
      </div>
    `;
  }

  private renderBadgeSelectModal(): string {
    const activeSlot = gameEngine.activeTeam[this._selectedSlotIndex];
    return `
      <div class="modal-overlay" style="justify-content: flex-start; padding-left: 10%;">
        <div class="modal-content badge-modal-content pixel-panel">
          <div class="badge-grid-scroll">
            <!-- Empty blank spacer row at the top to allow scrolling extra space for tooltips -->
            <div style="grid-column: span 5; height: 120px;"></div>
            
            <!-- Empty slot to unequip -->
            <div class="modal-badge-card" data-badge-id="0">
              <div style="width: 120px; height: 128px; display: flex; justify-content: center; align-items: center; border: 3px dashed #ff3333; margin-bottom: 8px; box-sizing: border-box;">
                <span style="font-size: 36px; color: #ff3333;">×</span>
              </div>
              <div class="modal-badge-name" style="color: #ff3333;">卸下徽章</div>
              <div class="modal-badge-desc">空置该徽章槽位</div>
            </div>
            ${(() => {
              const BADGE_GROUPS: number[][] = [
                [23, 8, 17, 6, 7, 11, 28, 30],   // 韧性、厚皮、大厨、回环、吸血、预防、加固、反应装甲
                [3, 22, 21, 20, 5, 1,10],            // 破盾、鲁莽、反击、狙击、助跑、穿透
                [25, 27, 4, 2,9],                   // 中毒、献祭、元素涌动、凋零
                [32, 24, 33, 18,],              // 巫毒、复活、礼物、延伸、蓄能
                [16,13, 12, 29, 35],                 // 结阵攻、结阵守、哨位、接力
              ];
              const groupedIds = new Set<number>();
              BADGE_GROUPS.flat().forEach(id => groupedIds.add(id));

              const renderBadgeCard = (b: any): string => {
                const isUsed = activeSlot && activeSlot.badgeIds.some((id: number, idx: number) => idx !== this._activeBadgeSelectIndex && id === b.id);
                const cardStyle = isUsed ? 'opacity: 0.4; pointer-events: none; filter: grayscale(1);' : '';
                const sprite = BADGE_SPRITES[b.id];
                let badgeHtml = '';
                if (sprite) {
                  const scale = 120 / sprite.sw;
                  const imgW = 2556 * scale;
                  const imgH = 1417 * scale;
                  const left = -sprite.sx * scale;
                  const top = -sprite.sy * scale;
                  const height = sprite.sh * scale;
                  badgeHtml = `
                    <div style="width: 120px; height: ${height}px; overflow: hidden; position: relative; display: flex; justify-content: center; align-items: center; background: transparent; flex-shrink: 0; margin-bottom: 8px;">
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
                    <div style="flex-grow: 1; display: flex; flex-direction: column; align-items: center;">
                      <div class="modal-badge-name">${b.name}</div>
                      <div class="modal-badge-desc">${b.desc}</div>
                    </div>
                  </div>
                `;
              };

              let html = '';
              for (const group of BADGE_GROUPS) {
                for (const id of group) {
                  const b = DB_BADGES.find(b => b.id === id);
                  if (b) html += renderBadgeCard(b);
                }
                html += `<div style="grid-column: span 5; height: 2px; background: #5a5a5a; margin: 4px 0;"></div>`;
              }
              for (const b of DB_BADGES) {
                if (!groupedIds.has(b.id)) {
                  html += renderBadgeCard(b);
                }
              }
              return html;
            })()}
          </div>
          <button id="closeBadgeModalBtn" class="pixel-btn" style="width: 240px; height: 60px; font-size: 24px; align-self: center;">取消</button>
          
        </div>
      </div>
    `;
  }

  // Bind events for dynamically generated modals
  public afterRenderModal(): void {
    // (closeMonster logic merged into monster card section below)

    // Monster card: single click shows detail on right, double click selects
    const monsterCards = document.querySelectorAll('.modal-monster-card');
    monsterCards.forEach(card => {
      card.addEventListener('click', () => {
        const id = parseInt(card.getAttribute('data-monster-id') || '0', 10);
        const monster = DB_MONSTERS.find(m => m.id === id) || null;
        if (monster) {
          this.updateDetailsCard(monster);
        }
      });
      card.addEventListener('dblclick', () => {
        const id = parseInt(card.getAttribute('data-monster-id') || '0', 10);
        if (this._activeMonsterSelectIndex !== null) {
          const activeTeam = gameEngine.activeTeam;
          const alreadyExists = activeTeam.some((slot, idx) => idx !== this._activeMonsterSelectIndex && slot.monsterId === id);
          if (alreadyExists) {
            alert("一个队伍不能选择两个一样的怪兽！");
            return;
          }
          activeTeam[this._activeMonsterSelectIndex].monsterId = id;
          activeTeam[this._activeMonsterSelectIndex].badgeIds = [];
          this._activeMonsterSelectIndex = null;
          gameEngine.saveTeams();
          this.render();
        }
      });
    });

    // Close monster modal also clears preview
    const closeMonster = document.getElementById('closeMonsterModalBtn');
    if (closeMonster) {
      closeMonster.addEventListener('click', () => {
        this._previewMonster = null;
        this._activeMonsterSelectIndex = null;
        this.render();
      });
    }
    const closeBadge = document.getElementById('closeBadgeModalBtn');
    closeBadge?.addEventListener('click', () => {
      this._activeBadgeSelectIndex = null;
      this.render();
    });

    // Badge card: single click shows/hides desc, double click selects
    const badgeCards = document.querySelectorAll('.modal-badge-card');
    badgeCards.forEach(card => {
      card.addEventListener('click', (e) => {
        // Toggle description display (clear any previous shown desc)
        document.querySelectorAll('.modal-badge-card.show-desc').forEach(c => {
          if (c !== card) c.classList.remove('show-desc');
        });
        card.classList.toggle('show-desc');
        e.stopPropagation();
      });
      card.addEventListener('dblclick', () => {
        const badgeId = parseInt(card.getAttribute('data-badge-id') || '0', 10);
        if (this._activeBadgeSelectIndex !== null) {
          const activeSlot = gameEngine.activeTeam[this._selectedSlotIndex];
          if (badgeId === 0) {
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
          this._activeBadgeSelectIndex = null;
          gameEngine.saveTeams();
          this.render();
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

// Wrap the class wrapper to trigger afterRender hook
const originalRender = TeamEditorUI.prototype.render;
TeamEditorUI.prototype.render = function(this: TeamEditorUI) {
  originalRender.apply(this);
  this.afterRenderModal();
};
