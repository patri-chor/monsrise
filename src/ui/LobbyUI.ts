import { gameEngine } from '../game/GameEngine';
import { networkManager } from '../net/NetworkManager';
import { uiManager } from './UIManager';

export class LobbyUI {
  private _container: HTMLDivElement;
  private _nick: string = '';
  private _matched: boolean = false;
  private _unsubs: Array<() => void> = [];

  constructor(container: HTMLDivElement) {
    this._container = container;
    this._nick = localStorage.getItem('monsrise_nick') || '';
    this.bindNetworkEvents();
  }

  private bindNetworkEvents(): void {
    this._unsubs.push(
      networkManager.on('poolUpdate', () => this.render()),
      networkManager.on('roomCreated', (data) => { this.render(); this.showRoomCode(data.roomId); }),
      networkManager.on('matchFound', () => this.onMatchFound()),
      networkManager.on('error', (data) => alert(data.msg || '服务器错误')),
      networkManager.on('opponentDC', () => {
        alert('对手已断开连接');
        networkManager.disconnect();
        gameEngine.state = 'TEAM_EDIT';
        gameEngine.mode = 'experimental';
        uiManager.syncStateWithUI();
      }),
      networkManager.on('teamSync', () => {
        gameEngine.opponentTeam = networkManager.opponentTeam;
        gameEngine.state = gameEngine.isOnlineHost ? 'PREPARATION_LEFT' : 'PREPARATION_RIGHT';
        gameEngine.resetBoardForNextRound();
        uiManager.syncStateWithUI();
      }),
    );
  }

  private saveNick(nick: string): void {
    this._nick = nick;
    localStorage.setItem('monsrise_nick', nick);
  }

  private showRoomCode(code: string): void {
    this.render();
    navigator.clipboard?.writeText(code).catch(() => {});
  }

  private onMatchFound(): void {
    this._matched = true;
    gameEngine.mode = 'online';
    gameEngine.isOnlineHost = networkManager.isP1;
    // 自动发送当前阵容
    networkManager.confirmTeam(gameEngine.teams[0]);
    this.render();
  }

  public render(): void {
    const nick = this._nick;
    const connected = networkManager.connected;
    const roomId = networkManager.roomId;
    const pool = networkManager.matchPool;
    const statusColor = connected ? '#4caf50' : '#f44336';
    const statusText = connected ? '已连接' : '未连接';

    if (this._matched) {
      this._container.innerHTML = `
        <div id="lobbyView" style="
          position: absolute; left: 0; top: 0; width: 100%; height: 100%;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          font-family: 'Press Start 2P', 'Zpix', monospace; color: #fff;
        ">
          <div style="font-size: 36px; color: #4caf50; margin-bottom: 40px;">
            ✓ 匹配成功
          </div>
          <div style="font-size: 28px; color: #ccc; margin-bottom: 20px;">
            对手：${networkManager.opponentNick}
          </div>
        </div>
      `;
      return;
    }

    this._container.innerHTML = `
      <div id="lobbyView" style="
        position: absolute; left: 0; top: 0; width: 100%; height: 100%;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        font-family: 'Press Start 2P', 'Zpix', monospace; color: #fff;
        background: rgba(0,0,0,0.75);
      ">
        <div style="font-size: 96px; margin-bottom: 40px; color: #e5c158; text-shadow: 6px 6px 0 #000;">
          联机对战
        </div>
        <div style="font-size: 28px; margin-bottom: 20px; color: ${statusColor};">
          ● ${statusText}
        </div>
        <div style="margin-bottom: 40px; display: flex; gap: 16px; align-items: center;">
          <input id="lobbyNickInput" type="text" maxlength="8" placeholder="输入昵称" value="${nick}"
            style="padding: 16px 32px; font-size: 32px; font-family: inherit; border: 4px solid #666; border-radius: 8px;
            background: #222; color: #fff; width: 320px; text-align: center;" />
          <button id="lobbyNickSaveBtn" style="
            padding: 16px 32px; font-size: 28px; font-family: inherit; cursor: pointer;
            background: #444; color: #fff; border: 4px solid #666; border-radius: 8px;">保存</button>
        </div>
        <div style="display: flex; gap: 32px; margin-bottom: 40px;">
          <button id="lobbyMatchBtn" style="
            padding: 32px 64px; font-size: 36px; font-family: inherit; cursor: pointer;
            background: #2e7d32; color: #fff; border: 6px solid #4caf50; border-radius: 16px;">
            ⚔ 自动匹配
          </button>
          <button id="lobbyCreateBtn" style="
            padding: 32px 64px; font-size: 36px; font-family: inherit; cursor: pointer;
            background: #1565c0; color: #fff; border: 6px solid #42a5f5; border-radius: 16px;">
            ＋ 创建房间
          </button>
        </div>
        <div style="display: flex; gap: 16px; align-items: center; margin-bottom: 20px;">
          <span style="font-size: 28px;">房间号：</span>
          <input id="lobbyRoomInput" type="text" maxlength="4" placeholder="4位房号"
            style="padding: 16px 24px; font-size: 32px; font-family: inherit; border: 4px solid #666; border-radius: 8px;
            background: #222; color: #fff; width: 200px; text-align: center;" />
          <button id="lobbyJoinBtn" style="
            padding: 16px 40px; font-size: 28px; font-family: inherit; cursor: pointer;
            background: #6a1b9a; color: #fff; border: 4px solid #ab47bc; border-radius: 8px;">加入</button>
        </div>
        ${roomId ? `
          <div style="margin: 20px 0; padding: 20px 40px; background: #1a3a1a; border: 4px solid #4caf50; border-radius: 16px; font-size: 32px;">
            房间号：<span style="color: #e5c158; font-size: 48px;">${roomId}</span>
            <br/><span style="font-size: 24px; color: #999;">等待对手加入...</span>
          </div>
        ` : ''}
        ${pool.length > 0 ? `
          <div style="margin-top: 20px; padding: 24px 48px; background: rgba(255,255,255,0.05); border-radius: 16px; max-height: 320px; overflow-y: auto;">
            <div style="font-size: 28px; color: #aaa; margin-bottom: 16px;">匹配池 (${pool.length}人等待)</div>
            ${pool.map(p => `<div style="font-size: 24px; color: #ccc; padding: 4px 0;">${p.nick}</div>`).join('')}
          </div>
        ` : ''}
        <button id="lobbyBackBtn" style="
          margin-top: 40px; padding: 20px 48px; font-size: 28px; font-family: inherit; cursor: pointer;
          background: transparent; color: #999; border: 4px solid #555; border-radius: 8px;">返回主菜单</button>
      </div>
    `;

    this.bindButtons();
  }

  private bindButtons(): void {
    const saveNick = () => {
      const input = document.getElementById('lobbyNickInput') as HTMLInputElement;
      if (input) this.saveNick(input.value.trim() || '玩家');
    };

    document.getElementById('lobbyNickSaveBtn')?.addEventListener('click', saveNick);
    document.getElementById('lobbyMatchBtn')?.addEventListener('click', () => { saveNick(); networkManager.joinMatch(this._nick); });
    document.getElementById('lobbyCreateBtn')?.addEventListener('click', () => { saveNick(); networkManager.createRoom(this._nick); });

    document.getElementById('lobbyJoinBtn')?.addEventListener('click', () => {
      saveNick();
      const input = document.getElementById('lobbyRoomInput') as HTMLInputElement;
      const code = input?.value.trim();
      if (!code || code.length !== 4) { alert('请输入4位房间号'); return; }
      networkManager.joinRoom(code, this._nick);
    });

    document.getElementById('lobbyBackBtn')?.addEventListener('click', () => {
      for (const unsub of this._unsubs) unsub();
      this._unsubs = [];
      networkManager.leaveMatch();
      gameEngine.state = 'TEAM_EDIT';
      gameEngine.mode = 'experimental';
      uiManager.syncStateWithUI();
    });
  }
}
