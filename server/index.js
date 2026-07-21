import { WebSocketServer } from 'ws';

const PORT = 3001;
const ROOM_PREFIX = 'MONS';
const PREP_TIMEOUT = 25_000;   // 阵容确认超时
const PLACE_TIMEOUT = 25_000;  // 布阵超时
const DC_GRACE = 8000;         // 断线宽限期

const TYPE = {
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

// --- Helpers ---
function genRoomId() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function send(ws, type, data = {}) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ type, data }));
}

function broadcastPool(server) {
  const players = [];
  server.clients.forEach(c => {
    if (c._player && c._inPool && !c._inRoom) players.push(c._player);
  });
  const msg = JSON.stringify({ type: TYPE.POOL_UPDATE, data: { count: players.length, players } });
  server.clients.forEach(c => {
    if (c.readyState === 1) c.send(msg);
  });
}

function cleanupRoom(server, room, reason) {
  if (!room) return;
  clearTimeout(room._timer);
  clearTimeout(room._dcTimer);
  [room.p1, room.p2].forEach(c => {
    if (c) {
      c._inRoom = null;
      c._playerReady = false;
    }
  });
  server._rooms.delete(room.id);
}

// --- Server ---
const wss = new WebSocketServer({ port: PORT });
wss._rooms = new Map();
console.log(`[server] WebSocket server listening on port ${PORT}`);

wss.on('connection', (ws) => {
  ws._player = null;
  ws._inPool = false;
  ws._inRoom = null;
  ws._playerReady = false;
  ws._isAlive = true;

  ws.on('pong', () => { ws._isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const { type, data } = msg;
    console.log(`[server] recv type=${type} from ${ws._player?.nick || 'anon'}`);

    switch (type) {

      // --- 昵称设置 ---
      case TYPE.SET_NICK: {
        ws._player = { id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, nick: data.nick || '玩家' };
        break;
      }

      // --- 自动匹配 ---
      case TYPE.JOIN_MATCH: {
        if (!ws._player) { send(ws, TYPE.ERROR, { msg: '请先设置昵称' }); return; }
        if (ws._inRoom) { send(ws, TYPE.ERROR, { msg: '已在房间中' }); return; }
        ws._inPool = true;
        broadcastPool(wss);

        // 寻找另一个等待中的玩家
        let opponent = null;
        wss.clients.forEach(c => {
          if (c !== ws && c._inPool && !c._inRoom && c.readyState === 1) opponent = c;
        });
        if (opponent) {
          ws._inPool = false;
          opponent._inPool = false;
          const roomId = genRoomId();
          const room = { id: roomId, p1: opponent, p2: ws, phase: 'team_edit', _timer: null, _dcTimer: null };
          wss._rooms.set(roomId, room);
          opponent._inRoom = room;
          ws._inRoom = room;
          send(opponent, TYPE.MATCH_FOUND, { roomId, isP1: true, opponent: ws._player });
          send(ws, TYPE.MATCH_FOUND, { roomId, isP1: false, opponent: opponent._player });
          broadcastPool(wss);
        }
        break;
      }

      // --- 创建房间 ---
      case TYPE.CREATE_ROOM: {
        if (!ws._player) { send(ws, TYPE.ERROR, { msg: '请先设置昵称' }); return; }
        if (ws._inRoom) { send(ws, TYPE.ERROR, { msg: '已在房间中' }); return; }
        ws._inPool = false;
        const roomId = genRoomId();
        const room = { id: roomId, p1: ws, p2: null, phase: 'team_edit', _timer: null, _dcTimer: null };
        wss._rooms.set(roomId, room);
        ws._inRoom = room;
        broadcastPool(wss);
        send(ws, TYPE.ROOM_CREATED, { roomId });
        break;
      }

      // --- 加入房间 ---
      case TYPE.JOIN_ROOM: {
        if (!ws._player) { send(ws, TYPE.ERROR, { msg: '请先设置昵称' }); return; }
        if (ws._inRoom) { send(ws, TYPE.ERROR, { msg: '已在房间中' }); return; }
        const room = wss._rooms.get(data.roomId);
        if (!room || room.p2 || room.p1 === ws) { send(ws, TYPE.ERROR, { msg: '房间不存在或已满' }); return; }
        ws._inPool = false;
        room.p2 = ws;
        ws._inRoom = room;
        console.log(`[server] room ${room.id}: P2 joined, sending MATCH_FOUND to P1`);
        broadcastPool(wss);
        send(ws, TYPE.ROOM_JOINED, { roomId: room.id, opponent: room.p1._player });
        send(room.p1, TYPE.MATCH_FOUND, { roomId: room.id, isP1: true, opponent: ws._player });
        broadcastPool(wss);
        break;
      }

      // --- 离开匹配池 ---
      case TYPE.LEAVE_MATCH: {
        ws._inPool = false;
        broadcastPool(wss);
        break;
      }

      // --- 阵容确认 ---
      case TYPE.TEAM_CONFIRM: {
        const room = ws._inRoom;
        if (!room) return;
        const opp = room.p1 === ws ? room.p2 : room.p1;
        if (data.slots) {
          ws._teamSlots = data.slots;
        }
        if (opp && opp._teamSlots) {
          // 双方都确认了
          const p1Slots = room.p1._teamSlots;
          const p2Slots = room.p2._teamSlots;
          room.phase = 'placing';
          send(room.p1, TYPE.TEAM_SYNC, { opponentTeam: p2Slots });
          send(room.p2, TYPE.TEAM_SYNC, { opponentTeam: p1Slots });
          // 布阵倒计时
          clearTimeout(room._timer);
          room._timer = setTimeout(() => {
            send(room.p1, TYPE.READY);
            send(room.p2, TYPE.READY);
          }, PLACE_TIMEOUT);
        }
        break;
      }

      // --- 布阵同步 ---
      case TYPE.PLACE_SYNC: {
        const room = ws._inRoom;
        if (!room) return;
        const opp = room.p1 === ws ? room.p2 : room.p1;
        if (data.placements) ws._placements = data.placements;
        if (opp) send(opp, TYPE.PLACE_SYNC, { placements: data.placements });
        break;
      }

      // --- 确认布阵完成 ---
      case TYPE.READY: {
        const room = ws._inRoom;
        if (!room) return;
        ws._playerReady = true;
        const opp = room.p1 === ws ? room.p2 : room.p1;
        if (opp && opp._playerReady) {
          clearTimeout(room._timer);
          room.phase = 'battling';
          const seed = Date.now();
          room._battleSeed = seed;
          room.p1._playerReady = false;
          room.p2._playerReady = false;
          send(room.p1, TYPE.BATTLE_START, { seed, opponentPlacements: room.p2._placements || [] });
          send(room.p2, TYPE.BATTLE_START, { seed, opponentPlacements: room.p1._placements || [] });
        }
        break;
      }

      // --- 战斗结束 ---
      case TYPE.BATTLE_END: {
        const room = ws._inRoom;
        if (!room) return;
        const opp = room.p1 === ws ? room.p2 : room.p1;
        if (opp) send(opp, TYPE.ROUND_RESULT, data);
        break;
      }
    }
  });

  // --- 断线处理 ---
  ws.on('close', () => {
    const room = ws._inRoom;
    ws._inPool = false;
    broadcastPool(wss);

    if (room) {
      const opp = room.p1 === ws ? room.p2 : room.p1;
      if (opp && opp.readyState === 1) {
        if (room.phase === 'battling') {
          // 战斗中掉线 → 判决负
          clearTimeout(room._dcTimer);
          room._dcTimer = setTimeout(() => {
            send(opp, TYPE.OPPONENT_DC, { msg: '对手断开连接' });
            cleanupRoom(wss, room);
          }, DC_GRACE);
        } else {
          send(opp, TYPE.OPPONENT_DC, { msg: '对手断开连接' });
          cleanupRoom(wss, room);
        }
      } else {
        cleanupRoom(wss, room);
      }
    }
  });

  ws.on('error', () => {});
});

// 心跳检测（30s）
const heartbeat = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws._isAlive) return ws.terminate();
    ws._isAlive = false;
    ws.ping();
  });
}, 30_000);
wss.on('close', () => clearInterval(heartbeat));
