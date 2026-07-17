import { gameEngine } from '../game/GameEngine';
import { DB_MONSTERS } from '../game/Database';
import { uiManager } from './UIManager';

// Pixel positions measured from end.png (2556×1179 game coordinate space)
const BOX_X0   = 316;  // left edge of round box 1
const BOX_Y0   = 72;   // top of round boxes
const BOX_W    = 90;   // box width
const BOX_H    = 90;   // box height
const BOX_STEP = 100;  // left-edge step between boxes

const TABLE_LEFT   = 320;  // dark table left edge
const TABLE_RIGHT  = 320;  // dark table right margin (symmetric)
const TABLE_TOP    = 330;  // dark table top
const TABLE_BOTTOM = 189;  // bottom offset from game-bottom (1179-990)

const BTN_BOTTOM   = 36;   // offset from game-bottom to button row

// Font scales
const FS_TITLE   = 68;   // 胜利/失败/平局
const FS_STATS   = 45;   // 战斗用时 / 伤害输出能力   (18 × 2.5)
const FS_HEADER  = 43;   // column headers            (17 × 2.5)
const FS_DATA    = 50;   // table data values         (20 × 2.5)

// Sprite/row scale
const SPRITE_BOX = 120; // sprite container size (fills ~92% of row)
const ROW_H      = 130; // min-height per row
const HDR_H      = 75;  // header row height

export class SummaryUI {
  private _container: HTMLDivElement;
  private _selectedRound: number = 0;

  constructor(container: HTMLDivElement) {
    this._container = container;
  }

  public render(): void {
    const total = gameEngine.perRoundStats.length;
    if (this._selectedRound >= total) {
      this._selectedRound = Math.max(0, total - 1);
    }
    this._container.innerHTML = this._buildHTML();
    this._bindEvents();
  }

  private _buildHTML(): string {
    const total = gameEngine.perRoundStats.length;

    // Title
    let title = '平局';
    if (gameEngine.state === 'GAME_OVER') {
      if (gameEngine.p1Score > gameEngine.p2Score) title = '胜利';
      else if (gameEngine.p2Score > gameEngine.p1Score) title = '失败';
    } else {
      const r = gameEngine.roundResults[gameEngine.roundResults.length - 1];
      if (r === 1) title = '胜利';
      else if (r === 2) title = '失败';
    }

    // Round selector overlays — transparent, white border, no red/green fill
    const roundBoxes = Array(gameEngine.maxRounds).fill(0).map((_, i) => {
      const hasData    = i < total;
      const isSelected = i === this._selectedRound;
      const border = hasData
        ? (isSelected ? '3px solid #ffffff' : '1px solid rgba(255,255,255,0.45)')
        : 'none';
      const shadow = isSelected ? 'box-shadow:0 0 8px 2px rgba(255,255,255,0.6);' : '';

      return `<div data-round-idx="${i}" style="
        position:absolute;
        left:${BOX_X0 + i * BOX_STEP}px; top:${BOX_Y0}px;
        width:${BOX_W}px; height:${BOX_H}px;
        background:transparent;
        border:${border};
        ${shadow}
        cursor:${hasData ? 'pointer' : 'default'};
        pointer-events:${hasData ? 'auto' : 'none'};
        box-sizing:border-box;
        z-index:10;
      "></div>`;
    }).join('');

    // Stats for selected round — P1 first, then P2
    const allStats  = total > 0 ? gameEngine.perRoundStats[this._selectedRound] : [];
    const p1Stats   = allStats.filter(s => s.team === 1);
    const p2Stats   = allStats.filter(s => s.team === 2);
    const elapsed   = total > 0 ? (gameEngine.perRoundElapsed[this._selectedRound] || 0) : 0;
    const totalDmg  = allStats.reduce((s, x) => s + x.damageDealt, 0);
    const dps       = elapsed > 0 ? (totalDmg / elapsed).toFixed(1) : '0.0';

    const renderRow = (stat: typeof allStats[0]) => {
      const dbM    = DB_MONSTERS.find(m => m.id === stat.monsterId);
      const maxDim = Math.max(dbM?.sw ?? 64, dbM?.sh ?? 64);
      const scale  = (SPRITE_BOX * 0.85) / maxDim;

      const sprite = dbM ? `
        <div style="position:relative;width:${SPRITE_BOX}px;height:${SPRITE_BOX}px;overflow:hidden;flex-shrink:0;">
          <img src="all.png" draggable="false" style="
            position:absolute;
            object-fit:none;
            object-position:-${dbM.sx}px -${dbM.sy}px;
            width:${dbM.sw}px; height:${dbM.sh}px;
            left:50%; top:50%;
            transform:translate(-50%,-50%) scale(${scale.toFixed(3)});
            transform-origin:center;
            image-rendering:pixelated;
            display:block; border:none;
          " />
        </div>` : `<div style="width:${SPRITE_BOX}px;height:${SPRITE_BOX}px;"></div>`;

      const side = stat.team === 1 ? '6px solid #6de07a' : '6px solid #f06060';

      return `
        <div style="
          display:flex; align-items:center;
          border-left:${side};
          background-color:rgba(0,0,0,0.1);
          border-bottom:1px solid rgba(255,255,255,0.07);
          padding:5px 12px 5px 5px;
          min-height:${ROW_H}px;
        ">
          <div style="width:${SPRITE_BOX + 10}px;display:flex;justify-content:center;">${sprite}</div>
          <div style="flex:1;display:flex;justify-content:space-around;align-items:center;
            font-family:'Press Start 2P','Zpix',monospace;font-size:${FS_DATA}px;color:#fff;">
            <div style="width:160px;text-align:center;">${stat.killCount}</div>
            <div style="width:260px;text-align:center;">${Math.round(stat.damageDealt)}</div>
            <div style="width:260px;text-align:center;">${Math.round(stat.damageTaken)}</div>
            <div style="width:200px;text-align:center;">${Math.round(stat.healingDone)}</div>
            <div style="width:260px;text-align:center;">${Math.round(stat.healingReceived)}</div>
          </div>
        </div>`;
    };

    const teamDivider = (p1Stats.length > 0 && p2Stats.length > 0)
      ? `<div style="height:4px;background:rgba(255,255,255,0.12);margin:0;"></div>`
      : '';

    const statsRows = allStats.length === 0
      ? `<div style="padding:80px 0;text-align:center;
           font-family:'Press Start 2P','Zpix',monospace;font-size:${FS_HEADER}px;color:#666;">无战斗数据</div>`
      : [
          ...p1Stats.map(renderRow),
          teamDivider,
          ...p2Stats.map(renderRow)
        ].join('');

    return `
      <div class="summary-overlay ui-interactive" style="
        position:absolute; top:0; left:0; width:100%; height:100%;
        z-index:50; overflow:hidden;
      ">
        <!-- Background -->
        <img src="end.png" draggable="false" style="
          position:absolute; top:0; left:0; width:100%; height:100%;
          object-fit:fill; pointer-events:none; image-rendering:pixelated;
        " />

        <!-- Round selector overlays -->
        ${roundBoxes}

        <!-- Title: full-width centered, in round-box row -->
        <div style="
          position:absolute; left:0; right:0;
          top:${BOX_Y0}px; height:${BOX_H}px;
          display:flex; align-items:center; justify-content:center;
          pointer-events:none;
        ">
          <span style="
            font-family:'Press Start 2P','Zpix',monospace;
            font-size:${FS_TITLE}px; color:#fff;
            text-shadow:5px 5px 0 #000,-5px -5px 0 #000,5px -5px 0 #000,-5px 5px 0 #000;
          ">${title}</span>
        </div>

        <!-- Stats info row -->
        <div style="
          position:absolute;
          left:${TABLE_LEFT}px; right:${TABLE_RIGHT}px;
          top:${BOX_Y0 + BOX_H + 16}px;
          display:flex; justify-content:space-between; align-items:center;
          font-family:'Press Start 2P','Zpix',monospace; font-size:${FS_STATS}px; color:#ccc;
          pointer-events:none;
        ">
          <span>战斗用时 &nbsp;${elapsed.toFixed(2)} 秒</span>
          <span>伤害输出能力 &nbsp;${dps}/秒</span>
        </div>

        <!-- Table header — fixed just above dark table area -->
        <div style="
          position:absolute;
          left:${TABLE_LEFT}px; right:${TABLE_RIGHT}px;
          top:${TABLE_TOP - HDR_H}px; height:${HDR_H}px;
          display:flex; align-items:center;
          border-bottom:2px solid rgba(255,255,255,0.18);
          font-family:'Press Start 2P','Zpix',monospace; font-size:${FS_HEADER}px; color:#ccc;
          padding-left:${SPRITE_BOX + 18}px;
          pointer-events:none;
        ">
          <div style="flex:1;display:flex;justify-content:space-around;">
            <div style="width:160px;text-align:center;">击败</div>
            <div style="width:260px;text-align:center;">造成伤害</div>
            <div style="width:260px;text-align:center;">承受伤害</div>
            <div style="width:200px;text-align:center;">治疗</div>
            <div style="width:260px;text-align:center;">接受治疗</div>
          </div>
        </div>

        <!-- Scrollable table body within dark area -->
        <div style="
          position:absolute;
          left:${TABLE_LEFT}px; right:${TABLE_RIGHT}px;
          top:${TABLE_TOP}px; bottom:${TABLE_BOTTOM}px;
          overflow-y:auto; overflow-x:hidden;
        ">
          ${statsRows}
        </div>

        <!-- Buttons in end.png button area (y=999-1155) -->
        <div style="
          position:absolute; left:0; right:0;
          bottom:${BTN_BOTTOM}px;
          display:flex; justify-content:center; gap:200px; align-items:center;
        ">
          <button id="summaryReplayBtn" style="
            width:200px; height:116px;
            background:url('replay.png') center/contain no-repeat;
            background-color:transparent;
            cursor:pointer; border:none; pointer-events:auto;
          "></button>
          <button id="summaryActionBtn" style="
            width:200px; height:116px;
            background:url('end2.png') center/contain no-repeat;
            background-color:transparent;
            cursor:pointer; border:none; pointer-events:auto;
          "></button>
        </div>
      </div>`;
  }

  private _bindEvents(): void {
    // Round selector
    this._container.querySelectorAll('[data-round-idx]').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt((el as HTMLElement).getAttribute('data-round-idx') || '0', 10);
        if (idx < gameEngine.perRoundStats.length) {
          this._selectedRound = idx;
          this.render();
        }
      });
    });

    // Replay → run replay for selected round
    document.getElementById('summaryReplayBtn')?.addEventListener('click', () => {
      // Save current board status
      gameEngine.savedStateBeforeReplay = gameEngine.state;
      gameEngine.savedBoardMonstersBeforeReplay = gameEngine.boardMonsters.map(m => ({
        ...m,
        badges: [...m.badges],
        statusEffects: []
      }));
      gameEngine.savedCurrentRoundBeforeReplay = gameEngine.currentRound;

      // Set replay states
      gameEngine.isReplaying = true;
      gameEngine.isReplayPaused = false;
      gameEngine.currentRound = 1;
      gameEngine.state = 'REPLAY';

      uiManager.syncStateWithUI();
    });

    // Continue / next round
    document.getElementById('summaryActionBtn')?.addEventListener('click', () => {
      if (gameEngine.state === 'GAME_OVER') {
        this._selectedRound = 0;
        gameEngine.restartGame();
        uiManager.syncStateWithUI();
      } else {
        if (gameEngine.isGameOver()) {
          gameEngine.state = 'GAME_OVER';
          this.render();
        } else {
          gameEngine.currentRound += 1;
          gameEngine.state = 'PREPARATION_LEFT';
          gameEngine.resetBoardForNextRound();
          uiManager.syncStateWithUI();
        }
      }
    });
  }
}
