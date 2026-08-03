import { gameEngine } from '../game/GameEngine';
import { TeamEditorUI } from './TeamEditorUI';
import { BattleUI } from './BattleUI';
import { SummaryUI } from './SummaryUI';
import { LobbyUI } from './LobbyUI';

export class UIManager {
  private static _instance: UIManager | null = null;
  public static get instance(): UIManager {
    if (!UIManager._instance) {
      UIManager._instance = new UIManager();
    }
    return UIManager._instance;
  }

  public container!: HTMLDivElement;

  // Active UI views
  private _teamEditorUI: TeamEditorUI | null = null;
  private _battleUI: BattleUI | null = null;
  private _summaryUI: SummaryUI | null = null;
  private _lobbyUI: LobbyUI | null = null;

  private constructor() {}

  public init(containerId: string = 'uiOverlay'): void {
    const el = document.getElementById(containerId);
    if (!el) {
      throw new Error(`Could not find UI container element: #${containerId}`);
    }
    this.container = el as HTMLDivElement;
    this.syncStateWithUI();
  }

  public syncStateWithUI(): void {
    // Clear container
    this.container.innerHTML = '';
    
    // Clean up active views
    if (this._battleUI) {
      this._battleUI.onDestroy();
    }
    this._teamEditorUI = null;
    this._battleUI = null;
    this._summaryUI = null;

    const state = gameEngine.state;

    // Clean up battle background layers when leaving battle states
    if (!['PREPARATION_LEFT', 'PREPARATION_RIGHT', 'BATTLE'].includes(state)) {
      const battleBgLayer = document.getElementById('battleBgLayer');
      if (battleBgLayer) battleBgLayer.remove();
      const battleGroundLayer = document.getElementById('battleGroundLayer');
      if (battleGroundLayer) battleGroundLayer.remove();
    }

    if (state === 'OPENING') {
      const gameBg = document.getElementById('gameBg');
      if (gameBg) gameBg.style.backgroundImage = 'none';
      this._teamEditorUI = new TeamEditorUI(this.container);
      this._teamEditorUI.renderOpening();
      return;
    }

    if (state === 'MATCH_LOBBY') {
      this._lobbyUI = new LobbyUI(this.container);
      this._lobbyUI.render();
      return;
    }
    
    // Manage state-specific background image in DOM Layer 1
    const gameBg = document.getElementById('gameBg');
    if (gameBg) {
      gameBg.style.backgroundSize = "100% 100%";
      gameBg.style.backgroundPosition = "top left";
      gameBg.style.backgroundRepeat = "no-repeat";
      // Battle states use their own sky+yun+ground background inside BattleUI
      const useBattleBg = ['OPENING', 'MATCH_LOBBY', 'TEAM_EDIT', 'PREPARATION_LEFT', 'PREPARATION_RIGHT', 'BATTLE'];
      if (useBattleBg.includes(state)) {
        gameBg.style.backgroundImage = "none";
      } else {
        gameBg.style.backgroundImage = "url('fight/ground1.webp')";
      }
    }

    if (state === 'TEAM_EDIT') {
      this._teamEditorUI = new TeamEditorUI(this.container);
      this._teamEditorUI.render();
    } else if (
      state === 'PREPARATION_LEFT' ||
      state === 'PREPARATION_RIGHT' ||
      state === 'BATTLE'
    ) {
      this._battleUI = new BattleUI(this.container);
      this._battleUI.render();
    } else if (state === 'ROUND_END' || state === 'GAME_OVER') {
      this._summaryUI = new SummaryUI(this.container);
      this._summaryUI.render();
    } else if (state === 'REPLAY') {
      this._battleUI = new BattleUI(this.container, true);
      this._battleUI.render();
    }
  }

  // Update dynamic overlay elements like HP bars during battle
  public update(): void {
    if (this._battleUI && gameEngine.state === 'BATTLE') {
      this._battleUI.updateHpBars();
      this._battleUI.updateDetailsCard();
    } else if (this._battleUI && gameEngine.state === 'REPLAY') {
      this._battleUI.updateReplayFrame();
    }
  }
}
export const uiManager = UIManager.instance;
