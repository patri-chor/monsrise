import { gameEngine, TeamSlot } from '../game/GameEngine';
import { DB_MONSTERS, DB_BADGES, getSkillDescription } from '../game/Database';
import { uiManager } from './UIManager';
import { LobbyUI } from './LobbyUI';
import { networkManager } from '../net/NetworkManager';
import { music } from '../game/MusicManager';
import { isIOSDevice, requestFullscreen } from './shared/fullscreen';
import { renderDetailCard, renderBadgeImg, renderSpriteImg } from './shared/renderHelpers';
import { t } from '../game/LanguageManager';
import { L1MeleeChallengeManager } from './L1MeleeChallengeManager';
import { L1ChallengeHistoryUI } from './L1ChallengeHistoryUI';

export class TeamEditorUI {
  private _container: HTMLDivElement;
  
  // Selected slot index in squad (0-7)
  private _selectedSlotIndex: number = 0;
  
  // Modal states
  private _activeMonsterSelectIndex: number | null = null; // slot index to switch monster
  private _activeBadgeSelectIndex: number | null = null;   // badge index to change (0, 1, or 2)
  private _previewMonster: any = null;                      // monster data for right-side detail preview
  private _pendingBadgeIds: number[] = [];                   // 徽章面板中临时选中的徽章 ID
  private _dragSourceIndex: number | null = null;              // 拖拽交换的源槽位索引
  // 怪兽切换还原追踪
  private _switchOriginSlotIndex: number = -1;                // 切换前槽位索引
  private _switchOriginMonsterId: number = 0;                 // 切换前怪兽 ID
  private _switchOriginBadgeIds: number[] = [];               // 切换前徽章 ID 列表
  // 徽章选择还原追踪
  private _badgeOriginIds: number[] = [];                     // 徽章面板打开前原始徽章列表
  private _badgeChanged: boolean = false;                     // 徽章面板中是否有修改

  // Random cloud assets
  private _randomYunFar: string = '';
  private _randomYunNear: string = '';
  private _chosenClouds: { idx: number; top: number; duration: number; delay: number; scale: number }[] = [];
  private _bgRendered: boolean = false;
  // 联机面板实例：再次点击"联机模式"按钮时关闭已打开的联机界面
  private _lobbyUI: LobbyUI | null = null;

  constructor(container: HTMLDivElement) {
    this._container = container;
    this.initRandomClouds();
    this.initCloudSprites();
  }

  private initRandomClouds(): void {
    const cloudPool = [
      '/background/yun1.png',
      '/background/yun2.png',
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
        top: 50 + Math.random() * 550,
        duration: 90 + Math.random() * 90,
        delay: Math.random() * 90,
        scale: 1.5 + Math.random() * 0.3
      });
    }
  }


  private updateDetailsCard(monster: any): void {
    this._previewMonster = monster;
    const activeTeam = gameEngine.activeTeam;
    const activeSlot = activeTeam[this._selectedSlotIndex];
    const detailCard = this._container.querySelector('.details-card') as HTMLElement | null;
    if (!detailCard) return;

    detailCard.style.zIndex = '101';

    const slotCount = monster.cost === 4 ? 3 : 2;
    const badgesHtml = Array(slotCount).fill(0).map((_, badgeIdx) => {
      const badgeId = (activeSlot && activeSlot.badgeIds) ? activeSlot.badgeIds[badgeIdx] : undefined;
      const badge = DB_BADGES.find(b => b.id === badgeId);
      const equippedClass = badge ? 'equipped' : '';
      const imgHtml = badge ? renderBadgeImg(badge.id, 115) : '<span style="font-size:24px; color:#5a5a5a;">+</span>';
      return `<div class="details-badge-slot-frame ${equippedClass}" data-badge-slot="${badgeIdx}">${imgHtml}</div>`;
    }).join('');

    detailCard.innerHTML = renderDetailCard(monster, { badgesHtml }, getSkillDescription(monster));
    detailCard.classList.add('visible');

    // 重新绑定徽章槽位点击事件（innerHTML 替换后旧事件已失效）
    const badgeSlots = detailCard.querySelectorAll('.details-badge-slot-frame');
    badgeSlots.forEach(slot => {
      slot.addEventListener('click', () => {
        const badgeIdx = parseInt(slot.getAttribute('data-badge-slot') || '0', 10);
        // 保存原始徽章列表 + 自动卸下当前徽章
        const team = gameEngine.activeTeam;
        const s = team[this._selectedSlotIndex];
        this._badgeOriginIds = s?.badgeIds ? [...s.badgeIds] : [];
        this._badgeChanged = false;
        if (s?.badgeIds?.[badgeIdx]) {
          s.badgeIds[badgeIdx] = 0;
          gameEngine.saveTeams();
        }
        this._activeBadgeSelectIndex = badgeIdx;
        this.render();
      });
    });
  }

  // 实时更新详情卡徽章槽位（不重建整个DOM）
  private refreshDetailBadges(): void {
    const slots = document.querySelectorAll('.details-badge-slot-frame');
    const monster = this._previewMonster;
    const slotCount = monster?.cost === 4 ? 3 : 2;
    for (let i = 0; i < slotCount; i++) {
      const badgeId = this._pendingBadgeIds[i] || 0;
      const badge = DB_BADGES.find(b => b.id === badgeId);
      const slot = slots[i] as HTMLElement;
      if (!slot) continue;
      if (badge) {
        slot.classList.add('equipped');
        slot.innerHTML = renderBadgeImg(badge.id, 115);
      } else {
        slot.classList.remove('equipped');
        slot.innerHTML = '<span style="font-size:24px; color:#5a5a5a;">+</span>';
      }
    }
  }

  /** 局部切换选中的怪兽槽位（仅更新 data-selected 属性 + 详情卡，不重建 DOM） */
  private _selectSlot(index: number, monster: any): void {
    this._selectedSlotIndex = index;
    this._previewMonster = monster;

    // 更新 squad-cell 的 data-selected 属性
    const cells = this._container.querySelectorAll('.squad-cell');
    cells.forEach(c => {
      const cellIndex = parseInt(c.getAttribute('data-index') || '0', 10);
      if (cellIndex === index && monster) {
        c.setAttribute('data-selected', 'true');
      } else {
        c.removeAttribute('data-selected');
      }
    });

    // 局部刷新右侧详情卡
    this.updateDetailsCard(monster);
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
          <div style="position: absolute; top: ${c.top}px; left: 0; transform: scale(${c.scale}); transform-origin: center center; pointer-events: none; z-index: 2;">
            <div class="cloud-sprite cloud-${c.idx}" style="
              position: static;
              animation: floatCloud ${c.duration}s linear infinite;
              animation-delay: ${c.delay}s;
            "></div>
          </div>
        `).join('')}

        <div class="ship-enter-wrapper">
          <div class="bg-layer ship"></div>
        </div>
      </div>

      <div id="teamEditor" class="ui-interactive${gameEngine.fromOpening ? ' anim-in' : ''}">
        ${teamEditorContent}
      </div>
      <div class="fullscreen-deco-frame">
        <!-- 玩家名牌：透明输入框，叠在 set.png 底部铭牌区域，临时用来设置自己的名字 -->
        <input id="playerNamePlate" class="player-name-plate" type="text" maxlength="12"
          placeholder="${t('输入你的名字', 'Enter your name')}" value="${localStorage.getItem('monsrise_nick') || ''}" />
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
      // Ensure deco frame exists (avoids losing it on re-render)
      let frame = this._container.querySelector('.fullscreen-deco-frame') as HTMLElement | null;
      if (!frame) {
        frame = document.createElement('div');
        frame.className = 'fullscreen-deco-frame';
        this._container.appendChild(frame);
      }
      // 确保玩家名牌输入框存在（放入 set 容器内，作为其子元素显示在 set 之上）
      let plate = frame.querySelector('#playerNamePlate') as HTMLInputElement | null;
      if (!plate) {
        plate = document.createElement('input');
        plate.id = 'playerNamePlate';
        plate.className = 'player-name-plate';
        plate.type = 'text';
        plate.maxLength = 12;
        plate.value = localStorage.getItem('monsrise_nick') || '';
        frame.appendChild(plate);
      }
      plate.placeholder = t('输入你的名字', 'Enter your name');
      // Replace modals
      this._container.querySelectorAll('.modal-overlay').forEach(m => m.remove());
      if (modalsContent.trim()) {
        this._container.insertAdjacentHTML('beforeend', modalsContent);
      }
    }

    this.bindEvents();

    // If modal is active, trigger CSS classes, bind events, and run GSAP sliding animations
    const editorEl = this._container.querySelector('#teamEditor') as HTMLElement | null;
    if (editorEl) {
      if (this._activeMonsterSelectIndex !== null || this._activeBadgeSelectIndex !== null) {
        editorEl.classList.add('monster-selecting');
        this.afterRenderModal();
      } else {
        editorEl.classList.remove('monster-selecting');
      }
    }

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
              return `<button class="squad-tab-btn ${activeClass}" data-team-index="${tIdx}">${tIdx + 1}</button>`;
            }).join('')}
          </div>

          <!-- Squad Grid container -->
          <div class="squad-grid-container">
            ${activeTeam.map((slot: TeamSlot, index: number) => {
              const monster = DB_MONSTERS.find(m => m.id === slot.monsterId);
              return `
                <div class="squad-cell" data-index="${index}" ${monster ? 'draggable="true"' : ''} ${index === this._selectedSlotIndex && this._previewMonster ? 'data-selected="true"' : ''}>
                  ${monster ? `
                    ${renderSpriteImg(monster.sx, monster.sy, monster.sw, monster.sh, { transform: `scale(${1.2 * monster.scale})` })}
                    <div class="monster-switch-btn" data-index="${index}"></div>
                  ` : `
                    <div class="monster-add-btn" data-index="${index}" style="font-size: 32px; color: #5a3c24; font-family: 'Zpix', monospace; opacity: 0.6;">＋</div>
                  `}
                </div>
              `;
            }).join('')}
          </div>

          <!-- Bottom Actions（归属于 left panel 内部） -->
          <div class="editor-actions-container">
            <button id="lobbyExperimentalModeBtn" class="pixel-btn" style="width: 300px; height: 60px; font-size: 54px;">${t('实验模式', 'Sandbox Mode')}</button>
            <button id="lobbyAiModeBtn" class="pixel-btn" style="width: 300px; height: 60px; font-size: 54px;">${t('人机对战', 'VS AI')}</button>
            <button id="lobbyOnlineModeBtn" class="pixel-btn" style="width: 300px; height: 60px; font-size: 54px;">${t('联机模式', 'Online Mode')}</button>
            <button id="lobbyChallengeHistoryBtn" class="pixel-btn" style="width: 300px; height: 60px; font-size: 54px; color: #ffcc00;">${t('对战记录', 'History')}</button>
          </div>

        </div>

        <!-- Right Panel: Monster details card -->
        <div class="details-card${this._previewMonster ? ' visible' : ''}" style="${this._previewMonster ? 'z-index: 31;' : ''}">
          ${renderDetailCard(
            selectedMonster,
            {
              badgesHtml: (() => {
                const slotCount = selectedMonster.cost === 4 ? 3 : 2;
                return Array(slotCount).fill(0).map((_, badgeIdx) => {
                  const badgeId = (activeSlot && activeSlot.badgeIds) ? activeSlot.badgeIds[badgeIdx] : undefined;
                  const badge = DB_BADGES.find(b => b.id === badgeId);
                  const equippedClass = badge ? 'equipped' : '';
                  const imgHtml = badge ? renderBadgeImg(badge.id, 115) : '<span style="font-size:24px; color:#5a5a5a;">+</span>';
                  return `<div class="details-badge-slot-frame ${equippedClass}" data-badge-slot="${badgeIdx}">${imgHtml}</div>`;
                }).join('');
              })(),
            },
            getSkillDescription(selectedMonster)
          )}
        </div>

        <!-- Monster Selection panel (sibling of left panel and details-card) -->
        ${this._activeMonsterSelectIndex !== null ? this.renderMonsterSelectModal() : ''}

        <!-- Badge Selection panel (sibling of left panel and details-card) -->
        ${this._activeBadgeSelectIndex !== null ? this.renderBadgeSelectModal() : ''}
      </div>
    `;

    this.bindEvents();
    if (this._activeMonsterSelectIndex !== null || this._activeBadgeSelectIndex !== null) {
      document.getElementById('teamEditor')?.classList.add('monster-selecting');
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
          <div style="position: absolute; top: ${c.top}px; left: 0; transform: scale(${c.scale}); transform-origin: center center; pointer-events: none; z-index: 2;">
            <div class="cloud-sprite cloud-${c.idx}" style="
              position: static;
              animation: floatCloud ${c.duration}s linear infinite;
              animation-delay: ${c.delay}s;
            "></div>
          </div>
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
      // 用户手势内解锁音乐播放（iOS 自动播放限制），并开始播放大厅音乐
      music.unlock();
      // 进入全屏（隐藏状态栏/地址栏）
      requestFullscreen();
      // Remove button overlay
      this._container.querySelector('.opening-screen')?.remove();
      // Insert ship (triggers CSS shipEnterX animation on DOM insert)
      const bgContainer = this._container.querySelector('.team-editor-bg-container');
      if (bgContainer) {
        bgContainer.insertAdjacentHTML('beforeend', `
          <div class="ship-enter-wrapper">
            <div class="bg-layer ship"></div>
          </div>
        `);
      }
      // 队伍编辑 UI 构建（含 20+ 张贴图 DOM 一次性插入 + bindEvents）
      const buildEditor = () => {
        if (this._container.querySelector('#teamEditor')) return; // 幂等，防止超时兜底重复执行
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
        if (isIOSDevice()) {
          // iOS：一次挂载 20+ 张贴图会导致纹理一次性上传、显存峰值崩溃。
          // 先挂空壳容器，再把子元素分 3 批挂载（每批间隔 120ms），平摊 GPU 纹理上传。
          this._container.appendChild(editorDiv);
          const children = Array.from(editorDiv.children);
          const batchSize = Math.ceil(children.length / 3);
          children.forEach((child, i) => {
            const batch = Math.floor(i / batchSize);
            window.setTimeout(() => {
              if (child.isConnected) return;
              editorDiv.appendChild(child);
            }, batch * 120);
          });
        } else {
          this._container.appendChild(editorDiv);
        }
        // Add set frame border (must be present from start)
        let frame = this._container.querySelector('.fullscreen-deco-frame') as HTMLElement | null;
        if (!frame) {
          frame = document.createElement('div');
          frame.className = 'fullscreen-deco-frame';
          this._container.appendChild(frame);
        }
        // Add player name plate (transparent input over set.png bottom name plate, inside set container)
        if (!frame.querySelector('#playerNamePlate')) {
          const plate = document.createElement('input');
          plate.id = 'playerNamePlate';
          plate.className = 'player-name-plate';
          plate.type = 'text';
          plate.maxLength = 12;
          plate.placeholder = '输入你的名字';
          plate.value = localStorage.getItem('monsrise_nick') || '';
          frame.appendChild(plate);
        }
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
      };
      buildEditor();
    });
  }

  private bindEvents(): void {
    // Squad select tabs ("1 2 3 4 5")
    const tabs = document.querySelectorAll('.squad-tab-btn');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const teamIdx = parseInt(tab.getAttribute('data-team-index') || '0', 10);
        // 防御：teams 不足时补足空队，避免 teams[idx] 为 undefined 导致 render 崩溃
        while (gameEngine.teams.length <= teamIdx) {
          gameEngine.teams.push(Array.from({ length: 8 }, () => ({ monsterId: 0, badgeIds: [] })));
        }
        gameEngine.selectedTeamIndex = teamIdx;
        gameEngine.saveTeams();
        this._previewMonster = null; // Reset details preview on tab switch
        this.render();
      });
    });

    // Grid Cell Selection: click main area of squad cell to preview monster detail
    const cells = document.querySelectorAll('.squad-cell');
    cells.forEach(c => {
      const index = parseInt(c.getAttribute('data-index') || '0', 10);
      c.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('monster-switch-btn') || target.classList.contains('monster-add-btn')) {
          return; // Skip main preview event for switch/add clicks
        }

        this._selectedSlotIndex = index;
        const activeTeam = gameEngine.activeTeam;
        const slot = activeTeam[index];
        if (slot && slot.monsterId > 0) {
          const monster = DB_MONSTERS.find(m => m.id === slot.monsterId);
          if (monster) {
            this._selectSlot(index, monster);
          }
        } else {
          // Empty slot: open monster selector directly
          this._previewMonster = null;
          this._selectedSlotIndex = index;
          this._activeMonsterSelectIndex = index;
          this.render();
        }
      });

      // Drag swap: dragstart — mark source slot
      c.addEventListener('dragstart', ((e: DragEvent) => {
        const activeTeam = gameEngine.activeTeam;
        const slot = activeTeam[index];
        if (!slot || slot.monsterId <= 0) {
          e.preventDefault();
          return;
        }
        this._dragSourceIndex = index;
        c.classList.add('dragging');
        e.dataTransfer!.effectAllowed = 'move';
        e.dataTransfer!.setData('text/plain', String(index));
      }) as EventListener);

      // dragover — allow drop, highlight target
      c.addEventListener('dragover', ((e: DragEvent) => {
        e.preventDefault();
        e.dataTransfer!.dropEffect = 'move';
        c.classList.add('drag-over');
      }) as EventListener);

      c.addEventListener('dragleave', () => {
        c.classList.remove('drag-over');
      });

      // drop — swap monsters
      c.addEventListener('drop', ((e: DragEvent) => {
        e.preventDefault();
        c.classList.remove('drag-over');
        if (this._dragSourceIndex === null) return;
        const sourceIdx = this._dragSourceIndex;
        const targetIdx = index;
        if (sourceIdx === targetIdx) return;

        const team = gameEngine.activeTeam;
        const temp: TeamSlot = { ...team[sourceIdx] };
        team[sourceIdx] = { ...team[targetIdx] };
        team[targetIdx] = temp;

        gameEngine.saveTeams();
        this._dragSourceIndex = null;
        this._previewMonster = null;
        this.render();
      }) as EventListener);

      // dragend — cleanup
      c.addEventListener('dragend', () => {
        c.classList.remove('dragging');
        document.querySelectorAll('.squad-cell').forEach(cell => cell.classList.remove('drag-over'));
        this._dragSourceIndex = null;
      });
    });

    // 🔄 Switch and ＋ Add buttons: trigger monster selection panel directly
    const switchBtns = document.querySelectorAll('.monster-switch-btn, .monster-add-btn');
    switchBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // Avoid triggering cell click detail updates
        const index = parseInt(btn.getAttribute('data-index') || '0', 10);
        const activeTeam = gameEngine.activeTeam;
        const slot = activeTeam[index];
        // 保存原始状态用于面板关闭时还原
        this._switchOriginSlotIndex = index;
        this._switchOriginMonsterId = slot?.monsterId || 0;
        this._switchOriginBadgeIds = slot?.badgeIds ? [...slot.badgeIds] : [];
        // 卸下怪兽，让槽位变空以便直接替换
        if (slot) {
          slot.monsterId = 0;
          slot.badgeIds = [];
          gameEngine.saveTeams();
        }
        // 清除选中状态
        this._selectedSlotIndex = index;
        this._previewMonster = null;
        this._activeMonsterSelectIndex = index;
        this.render();
      });
    });

    // Badge Slots Click inside Right detail card
    const badgeSlots = document.querySelectorAll('.details-badge-slot-frame');
    badgeSlots.forEach(slot => {
      slot.addEventListener('click', () => {
        const badgeIdx = parseInt(slot.getAttribute('data-badge-slot') || '0', 10);
        // 保存原始徽章列表 + 自动卸下当前徽章
        const team = gameEngine.activeTeam;
        const s = team[this._selectedSlotIndex];
        this._badgeOriginIds = s?.badgeIds ? [...s.badgeIds] : [];
        this._badgeChanged = false;
        if (s?.badgeIds?.[badgeIdx]) {
          s.badgeIds[badgeIdx] = 0;
          gameEngine.saveTeams();
        }
        this._activeBadgeSelectIndex = badgeIdx;
        this.render();
      });
    });

    // Bottom Action Game Mode Buttons
    const experimentalBtn = document.getElementById('lobbyExperimentalModeBtn');
    experimentalBtn?.addEventListener('click', () => {
      this._startBattleTransition(() => {
        gameEngine.state = 'PREPARATION_LEFT';
        gameEngine.resetBoardForNextRound();
        uiManager.syncStateWithUI();
      });
    });

    const aiBtn = document.getElementById('lobbyAiModeBtn');
    aiBtn?.addEventListener('click', async () => {
      try {
        const mgr = L1MeleeChallengeManager.getInstance();
        await mgr.loadCatalog();
        const { opponent, archetype } = mgr.sampleOpponent();
        console.log(`[T046] Sampled L1 Opponent: ${opponent.name} (${opponent.memberId}) from ${archetype.displayName}`);

        this._startBattleTransition(() => {
          // 1. 复制玩家自选队伍到 teams[0]
          gameEngine.teams[0] = gameEngine.teams[gameEngine.selectedTeamIndex].map(s => ({
            monsterId: s.monsterId,
            badgeIds: [...s.badgeIds]
          }));

          // 2. 将抽样到的 L1 挑战对手队伍放入 teams[1]
          const oppSlots: { monsterId: number; badgeIds: number[] }[] = (opponent.team || []).map(s => ({
            monsterId: s.monsterId,
            badgeIds: [...s.badgeIds]
          }));
          while (oppSlots.length < 8) {
            oppSlots.push({ monsterId: 0, badgeIds: [] });
          }
          gameEngine.teams[1] = oppSlots;

          // 3. 挂载 L1 对手对象到 gameEngine
          (gameEngine as any)._l1ChallengeOpponent = opponent;
          (gameEngine as any)._l1ChallengeArchetype = archetype;

          gameEngine.mode = 'ai';
          gameEngine.state = 'PREPARATION_LEFT';
          gameEngine.resetBoardForNextRound();
          uiManager.syncStateWithUI();
        });
      } catch (err: any) {
        console.error('[T046] Failed to start L1 Challenge:', err);
        alert(`启动人机对战失败: ${err.message || err}`);
      }
    });

    const historyBtn = document.getElementById('lobbyChallengeHistoryBtn');
    historyBtn?.addEventListener('click', () => {
      L1ChallengeHistoryUI.show();
    });

    const onlineBtn = document.getElementById('lobbyOnlineModeBtn');
    onlineBtn?.addEventListener('click', () => {
      // 再次点击：关闭已打开的联机界面
      if (this._lobbyUI || document.getElementById('lobbyView')) {
        if (this._lobbyUI) {
          this._lobbyUI.close();
        } else {
          // 面板由联机界面自身（返回按钮）关闭过，仅清理残留状态
          document.getElementById('lobbyView')?.remove();
          networkManager.leaveMatch();
          gameEngine.state = 'TEAM_EDIT';
          gameEngine.mode = 'experimental';
        }
        this._lobbyUI = null;
        return;
      }
      gameEngine.teams[0] = gameEngine.teams[gameEngine.selectedTeamIndex].map(s => ({
        monsterId: s.monsterId,
        badgeIds: [...s.badgeIds]
      }));
      gameEngine.mode = 'online';
      gameEngine.state = 'MATCH_LOBBY';
      // 直接叠加联机面板（类似详情卡浮层），不重建队伍编辑界面，避免闪烁
      this._lobbyUI = new LobbyUI(uiManager.container);
      this._lobbyUI.render();
    });

    // 玩家名牌：输入昵称后保存（临时用于设置自己的名字）
    const namePlate = document.getElementById('playerNamePlate') as HTMLInputElement | null;
    namePlate?.addEventListener('change', () => {
      localStorage.setItem('monsrise_nick', namePlate.value.trim());
    });

    // Online confirm button - no longer needed, flow handled in LobbyUI

    // Click outside detail card → hide it
    const hideDetailsOnOutsideClick = (e: MouseEvent) => {
      if (!this._previewMonster) return;
      const target = e.target as HTMLElement;
      if (target.closest('.squad-cell') || target.closest('.details-card') || target.closest('.details-badge-slot-frame') || target.closest('.monster-select-panel') || target.closest('.badge-select-panel')) {
        return;
      }
      this._previewMonster = null;
      this.render();
    };
    this._container.addEventListener('click', hideDetailsOnOutsideClick);
  }



  // --- Modal Rendering ---
  private renderMonsterSelectModal(): string {
    const activeTeam = gameEngine.activeTeam;
    return `
      <div class="monster-select-panel">
        <div class="modal-grid-scroll">
          ${DB_MONSTERS.filter(m => !m.isSummon).map(m => {
            const isSelected = activeTeam.some(slot => slot.monsterId === m.id);
            const activeClass = isSelected ? 'active' : '';
            return `
              <div class="modal-monster-card ${activeClass}" data-monster-id="${m.id}">
                ${renderSpriteImg(m.sx, m.sy, m.sw, m.sh, { transform: `scale(${0.72 * m.scale})`, extraStyle: 'margin-top: 10px; margin-bottom: 12px;' })}
                <div class="modal-monster-name">${t(m.name, m.nameEn)}</div>
                <div class="modal-monster-cost">${m.cost} ${t('费', 'Cost')}</div>
              </div>
            `;
          }).join('')}
        </div>
        <button id="closeMonsterModalBtn" style="background: transparent; border: none; color: #ededed; font-family: 'Zpix', monospace; font-size: 32px; cursor: pointer; padding: 16px 32px; position: absolute; left: 580px; top: 822px; width: 237px;">${t('返回', 'Back')}</button>
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

            // 初始化待选徽章列表：从当前怪兽已有徽章中复制
            const currentBadgeIds = (activeSlot?.badgeIds || []).filter((id: number) => id > 0);
            this._pendingBadgeIds = [...currentBadgeIds];

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
              const isSelected = this._pendingBadgeIds.includes(b.id);
              const badgeHtml = renderBadgeImg(b.id, 150);
              return `
                <div class="modal-badge-card${isSelected ? ' selected' : ''}" data-badge-id="${b.id}">
                  ${badgeHtml}
                  <div class="badge-tooltip">
                    <div class="badge-tooltip-name">${t(b.name, b.nameEn)}</div>
                    <div class="badge-tooltip-desc">${t(b.desc, b.descEn)}</div>
                  </div>
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

            // Pack every 8 cards into a row
            const rows: string[] = [];
            for (let i = 0; i < badgeCardsHtmls.length; i += 8) {
              const chunk = badgeCardsHtmls.slice(i, i + 8);
              rows.push(`
                <div class="badge-row">
                  ${chunk.join('')}
                </div>
              `);
            }
            return rows.join('');
          })()}
        </div>
        <button id="closeBadgeModalBtn" style="background: transparent; border: none; color: #ffffff; font-family: 'Zpix', monospace; font-size: 32px; cursor: pointer; padding: 16px 32px; position: absolute; top: 823px; left: 575px; width: 250px;">${t('返回', 'Back')}</button>
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
        // 如果原始怪兽在面板中被卸下（用户点了同一只怪兽卸下后又关闭面板），还原
        if (this._switchOriginMonsterId > 0 && this._switchOriginSlotIndex >= 0) {
          const team = gameEngine.activeTeam;
          const originSlot = team[this._switchOriginSlotIndex];
          if (originSlot?.monsterId === 0) {
            originSlot.monsterId = this._switchOriginMonsterId;
            originSlot.badgeIds = [...this._switchOriginBadgeIds];
            gameEngine.saveTeams();
          }
        }
        this._switchOriginMonsterId = 0;
        this._switchOriginSlotIndex = -1;
        this._switchOriginBadgeIds = [];
        document.getElementById('teamEditor')?.classList.remove('monster-selecting');
        this._activeMonsterSelectIndex = null;
        this.render();
      });
    }

    const closeBadge = document.getElementById('closeBadgeModalBtn');
    if (closeBadge) {
      closeBadge.addEventListener('click', () => {
        // 如果面板中没有主动修改徽章，还原原始徽章列表
        if (!this._badgeChanged) {
          const team = gameEngine.activeTeam;
          const s = team[this._selectedSlotIndex];
          if (s) {
            s.badgeIds = [...this._badgeOriginIds];
            gameEngine.saveTeams();
          }
        }
        document.getElementById('teamEditor')?.classList.remove('monster-selecting');
        this._activeBadgeSelectIndex = null;
        this._pendingBadgeIds = [];
        this.render();
      });
    }

    // Badge card: single click selects (equips)
    // Mobile long-press shows tooltip
    const badgeCards = document.querySelectorAll('.modal-badge-card');
    badgeCards.forEach(card => {
      let longPressTimer: ReturnType<typeof setTimeout> | null = null;
      let isLongPress = false;

      card.addEventListener('touchstart', () => {
        isLongPress = false;
        longPressTimer = setTimeout(() => {
          isLongPress = true;
          card.querySelector('.badge-tooltip')?.classList.add('show');
        }, 500);
      }, { passive: true });

      card.addEventListener('touchend', () => {
        if (longPressTimer) clearTimeout(longPressTimer);
        card.querySelector('.badge-tooltip')?.classList.remove('show');
      });

      card.addEventListener('touchmove', () => {
        if (longPressTimer) clearTimeout(longPressTimer);
        card.querySelector('.badge-tooltip')?.classList.remove('show');
      }, { passive: true });

      card.addEventListener('click', () => {
        if (isLongPress) return; // long press → don't trigger click
        this._badgeChanged = true;
        const badgeId = parseInt(card.getAttribute('data-badge-id') || '0', 10);
        if (badgeId === 0) return; // 卸下卡已删除
        
        const idx = this._pendingBadgeIds.indexOf(badgeId);
        if (idx >= 0) {
          this._pendingBadgeIds.splice(idx, 1);
        } else {
          const activeSlot = gameEngine.activeTeam[this._selectedSlotIndex];
          const monster = this._previewMonster || DB_MONSTERS.find(m => m.id === activeSlot?.monsterId);
          const maxSlots = (monster && monster.cost === 4) ? 3 : 2;
          if (this._pendingBadgeIds.length >= maxSlots) {
            return; // 已达上限，静默忽略
          }
          this._pendingBadgeIds.push(badgeId);
        }
        // 实时提交到数据并刷新详情卡
        const slot = gameEngine.activeTeam[this._selectedSlotIndex];
        if (slot) {
          slot.badgeIds = [...this._pendingBadgeIds];
          const m = this._previewMonster || DB_MONSTERS.find(m => m.id === slot.monsterId);
          const max = (m && m.cost === 4) ? 3 : 2;
          while (slot.badgeIds.length < max) slot.badgeIds.push(0);
          gameEngine.saveTeams();
          this.refreshDetailBadges();
        }
        // 更新面板内该卡片的选中态视觉效果
        card.classList.toggle('selected', this._pendingBadgeIds.includes(badgeId));
      });
    });
  }

  private refreshMonsterGrid(): void {
    // 只切换 active 类（装备/卸下态），不重建整个卡片网格——
    // 避免 iOS 上快速点击时反复销毁/重建 40+ 张卡片的 DOM 抖动与内存压力
    const cards = this._container.querySelectorAll<HTMLElement>('.modal-monster-card');
    if (!cards.length) return;
    const activeTeam = gameEngine.activeTeam;
    cards.forEach(card => {
      const id = parseInt(card.getAttribute('data-monster-id') || '0', 10);
      card.classList.toggle('active', activeTeam.some(slot => slot.monsterId === id));
    });
  }

  private bindMonsterCardEvents(): void {
    const monsterCards = this._container.querySelectorAll('.modal-monster-card');
    monsterCards.forEach(card => {
      card.addEventListener('click', (e) => {
        e.stopPropagation(); // 防止refreshMonsterGrid销毁DOM后冒泡触发外部点击隐藏详情卡
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
          // 如果卸下的是切换来源槽位的怪兽，标记为主动卸下，关闭时不还原
          if (this._switchOriginSlotIndex === currentSlotIdx) {
            this._switchOriginMonsterId = 0;
          }
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
            // 队伍已满，点击无效（静默忽略）
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

  private _startBattleTransition(callback: () => void) {
    const decoFrame = this._container.querySelector('.fullscreen-deco-frame');
    const teamEditor = document.getElementById('teamEditor');
    const shipWrapper = this._container.querySelector('.ship-enter-wrapper');

    decoFrame?.classList.add('exiting');
    teamEditor?.classList.add('exiting');
    shipWrapper?.classList.add('exiting');

    // 闪黑过渡：exiting 动画（0.8s）期间黑屏淡入，播完后切状态，随后黑屏淡出
    uiManager.flashTo(callback, 800, 300);
  }
}
