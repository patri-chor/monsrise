import type { TeamSlot } from '../game/GameEngine';

type MessageHandler = (data: any) => void;

const MSG = {
  SET_NICK: 'set_nick',
  JOIN_MATCH: 'join_match',
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  LEAVE_MATCH: 'leave_match',
  MATCH_FOUND: 'match_found',
  POOL_UPDATE: 'pool_update',
  ROOM_CREATED: 'room_created',
  ROOM_JOINED: 'room_joined',
  TEAM_CONFIRM: 'team_confirm',
  TEAM_SYNC: 'team_sync',
  PLACE_SYNC: 'place_sync',
  READY: 'ready',
  BATTLE_START: 'battle_start',
  BATTLE_END: 'battle_end',
  ROUND_RESULT: 'round_result',
  OPPONENT_DC: 'opponent_dc',
  ERROR: 'error',
};

export type OnlinePhase = 'lobby' | 'team_edit' | 'placing' | 'waiting' | 'battling';

export class NetworkManager {
  private static _instance: NetworkManager | null = null;
  public static get instance(): NetworkManager {
    if (!NetworkManager._instance) NetworkManager._instance = new NetworkManager();
    return NetworkManager._instance;
  }

  private _ws: WebSocket | null = null;
  private _url: string = '';
  private _handlers = new Map<string, MessageHandler[]>();
  private _reconnectTimer: any = null;
  private _pending: string[] = [];

  public connected = false;
  public isP1 = false;
  public roomId = '';
  public opponentNick = '';
  public opponentTeam: TeamSlot[] = [];
  public phase: OnlinePhase = 'lobby';
  public matchPool: { id: string; nick: string }[] = [];

  private constructor() {}

  // --- 连接 ---
  connect(url: string): void {
    this._url = url;
    this._connect();
  }

  private _connect(): void {
    if (this._ws) this._ws.close();
    this._ws = new WebSocket(this._url);
    this._ws.onopen = () => {
      this.connected = true;
      if (this._reconnectTimer) { clearInterval(this._reconnectTimer); this._reconnectTimer = null; }
      this._emit('onConnect');
      // 自动设置昵称
      const nick = localStorage.getItem('monsrise_nick') || '玩家';
      this.send(MSG.SET_NICK, { nick });
      // 清空积压消息
      for (const raw of this._pending) this._ws!.send(raw);
      this._pending = [];
    };
    this._ws.onclose = () => {
      this.connected = false;
      this._emit('onDisconnect');
      // 自动重连
      if (!this._reconnectTimer) {
        this._reconnectTimer = setInterval(() => this._connect(), 3000);
      }
    };
    this._ws.onmessage = (ev) => {
      try {
        const { type, data } = JSON.parse(ev.data);
        this._dispatch(type, data);
      } catch { /* ignore malformed */ }
    };
  }

  disconnect(): void {
    if (this._reconnectTimer) { clearInterval(this._reconnectTimer); this._reconnectTimer = null; }
    if (this._ws) { this._ws.close(); this._ws = null; }
    this.connected = false;
    this.roomId = '';
    this.opponentNick = '';
    this.opponentTeam = [];
    this.phase = 'lobby';
  }

  // --- 发送 ---
  send(type: string, data: any = {}): void {
    const raw = JSON.stringify({ type, data });
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(raw);
    } else {
      this._pending.push(raw);
    }
  }

  // --- 匹配 ---
  joinMatch(nick: string): void {
    this.send(MSG.SET_NICK, { nick });
    this.send(MSG.JOIN_MATCH);
  }

  createRoom(nick: string): void {
    this.send(MSG.SET_NICK, { nick });
    this.send(MSG.CREATE_ROOM);
  }

  joinRoom(roomId: string, nick: string): void {
    this.send(MSG.SET_NICK, { nick });
    this.send(MSG.JOIN_ROOM, { roomId });
  }

  leaveMatch(): void {
    this.send(MSG.LEAVE_MATCH);
  }

  // --- 游戏同步 ---
  confirmTeam(slots: TeamSlot[]): void {
    this.send(MSG.TEAM_CONFIRM, { slots });
  }

  syncPlacement(placements: { monsterId: number; gridX: number; gridY: number }[]): void {
    this.send(MSG.PLACE_SYNC, { placements });
  }

  sendReady(): void {
    this.send(MSG.READY);
  }

  sendBattleEnd(winner: 1 | 2 | null): void {
    this.send(MSG.BATTLE_END, { winner });
  }

  // --- 事件系统 ---
  on(event: string, handler: MessageHandler): () => void {
    if (!this._handlers.has(event)) this._handlers.set(event, []);
    this._handlers.get(event)!.push(handler);
    return () => {
      const list = this._handlers.get(event);
      if (list) {
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
      }
    };
  }

  private _emit(event: string, data?: any): void {
    (this._handlers.get(event) || []).forEach(h => h(data));
  }

  private _dispatch(type: string, data: any): void {
    console.log(`[net] dispatch type=${type}`, data);
    switch (type) {
      case MSG.POOL_UPDATE:
        this.matchPool = data.players || [];
        this._emit('poolUpdate', data);
        break;
      case MSG.MATCH_FOUND:
      case MSG.ROOM_JOINED:
        this.roomId = data.roomId;
        this.isP1 = data.isP1 ?? false;
        this.opponentNick = data.opponent?.nick || '对手';
        this.phase = 'team_edit';
        this._emit('matchFound', data);
        break;
      case MSG.ROOM_CREATED:
        this.roomId = data.roomId;
        this.isP1 = true;
        this._emit('roomCreated', data);
        break;
      case MSG.TEAM_SYNC:
        this.opponentTeam = data.opponentTeam || [];
        this.phase = 'placing';
        this._emit('teamSync', data);
        break;
      case MSG.PLACE_SYNC:
        this._emit('placeSync', data);
        break;
      case MSG.BATTLE_START:
        this.phase = 'battling';
        this._emit('battleStart', data);
        break;
      case MSG.ROUND_RESULT:
        this.phase = 'team_edit';
        this._emit('roundResult', data);
        break;
      case MSG.OPPONENT_DC:
        this.phase = 'lobby';
        this._emit('opponentDC', data);
        break;
      case MSG.ERROR:
        this._emit('error', data);
        break;
    }
  }
}

export const networkManager = NetworkManager.instance;
