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
      networkManager.on('poolUpdate', () => this.updatePool()),
      networkManager.on('roomCreated', () => this.render()),
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
      // 连接状态实时刷新
      networkManager.on('onConnect', () => this.updateStatus()),
      networkManager.on('onDisconnect', () => this.updateStatus()),
    );
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
    const connected = networkManager.connected;
    const roomId = networkManager.roomId;
    const pool = networkManager.matchPool;
    const statusText = connected ? '已连接' : '未连接';

    // 只替换联机面板自身，保留同容器中与其共存的队伍编辑界面等兄弟节点
    const prev = document.getElementById('lobbyView');
    if (prev) prev.remove();

    const tmp = document.createElement('div');
    if (this._matched) {
      tmp.innerHTML = `
        <div id="lobbyView" style="
          position: absolute; left: 0; top: 0; width: 100%; height: 100%;
          z-index: 30; background: rgba(0, 0, 0, 0.7);
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          font-family: 'Zpix', monospace; color: #fff;
        ">
          <div style="font-size: 36px; color: #4caf50; margin-bottom: 40px;">
            ✓ 匹配成功
          </div>
          <div style="font-size: 28px; color: #ccc; margin-bottom: 20px;">
            对手：${networkManager.opponentNick}
          </div>
        </div>
      `;
    } else {
      tmp.innerHTML = `
        <div id="lobbyView" class="net-lobby">
          <div class="net-panel">
            <!-- 顶部标题栏 -->
            <div class="net-title">联机模式</div>

            <!-- 创建房间 + 加入房间（居中） -->
            <div class="net-top-row">
              <button id="lobbyCreateBtn" class="net-btn net-btn-green">创建房间</button>
              <button id="lobbyJoinBtn" class="net-btn net-btn-blue">加入房间</button>
            </div>

            <!-- 房间码：输入 / 显示 + 复制键 -->
            <div class="net-room-box">
              <input id="lobbyRoomInput" type="text" maxlength="4" placeholder="4位房间码" value="${roomId}" />
              <button id="lobbyCopyBtn" class="net-copy-btn${roomId ? '' : ' hidden'}">复制</button>
            </div>

            <!-- 搜索对战（与创建房间左对齐） -->
            <button id="lobbyMatchBtn" class="net-btn net-btn-purple">搜索对战</button>

            <!-- 对战池 -->
            <div class="net-pool-box">
              <div class="net-pool-title" id="netPoolTitle">对战池（${pool.length}人等待）</div>
              <div class="net-pool-list" id="netPoolList">
                ${pool.length === 0
                  ? '<div class="net-pool-empty">暂无玩家等待</div>'
                  : pool.map(p => `<div class="net-pool-item">${p.nick}</div>`).join('')}
              </div>
            </div>

            <!-- 底部栏（netp 问号所在高度的栏）：连接情况 + 返回 -->
            <div class="net-bottom-bar">
              <div class="net-status">
                <span>连接情况：</span>
                <span class="net-status-val ${connected ? 'online' : 'offline'}">${statusText}</span>
              </div>
              <button id="lobbyBackBtn" class="net-back-btn">返回</button>
            </div>
          </div>
        </div>
      `;
    }

    const node = tmp.firstElementChild as HTMLElement;
    this._container.appendChild(node);

    if (!this._matched) this.bindButtons();
  }

  /** 关闭联机界面：清理网络订阅并移除面板（保留队伍编辑界面，避免重建闪烁） */
  public close(): void {
    for (const unsub of this._unsubs) unsub();
    this._unsubs = [];
    networkManager.leaveMatch();
    document.getElementById('lobbyView')?.remove();
    gameEngine.state = 'TEAM_EDIT';
    gameEngine.mode = 'experimental';
  }

  /** 仅刷新对战池列表，避免整屏重建导致输入框失焦/闪烁 */
  private updatePool(): void {
    const listEl = document.getElementById('netPoolList');
    const titleEl = document.getElementById('netPoolTitle');
    if (!listEl || !titleEl) return;
    const pool = networkManager.matchPool;
    titleEl.textContent = `对战池（${pool.length}人等待）`;
    listEl.innerHTML = pool.length === 0
      ? '<div class="net-pool-empty">暂无玩家等待</div>'
      : pool.map(p => `<div class="net-pool-item">${p.nick}</div>`).join('');
  }

  /** 仅刷新连接状态指示器 */
  private updateStatus(): void {
    const valEl = document.querySelector('#lobbyView .net-status-val');
    if (!valEl) return;
    const connected = networkManager.connected;
    valEl.className = `net-status-val ${connected ? 'online' : 'offline'}`;
    valEl.textContent = connected ? '已连接' : '未连接';
  }

  private bindButtons(): void {
    const nick = () => this._nick || '玩家';

    document.getElementById('lobbyCreateBtn')?.addEventListener('click', () => {
      networkManager.createRoom(nick());
    });

    document.getElementById('lobbyJoinBtn')?.addEventListener('click', () => {
      const input = document.getElementById('lobbyRoomInput') as HTMLInputElement;
      const code = input?.value.trim() || '';
      if (code.length !== 4) { alert('请输入4位房间号'); return; }
      networkManager.joinRoom(code, nick());
    });

    document.getElementById('lobbyCopyBtn')?.addEventListener('click', (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      if (!networkManager.roomId) return;
      navigator.clipboard?.writeText(networkManager.roomId).catch(() => {});
      btn.textContent = '已复制';
      setTimeout(() => { btn.textContent = '复制'; }, 1200);
    });

    document.getElementById('lobbyMatchBtn')?.addEventListener('click', () => {
      networkManager.joinMatch(nick());
    });

    document.getElementById('lobbyBackBtn')?.addEventListener('click', () => {
      this.close();
    });
  }
}
