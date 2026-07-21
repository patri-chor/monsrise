"use strict";
var BattleAI = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/battle-ai.ts
  var battle_ai_exports = {};
  __export(battle_ai_exports, {
    BattleAI: () => BattleAI
  });

  // src/data/monsters.ts
  var DB_MONSTERS = Object.freeze([
    { id: 101, name: "\u8083\u6E05\u54E5", cost: 4, type: "melee", hp: 3e3, atk: 120, ats: 1.25, range: 1, speed: 2.5, skill: "reap", skillCd: 2, race: "\u54E5\u5E03\u6797", role: "\u6218\u58EB", sx: 0, sy: 10, sw: 204, sh: 205 },
    { id: 102, name: "\u5927\u796D\u53F8\u54E5", cost: 4, type: "ranged", hp: 2450, atk: 190, ats: 0.59, range: 7, speed: 2.5, skill: "lightning", skillCd: 7, race: "\u54E5\u5E03\u6797", role: "\u6CD5\u5E08", sx: 204, sy: 10, sw: 204, sh: 205 },
    { id: 103, name: "\u5B66\u5F92\u54E5", cost: 2, type: "ranged", hp: 1500, atk: 80, ats: 1.05, range: 5, speed: 2.5, skill: "life_link", skillCd: 3, race: "\u54E5\u5E03\u6797", role: "\u6CD5\u5E08", sx: 408, sy: 10, sw: 204, sh: 205 },
    { id: 104, name: "\u6563\u5F39\u54E5", cost: 2, type: "ranged", hp: 1400, atk: 30, ats: 1.18, range: 5, speed: 2.5, skill: "incendiary", skillCd: 3, race: "\u54E5\u5E03\u6797", role: "\u5C04\u624B", sx: 612, sy: 10, sw: 204, sh: 205 },
    { id: 105, name: "\u7948\u7977\u54E5", cost: 2, type: "ranged", hp: 2e3, atk: 50, ats: 1, range: 5, speed: 2.5, skill: "recovery", skillCd: 0, race: "\u54E5\u5E03\u6797", role: "\u6CD5\u5E08", sx: 0, sy: 215, sw: 204, sh: 205 },
    { id: 106, name: "\u51B2\u950B\u54E5", cost: 2, type: "melee", hp: 2e3, atk: 100, ats: 0.91, range: 1, speed: 2.5, skill: "rush", skillCd: 0, race: "\u54E5\u5E03\u6797", role: "\u7279\u6B8A", sx: 204, sy: 215, sw: 204, sh: 205 },
    { id: 107, name: "\u5492\u6CD5\u9A91\u58EB", cost: 2, type: "ranged", hp: 1500, atk: 130, ats: 0.5, range: 5, speed: 2.5, skill: "big_cannon", skillCd: 0, race: "\u4EBA\u7C7B", role: "\u6CD5\u5E08", sx: 408, sy: 215, sw: 204, sh: 205 },
    { id: 108, name: "\u6551\u661F\u9A91\u58EB", cost: 4, type: "melee", hp: 3600, atk: 120, ats: 1, range: 1, speed: 2.5, skill: "leap", skillCd: 8, race: "\u4EBA\u7C7B", role: "\u6218\u58EB", sx: 617, sy: 205, sw: 204, sh: 205 },
    { id: 109, name: "\u94F6\u72D9\u9A91\u58EB", cost: 2, type: "ranged", hp: 1e3, atk: 300, ats: 0.35, range: 7, speed: 2.5, skill: "shot", skillCd: 8, race: "\u4EBA\u7C7B", role: "\u5C04\u624B", sx: 0, sy: 420, sw: 204, sh: 205 },
    { id: 110, name: "\u5E1D\u56FD\u4E4B\u76FE", cost: 2, type: "melee", hp: 3500, atk: 72, ats: 0.83, range: 1, speed: 2.5, skill: "shield", skillCd: 6, race: "\u4EBA\u7C7B", role: "\u5766\u514B", sx: 204, sy: 425, sw: 204, sh: 205 },
    { id: 111, name: "\u89C1\u4E60\u9A91\u58EB", cost: 2, type: "melee", hp: 2200, atk: 105, ats: 0.91, range: 1, speed: 2.5, skill: "wind_attack", skillCd: 2, race: "\u4EBA\u7C7B", role: "\u6218\u58EB", sx: 408, sy: 420, sw: 204, sh: 205 },
    { id: 112, name: "\u5B88\u536B\u8005\u4E4B\u5251", cost: 2, type: "melee", hp: 2100, atk: 190, ats: 0.5, range: 1, speed: 2.5, skill: "heal_sword", skillCd: 6, race: "\u4EBA\u7C7B", role: "\u5766\u514B", sx: 620, sy: 420, sw: 230, sh: 205 },
    { id: 113, name: "\u7206\u7834\u5927\u5E08", cost: 2, type: "ranged", hp: 1700, atk: 102, ats: 0.74, range: 6, speed: 2.5, skill: "explosive", skillCd: 0, race: "\u77FF\u5DE5", role: "\u6CD5\u5E08", sx: 0, sy: 625, sw: 204, sh: 205 },
    { id: 114, name: "\u7A81\u7A81\u7A81\u77FF\u5DE5", cost: 2, type: "ranged", hp: 1400, atk: 50, ats: 2.14, range: 5, speed: 2.5, skill: "open_fire", skillCd: 0, race: "\u77FF\u5DE5", role: "\u5C04\u624B", sx: 204, sy: 625, sw: 204, sh: 205 },
    { id: 115, name: "\u94F2\u571F\u4EBA", cost: 4, type: "melee", hp: 4500, atk: 200, ats: 0.41, range: 1, speed: 2.5, skill: "unyielding", skillCd: 10, race: "\u77FF\u5DE5", role: "\u5766\u514B", sx: 408, sy: 625, sw: 204, sh: 205 },
    { id: 116, name: "\u94BB\u5934", cost: 2, type: "melee", hp: 1800, atk: 40, ats: 2.38, range: 1, speed: 2.5, skill: "dig", skillCd: 0, race: "\u77FF\u5DE5", role: "\u7279\u6B8A", sx: 624, sy: 625, sw: 204, sh: 205 },
    { id: 117, name: "\u94C1\u7532\u7334", cost: 2, type: "melee", hp: 2e3, atk: 140, ats: 0.71, range: 1, speed: 2.5, skill: "throw", skillCd: 0, race: "\u4E9A\u4EBA", role: "\u7279\u6B8A", sx: 15, sy: 810, sw: 204, sh: 205 },
    { id: 118, name: "\u585E\u96F7", cost: 4, type: "melee", hp: 2700, atk: 120, ats: 1, range: 1, speed: 2.5, skill: "slash", skillCd: 4, race: "\u4E9A\u4EBA", role: "\u6218\u58EB", sx: 212, sy: 824, sw: 204, sh: 205 },
    { id: 119, name: "\u5FCD\u5C0F\u7334", cost: 2, type: "melee", hp: 1400, atk: 86, ats: 1, range: 1, speed: 2.5, skill: "shadow", skillCd: 3.5, race: "\u4E9A\u4EBA", role: "\u7279\u6B8A", sx: 424, sy: 824, sw: 204, sh: 205 },
    { id: 120, name: "\u91D1\u9762\u7334\u738B", cost: 4, type: "ranged", hp: 2500, atk: 48, ats: 2.5, range: 5, speed: 2.5, skill: "attack", skillCd: 4, race: "\u4E9A\u4EBA", role: "\u5C04\u624B", sx: 622, sy: 824, sw: 204, sh: 205 },
    { id: 121, name: "\u50E7\u5C0F\u7334", cost: 2, type: "ranged", hp: 2500, atk: 90, ats: 1.54, range: 5, speed: 2.5, skill: "cultivation", skillCd: 4, race: "\u4E9A\u4EBA", role: "\u5C04\u624B", sx: 0, sy: 1030, sw: 204, sh: 205 },
    { id: 122, name: "\u4E1B\u6797\u7334", cost: 2, type: "ranged", hp: 1150, atk: 30, ats: 2.7, range: 5, speed: 2.5, skill: "anger", skillCd: 3.5, race: "\u4E9A\u4EBA", role: "\u5C04\u624B", sx: 206, sy: 1025, sw: 204, sh: 205 },
    { id: 123, name: "\u68D2\u7403\u7334", cost: 2, type: "melee", hp: 1950, atk: 90, ats: 0.91, range: 1, speed: 2.5, skill: "bash", skillCd: 3, race: "\u4E9A\u4EBA", role: "\u6218\u58EB", sx: 420, sy: 1035, sw: 204, sh: 205 },
    { id: 124, name: "\u4E09\u632F\u738B", cost: 2, type: "ranged", hp: 2e3, atk: 95, ats: 0.59, range: 5, speed: 2.5, skill: "snowball", skillCd: 6, race: "\u4E9A\u4EBA", role: "\u6CD5\u5E08", sx: 620, sy: 1035, sw: 204, sh: 205 },
    { id: 125, name: "\u6218\u58D5", cost: 2, type: "melee", hp: 2350, atk: 150, ats: 0.53, range: 1, speed: 2.5, skill: "conversion", skillCd: 2.5, race: "\u4E9A\u4EBA", role: "\u6218\u58EB", sx: 0, sy: 1240, sw: 204, sh: 205 }
  ]);
  var MONSTER_MAP = new Map(
    DB_MONSTERS.map((m) => [m.id, m])
  );
  var MONSTERS_BY_COST = (() => {
    const map = /* @__PURE__ */ new Map();
    for (const m of DB_MONSTERS) {
      const list = map.get(m.cost) ?? [];
      list.push(m);
      map.set(m.cost, list);
    }
    return new Map([...map.entries()].map(([k, v]) => [k, Object.freeze(v)]));
  })();
  var MONSTERS_BY_RACE = (() => {
    const map = /* @__PURE__ */ new Map();
    for (const m of DB_MONSTERS) {
      const list = map.get(m.race) ?? [];
      list.push(m);
      map.set(m.race, list);
    }
    return new Map([...map.entries()].map(([k, v]) => [k, Object.freeze(v)]));
  })();
  function getMonster(id) {
    return MONSTER_MAP.get(id);
  }
  var TOTAL_BUDGET = 16;
  function getRoundBudget(round) {
    return round <= 3 ? 4 : 2;
  }

  // src/data/badges.ts
  var DB_BADGES = Object.freeze([
    { id: 1, name: "\u7A7F\u900F", desc: "\u8FDC\u7A0B\u653B\u51FB\u7A7F\u900F\u654C\u4EBA\uFF0C\u5BF9\u540E\u7EED\u654C\u4EBA\u9020\u621070%\u4F24\u5BB3" },
    { id: 2, name: "\u51CB\u96F6", desc: "\u76EE\u6807\u9644\u5E26\u8D1F\u9762\u6548\u679C\u6570\u65F6\uFF0C\u666E\u653B\u4F24\u5BB3\u589E\u52A040%\u6BCF\u6548\u679C" },
    { id: 3, name: "\u7834\u76FE", desc: "\u4F24\u5BB3\u589E\u52A025%\uFF0C\u4E00\u51FB\u53EF\u4EE5\u7834\u9664\u76EE\u68074\u5C42\u62A4\u76FE" },
    { id: 4, name: "\u5143\u7D20\u6D8C\u52A8", desc: "\u5BF9\u6280\u80FD\u547D\u4E2D\u7684\u76EE\u6807\u8F6E\u6D41\u65BD\u52A0\u71C3\u70E7\u548C\u5BD2\u51B7\u6548\u679C" },
    { id: 5, name: "\u52A9\u8DD1", desc: "\u5F00\u5C405s\u5185\u6BCF\u79FB\u52A8\u4E00\u683C\u589E\u52A07\u70B9\u653B\u51FB\uFF0C\u6301\u7EED\u5230\u7B2C20s" },
    { id: 6, name: "\u56DE\u590D\u5149\u73AF", desc: "\u6BCF3s\u56DE\u590D5%\u8840\u91CF\uFF0C\u4E14\u63D0\u4F9B\u8303\u56F42\u5149\u73AF\u5185\u5DF1\u65B9+30%\u6CBB\u7597\u91CF" },
    { id: 7, name: "\u5438\u8840", desc: "\u666E\u901A\u653B\u51FB\u56DE\u590D\u81EA\u8EAB\u8840\u91CF\u76842%" },
    { id: 8, name: "\u539A\u76AE", desc: "\u6700\u5927\u751F\u547D\u503C\u589E\u52A01000" },
    { id: 9, name: "\u5EF6\u4F38", desc: "\u6280\u80FD\u53CA\u5FBD\u7AE0\u4F5C\u7528\u8303\u56F4\u589E\u52A01\u683C" },
    { id: 10, name: "\u84C4\u80FD", desc: "\u6280\u80FD\u51B7\u5374\u901F\u5EA6\u52A0\u5FEB40%\uFF0C\u653B\u51FB\u901F\u5EA6\u964D\u4F4E25%" },
    { id: 11, name: "\u9884\u9632", desc: "\u6218\u6597\u5F00\u59CB\u65F6\u83B7\u5F9712\u5C42\u62A4\u76FE" },
    { id: 12, name: "\u7ED3\u9635\u5B88", desc: "\u4E0E\u53CB\u65B9\u76F8\u90BB\u65F6\uFF0C\u6BCF2.5s\u7ED9\u81EA\u5DF1\u548C\u76F8\u90BB\u7684\u53CB\u65B92\u5C42\u76FE" },
    { id: 13, name: "\u7ED3\u9635\u653B", desc: "\u4E0E\u53CB\u65B9\u76F8\u90BB\u65F6\uFF0C\u81EA\u5DF1\u548C\u76F8\u90BB\u7684\u53CB\u65B9\u653B\u51FB\u63D0\u534730" },
    { id: 14, name: "\u72EC\u72FC\u5B88", desc: "\u672A\u5B9E\u73B0\uFF01" },
    { id: 15, name: "\u72EC\u72FC\u653B", desc: "\u672A\u5B9E\u73B0\uFF01" },
    { id: 16, name: "\u8D24\u8005", desc: "\u76F8\u90BB\u53CB\u65B9\u7684\u6280\u80FD\u51B7\u5374\u901F\u5EA6\u52A0\u5FEB50%" },
    { id: 17, name: "\u5927\u53A8", desc: "\u81EA\u8EAB\u4EA7\u751F\u7684\u6CBB\u7597\u6548\u679C\u63D0\u534750%" },
    { id: 18, name: "\u590D\u6D3B", desc: "\u6B7B\u4EA12s\u540E\u4EE520%\u751F\u547D\u503C\u590D\u6D3B\uFF08\u6BCF\u5C40\u4E00\u6B21\uFF09" },
    { id: 19, name: "\u51B3\u6597", desc: "\u672A\u5B9E\u73B0\uFF01" },
    { id: 20, name: "\u72D9\u51FB", desc: "\u5B50\u5F39\u98DE\u884C\u8DDD\u79BB\u8D85\u8FC72\u683C\u65F6\uFF0C\u6BCF\u591A1\u683C\u589E\u52A020%\u4F24\u5BB3" },
    { id: 21, name: "\u53CD\u51FB", desc: "\u53D7\u5230\u4F24\u5BB3\u540E\uFF0C\u4E0B\u4E00\u6B21\u653B\u51FB\u5FC5\u5B9A\u66B4\u51FB" },
    { id: 22, name: "\u9C81\u83BD", desc: "\u666E\u901A\u653B\u51FB\u5BF9\u81EA\u5DF1\u9020\u621016\u70B9\u4F24\u5BB3\uFF0C\u4F46\u4F24\u5BB3\u63D0\u534716%\uFF08\u6301\u7EED2s\uFF0C\u53EF\u53E03\u6B21\uFF09" },
    { id: 23, name: "\u97E7\u6027", desc: "\u751F\u547D\u503C\u4F4E\u4E8E20%\u65F6\uFF0C\u57283\u79D2\u5185\u56DE\u884054%" },
    { id: 24, name: "\u70B8\u5F39", desc: "\u5F00\u5C40\u635F\u593180%\u751F\u547D\uFF0C\u6B7B\u4EA1\u65F6\u5BF9\u8303\u56F41\u654C\u4EBA\u9020\u6210\u627F\u53D7\u4F24\u5BB340%\u7684\u7206\u70B8\u4F24\u5BB3" },
    { id: 25, name: "\u4E2D\u6BD2", desc: "\u653B\u51FB\u6216\u6280\u80FD\u7ED9\u76EE\u6807\u65BD\u52A0\u4E2D\u6BD2\u6548\u679C\uFF0C\u6BCFs\u53D7\u523015\u70B9\u9B54\u6CD5\u4F24\u5BB3" },
    { id: 26, name: "\u4E1B\u6797\u4E4B\u5F71", desc: "\u672A\u5B9E\u73B0\uFF01" },
    { id: 27, name: "\u732E\u796D", desc: "\u514D\u75AB\u6240\u6709\u63A7\u5236\uFF0C\u6BCF2s\u8BA9\u5468\u56F41\u683C\u7684\u602A\u517D\u71C3\u70E7" },
    { id: 28, name: "\u52A0\u56FA", desc: "\u989D\u5916\u83B7\u5F9750%\u7684\u62A4\u76FE" },
    { id: 29, name: "\u534F\u540C\u8FDB\u653B", desc: "\u4E0E\u53CB\u65B9\u76F8\u90BB\u65F6\uFF0C\u653B\u51FB\u901F\u5EA6\u589E\u52A030%" },
    { id: 30, name: "\u53CD\u5E94\u88C5\u7532", desc: "\u81EA\u8EAB\u62A4\u76FE\u7834\u88C2\u6216\u51CF\u5C11\u65F6\uFF0C\u5BF9\u5468\u56F41\u683C\u9020\u62104\u500D\u4E8E\u5F53\u524D\u76FE\u6570\u91CF\u7684\u4F24\u5BB3" },
    { id: 31, name: "\u54E8\u4F4D", desc: "\u672A\u5B9E\u73B0\uFF01" },
    { id: 32, name: "\u5DEB\u6BD2", desc: "\u6218\u6597\u5F00\u59CB\u524D10\u79D2\u514D\u75AB\u6B7B\u4EA1\uFF0C\u6BCF5s\u5C06\u8840\u91CF\u5F3A\u5236\u7F6E\u4E3A20%" },
    { id: 33, name: "\u793C\u7269", desc: "\u6B7B\u4EA1\u540E\u5C06\u81EA\u8EAB\u5F53\u524D\u653B\u51FB\u529B\u768430%\u7ED9\u4E88\u6700\u8FD1\u7684\u53CB\u65B9" },
    { id: 34, name: "\u9006\u8F6C\u672F", desc: "\u672A\u5B9E\u73B0\uFF01" },
    { id: 35, name: "\u63A5\u529B", desc: "\u6B7B\u4EA1\u65F6\u5C06\u81EA\u8EAB\u7684\u7B2C\u4E00\u4E2A\u5FBD\u7AE0\u7684\u6548\u679C\u7ED9\u4E88\u6700\u8FD1\u7684\u53CB\u65B9" }
  ]);
  var BADGE_MAP = new Map(
    DB_BADGES.map((b) => [b.id, b])
  );
  function getBadge(id) {
    return BADGE_MAP.get(id);
  }

  // src/game/types.ts
  var BOARD_WIDTH = 11;
  var BOARD_HEIGHT = 5;
  var P1_ZONE_X_END = 4;
  var P2_ZONE_X_START = 6;
  function createEmptyGameState() {
    const board = [];
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      board[y] = new Array(BOARD_WIDTH).fill(null);
    }
    return {
      board,
      players: {
        p1: { side: "p1", deployed: [], remainingBudget: 4 },
        p2: { side: "p2", deployed: [], remainingBudget: 4 }
      },
      round: 1,
      phase: "placing",
      currentPlayer: "p1",
      nextInstanceId: 1
    };
  }
  function cloneGameState(state) {
    const board = [];
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      board[y] = [...state.board[y]];
    }
    return {
      board,
      players: {
        p1: { ...state.players.p1, deployed: [...state.players.p1.deployed] },
        p2: { ...state.players.p2, deployed: [...state.players.p2.deployed] }
      },
      round: state.round,
      phase: state.phase,
      currentPlayer: state.currentPlayer,
      nextInstanceId: state.nextInstanceId
    };
  }

  // src/game/board.ts
  var Board = class _Board {
    /** 获取单元格所属方 */
    static getSide(x, y) {
      if (x <= P1_ZONE_X_END) return "p1";
      if (x >= P2_ZONE_X_START) return "p2";
      return "neutral";
    }
    /** 获取单元格元数据 */
    static getCell(x, y) {
      if (x < 0 || x >= BOARD_WIDTH || y < 0 || y >= BOARD_HEIGHT) return null;
      return { x, y, side: _Board.getSide(x, y) };
    }
    /** 获取相邻格（上下左右4方向，不越界） */
    static getAdjacent(x, y) {
      const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
      const result = [];
      for (const [dx, dy] of dirs) {
        const cell = _Board.getCell(x + dx, y + dy);
        if (cell) result.push(cell);
      }
      return result;
    }
    /** 曼哈顿距离 */
    static getDistance(a, b) {
      return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    }
    /** 获取玩家部署区域（x 范围 + 全 y） */
    static getPlayerZone(side) {
      const cells = [];
      const xStart = side === "p1" ? 0 : P2_ZONE_X_START;
      const xEnd = side === "p1" ? P1_ZONE_X_END : BOARD_WIDTH - 1;
      for (let y = 0; y < BOARD_HEIGHT; y++) {
        for (let x = xStart; x <= xEnd; x++) {
          cells.push({ x, y, side });
        }
      }
      return cells;
    }
    /** 获取玩家区域中空闲的单元格 */
    static getAvailableSlots(state, side) {
      return _Board.getPlayerZone(side).filter(
        (cell) => state.board[cell.y][cell.x] === null
      );
    }
    /** 校验放置是否合法 */
    static isValidPlacement(state, side, x, y) {
      if (!(x >= 0 && x < BOARD_WIDTH && y >= 0 && y < BOARD_HEIGHT)) return false;
      if (_Board.getSide(x, y) !== side) return false;
      const row = state.board[y];
      if (!row || row[x] !== null) return false;
      return true;
    }
    /** 获取怪兽在棋盘上的位置 */
    static getMonsterPosition(state, instanceId) {
      for (let y = 0; y < BOARD_HEIGHT; y++) {
        for (let x = 0; x < BOARD_WIDTH; x++) {
          const m = state.board[y][x];
          if (m && m.instanceId === instanceId) {
            return { x, y, side: _Board.getSide(x, y) };
          }
        }
      }
      return null;
    }
    /** 获取某方所有部署怪兽的位置 */
    static getDeployedPositions(state, side) {
      const cells = [];
      for (let y = 0; y < BOARD_HEIGHT; y++) {
        for (let x = 0; x < BOARD_WIDTH; x++) {
          const m = state.board[y][x];
          if (m && m.owner === side) {
            cells.push({ x, y, side: _Board.getSide(x, y) });
          }
        }
      }
      return cells;
    }
    /** 两点之间的欧氏距离 */
    static euclideanDistance(a, b) {
      return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
    }
  };

  // src/data/types.ts
  var TIER_BASE_SCORE = {
    "\u592F": 90,
    "\u9876\u7EA7": 80,
    "\u4EBA\u4E0A\u4EBA": 65,
    "NPC": 45,
    "\u62C9": 25
  };
  var COST_BADGE_COUNT = {
    2: 2,
    4: 3
  };

  // src/game/engine.ts
  var GameEngine = class _GameEngine {
    // ==========================================
    // 回合预算
    // ==========================================
    /** 获取指定回合的费用预算（1-3回合=4费, 4-5回合=2费） */
    static getRoundBudget(round) {
      return getRoundBudget(round);
    }
    /** 获取指定回合的徽章数量 */
    static getBadgeCount(cost) {
      return COST_BADGE_COUNT[cost] ?? 0;
    }
    // ==========================================
    // 行动校验
    // ==========================================
    /** 校验放置行动合法性 */
    static validateAction(state, action) {
      const player = state.players[state.currentPlayer];
      const monster = getMonster(action.monsterId);
      if (!monster) {
        return { valid: false, reason: `\u602A\u517D ${action.monsterId} \u4E0D\u5B58\u5728` };
      }
      if (monster.cost > player.remainingBudget) {
        return { valid: false, reason: `\u8D39\u7528\u4E0D\u8DB3\uFF1A\u9700\u8981${monster.cost}\u8D39\uFF0C\u5269\u4F59${player.remainingBudget}\u8D39` };
      }
      if (!Board.isValidPlacement(state, state.currentPlayer, action.x, action.y)) {
        return { valid: false, reason: `\u5750\u6807 (${action.x},${action.y}) \u4E0D\u53EF\u653E\u7F6E` };
      }
      const expectedBadges = COST_BADGE_COUNT[monster.cost];
      if (action.badgeIds.length > 0 && action.badgeIds.length !== expectedBadges) {
        return {
          valid: false,
          reason: `\u5FBD\u7AE0\u6570\u91CF\u4E0D\u7B26\uFF1A${monster.cost}\u8D39\u9700\u8981${expectedBadges}\u4E2A\u5FBD\u7AE0`
        };
      }
      return { valid: true };
    }
    // ==========================================
    // 状态变更
    // ==========================================
    /** 应用放置行动，返回新状态（不可变） */
    static applyAction(state, action) {
      const validation = _GameEngine.validateAction(state, action);
      if (!validation.valid) {
        throw new Error(`\u975E\u6CD5\u884C\u52A8: ${validation.reason}`);
      }
      const newState = cloneGameState(state);
      const player = newState.players[state.currentPlayer];
      const monster = getMonster(action.monsterId);
      const row = newState.board[action.y];
      if (!row) {
        throw new Error(
          `\u5185\u90E8\u9519\u8BEF: clone \u540E board[${action.y}] \u4E0D\u5B58\u5728 (board\u957F\u5EA6=${newState.board.length}, \u5750\u6807=(${action.x},${action.y}))`
        );
      }
      if (row[action.x] !== null) {
        throw new Error(
          `\u5185\u90E8\u9519\u8BEF: clone \u540E (${action.x},${action.y}) \u5DF2\u88AB\u5360\u7528 (\u539F\u6821\u9A8C\u901A\u8FC7\u4F46 clone \u540E\u51B2\u7A81)`
        );
      }
      const instance = {
        instanceId: newState.nextInstanceId,
        monsterId: action.monsterId,
        badgeIds: action.badgeIds,
        position: { x: action.x, y: action.y },
        owner: state.currentPlayer
      };
      row[action.x] = instance;
      const updatedDeployed = [...player.deployed, instance];
      const updatedBudget = player.remainingBudget - monster.cost;
      newState.players[state.currentPlayer] = {
        ...player,
        deployed: updatedDeployed,
        remainingBudget: updatedBudget
      };
      newState.nextInstanceId = state.nextInstanceId + 1;
      return newState;
    }
    /** 结束当前玩家的放置阶段，切换到对手或推进回合 */
    static advancePhase(state) {
      const newState = cloneGameState(state);
      if (newState.currentPlayer === "p1") {
        newState.currentPlayer = "p2";
      } else {
        const nextRound = newState.round + 1;
        if (nextRound > 5) {
          newState.phase = "battle";
          return newState;
        }
        newState.round = nextRound;
        newState.currentPlayer = "p1";
        const budget = _GameEngine.getRoundBudget(nextRound);
        newState.players.p1 = {
          ...newState.players.p1,
          remainingBudget: budget
        };
        newState.players.p2 = {
          ...newState.players.p2,
          remainingBudget: budget
        };
      }
      return newState;
    }
    /** 检查当前玩家是否还有合法行动 */
    static hasLegalActions(state) {
      const available = Board.getAvailableSlots(state, state.currentPlayer);
      const budget = state.players[state.currentPlayer].remainingBudget;
      if (available.length === 0) return false;
      const hasAffordable = getMonster(101).cost <= budget;
      return available.length > 0 && hasAffordable;
    }
    /** 获取当前玩家已部署怪兽的 monsterId 列表 */
    static getDeployedIds(state, side) {
      return state.players[side].deployed.map((m) => m.monsterId);
    }
    /** 获取对手已部署怪兽的 monsterId 列表 */
    static getEnemyDeployedIds(state, side) {
      const enemySide = side === "p1" ? "p2" : "p1";
      return state.players[enemySide].deployed.map((m) => m.monsterId);
    }
  };

  // src/ai/composite_evaluator.ts
  var CompositeEvaluator = class {
    constructor(evaluators) {
      this.evaluators = evaluators;
      const totalWeight = evaluators.reduce((sum, e) => sum + e.weight, 0);
      if (Math.abs(totalWeight - 1) > 0.01) {
        console.warn(`[CompositeEvaluator] \u6743\u91CD\u603B\u548C=${totalWeight.toFixed(2)}\uFF0C\u5EFA\u8BAE\u8C03\u6574\u4E3A1.0`);
      }
    }
    /** 添加评估器（运行时扩展） */
    addEvaluator(evaluator) {
      this.evaluators.push(evaluator);
    }
    /** 移除评估器 */
    removeEvaluator(name) {
      const idx = this.evaluators.findIndex((e) => e.name === name);
      if (idx >= 0) {
        this.evaluators.splice(idx, 1);
        return true;
      }
      return false;
    }
    /** 获取当前评估器列表 */
    getEvaluators() {
      return this.evaluators;
    }
    /**
     * 综合评估
     * 执行顺序：Meta → Combo → Survival → Positioning
     * 后续评估器可以利用前面的识别结果
     */
    evaluate(state, side) {
      const breakdown = {};
      const triggers = [];
      const reasoning = [];
      let weightedSum = 0;
      let totalWeight = 0;
      for (const evaluator of this.evaluators) {
        evaluator.preEvaluate?.(state);
        const result = evaluator.evaluate(state, side);
        evaluator.postEvaluate?.(result);
        breakdown[evaluator.name] = result.score;
        weightedSum += result.score * evaluator.weight;
        totalWeight += evaluator.weight;
        reasoning.push(...result.details);
      }
      const finalScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 50;
      return {
        score: Math.max(0, Math.min(100, finalScore)),
        breakdown,
        triggers,
        reasoning: reasoning.join("\n")
      };
    }
  };

  // src/data/tags.ts
  var MONSTER_TAG_MAP = /* @__PURE__ */ new Map([
    [101, {
      roleTag: "\u6218\u58EB",
      raceTag: "\u54E5\u5E03\u6797",
      tier: "NPC",
      strategyTags: ["frontline", "brawler", "trap_4cost"]
    }],
    [102, {
      roleTag: "\u6CD5\u5E08",
      raceTag: "\u54E5\u5E03\u6797",
      tier: "\u592F",
      strategyTags: ["backline", "caster", "aoe", "anti_backline", "goat"]
    }],
    [103, {
      roleTag: "\u6CD5\u5E08",
      raceTag: "\u54E5\u5E03\u6797",
      tier: "\u592F",
      strategyTags: ["backline", "support", "sustain", "prayer_formation", "game_changer"]
    }],
    [104, {
      roleTag: "\u5C04\u624B",
      raceTag: "\u54E5\u5E03\u6797",
      tier: "\u4EBA\u4E0A\u4EBA",
      strategyTags: ["backline", "aoe", "shield_breaker", "versatile"]
    }],
    [105, {
      roleTag: "\u6CD5\u5E08",
      raceTag: "\u54E5\u5E03\u6797",
      tier: "\u9876\u7EA7",
      strategyTags: ["backline", "healer", "sustain", "prayer_formation"]
    }],
    [106, {
      roleTag: "\u7279\u6B8A",
      raceTag: "\u54E5\u5E03\u6797",
      tier: "\u592F",
      strategyTags: ["frontline", "initiator", "disruptor", "must_bring", "voodoo_carrier"]
    }],
    [107, {
      roleTag: "\u6CD5\u5E08",
      raceTag: "\u4EBA\u7C7B",
      tier: "\u4EBA\u4E0A\u4EBA",
      strategyTags: ["backline", "siege", "burst", "all_rush", "cannon"]
    }],
    [108, {
      roleTag: "\u6218\u58EB",
      raceTag: "\u4EBA\u7C7B",
      tier: "\u592F",
      strategyTags: ["frontline", "diver", "burst", "leap", "most_used_4cost"]
    }],
    [109, {
      roleTag: "\u5C04\u624B",
      raceTag: "\u4EBA\u7C7B",
      tier: "\u4EBA\u4E0A\u4EBA",
      strategyTags: ["backline", "sniper", "glass_cannon", "gift_carrier"]
    }],
    [110, {
      roleTag: "\u5766\u514B",
      raceTag: "\u4EBA\u7C7B",
      tier: "\u592F",
      strategyTags: ["frontline", "tank", "protector", "must_bring", "cost_efficient"]
    }],
    [111, {
      roleTag: "\u6218\u58EB",
      raceTag: "\u4EBA\u7C7B",
      tier: "NPC",
      strategyTags: ["frontline", "brawler", "low_usage"]
    }],
    [112, {
      roleTag: "\u5766\u514B",
      raceTag: "\u4EBA\u7C7B",
      tier: "\u4EBA\u4E0A\u4EBA",
      strategyTags: ["frontline", "tank", "healer", "sustain", "second_healer", "relay"]
    }],
    [113, {
      roleTag: "\u6CD5\u5E08",
      raceTag: "\u77FF\u5DE5",
      tier: "\u4EBA\u4E0A\u4EBA",
      strategyTags: ["backline", "aoe", "caster", "anti_prayer", "sniper_bound"]
    }],
    [114, {
      roleTag: "\u5C04\u624B",
      raceTag: "\u77FF\u5DE5",
      tier: "\u4EBA\u4E0A\u4EBA",
      strategyTags: ["backline", "rapid_fire", "all_rush", "most_used_ranger"]
    }],
    [115, {
      roleTag: "\u5766\u514B",
      raceTag: "\u77FF\u5DE5",
      tier: "\u62C9",
      strategyTags: ["frontline", "tank", "trap_4cost", "role_confused"]
    }],
    [116, {
      roleTag: "\u7279\u6B8A",
      raceTag: "\u77FF\u5DE5",
      tier: "\u592F",
      strategyTags: ["frontline", "disruptor", "most_skillful", "drill_early_late", "all_rush"]
    }],
    [117, {
      roleTag: "\u7279\u6B8A",
      raceTag: "\u4E9A\u4EBA",
      tier: "\u4EBA\u4E0A\u4EBA",
      strategyTags: ["frontline", "initiator", "brawler", "position_control", "all_rush"]
    }],
    [118, {
      roleTag: "\u6218\u58EB",
      raceTag: "\u4E9A\u4EBA",
      tier: "NPC",
      strategyTags: ["frontline", "brawler", "trap_4cost"]
    }],
    [119, {
      roleTag: "\u7279\u6B8A",
      raceTag: "\u4E9A\u4EBA",
      tier: "NPC",
      strategyTags: ["frontline", "assassin", "diver"]
    }],
    [120, {
      roleTag: "\u5C04\u624B",
      raceTag: "\u4E9A\u4EBA",
      tier: "\u62C9",
      strategyTags: ["backline", "rapid_fire", "trap_4cost", "single_target", "countered_by_voodoo"]
    }],
    [121, {
      roleTag: "\u5C04\u624B",
      raceTag: "\u4E9A\u4EBA",
      tier: "\u62C9",
      strategyTags: ["backline", "sustain", "bottom_tier", "self_damage", "never_use"]
    }],
    [122, {
      roleTag: "\u5C04\u624B",
      raceTag: "\u4E9A\u4EBA",
      tier: "NPC",
      strategyTags: ["backline", "rapid_fire", "glass_cannon", "gift_bound"]
    }],
    [123, {
      roleTag: "\u6218\u58EB",
      raceTag: "\u4E9A\u4EBA",
      tier: "NPC",
      strategyTags: ["frontline", "brawler", "disruptor", "low_usage"]
    }],
    [124, {
      roleTag: "\u6CD5\u5E08",
      raceTag: "\u4E9A\u4EBA",
      tier: "\u9876\u7EA7",
      strategyTags: ["backline", "control", "caster", "anti_prayer", "cold_debuff", "versatile"]
    }],
    [125, {
      roleTag: "\u6218\u58EB",
      raceTag: "\u4E9A\u4EBA",
      tier: "NPC",
      strategyTags: ["frontline", "brawler", "sustain", "low_usage"]
    }]
  ]);
  function getMonsterTags(monsterId) {
    const tags = MONSTER_TAG_MAP.get(monsterId);
    if (!tags) {
      return { roleTag: "\u672A\u77E5", raceTag: "\u672A\u77E5", tier: "NPC", strategyTags: [] };
    }
    return tags;
  }
  function hasTag(monsterId, tag) {
    return getMonsterTags(monsterId).strategyTags.includes(tag);
  }
  function getMonsterTier(monsterId) {
    return getMonsterTags(monsterId).tier;
  }
  var BADGE_TAG_MAP = /* @__PURE__ */ new Map([
    [1, { tags: ["pierce", "aoe", "ranged_buff"] }],
    [2, { tags: ["debuff_synergy", "damage_amp"] }],
    [3, { tags: ["shield_break", "damage_amp"] }],
    [4, { tags: ["elemental", "control"] }],
    [5, { tags: ["movement_buff", "scaling"] }],
    [6, { tags: ["heal", "aura", "team_buff"] }],
    [7, { tags: ["lifesteal", "sustain"] }],
    [8, { tags: ["hp_buff", "tank"] }],
    [9, { tags: ["range_buff", "aura_boost"] }],
    [10, { tags: ["skill_cd", "caster"] }],
    [11, { tags: ["shield", "defense"] }],
    [12, { tags: ["adjacency_buff", "shield", "team_defense"] }],
    [13, { tags: ["adjacency_buff", "atk_buff", "team_offense"] }],
    [14, { tags: ["solo_buff", "defense"] }],
    [15, { tags: ["solo_buff", "offense"] }],
    [16, { tags: ["adjacency_buff", "skill_cd", "support"] }],
    [17, { tags: ["heal_amp", "support"] }],
    [18, { tags: ["revive", "insurance", "core_protect"] }],
    [19, { tags: ["challenge", "single_target"] }],
    [20, { tags: ["range_scaling", "sniper", "glass_cannon"] }],
    [21, { tags: ["counter", "reactive"] }],
    [22, { tags: ["self_damage", "damage_amp", "risk"] }],
    [23, { tags: ["emergency_sustain", "comeback"] }],
    [24, { tags: ["sacrifice", "aoe", "suicide"] }],
    [25, { tags: ["dot", "debuff"] }],
    [26, { tags: ["stealth", "survival"] }],
    [27, { tags: ["cc_immune", "aoe_dot", "tank"] }],
    [28, { tags: ["shield_amp", "tank"] }],
    [29, { tags: ["adjacency_buff", "ats_buff", "team_offense"] }],
    [30, { tags: ["shield_synergy", "reactive_aoe", "tank"] }],
    [31, { tags: ["zone_control", "area_denial"] }],
    [32, { tags: ["death_immune", "risky", "comeback"] }],
    [33, { tags: ["death_buff", "team", "sacrifice_value"] }],
    [34, { tags: ["comeback", "transformation"] }],
    [35, { tags: ["death_buff", "badge_transfer", "chain"] }]
  ]);
  function getBadgeTags(badgeId) {
    const tags = BADGE_TAG_MAP.get(badgeId);
    if (!tags) {
      return { tags: [] };
    }
    return tags;
  }
  function badgeHasTag(badgeId, tag) {
    return getBadgeTags(badgeId).tags.includes(tag);
  }
  function detectFormation(monsterIds) {
    const hasApprentice = monsterIds.includes(103);
    const hasPrayer = monsterIds.includes(105);
    const hasCannon = monsterIds.includes(107);
    const hasDrill = monsterIds.includes(116);
    if (hasApprentice && hasPrayer) return "prayer";
    if (hasCannon && hasDrill) return "all_rush";
    return "unknown";
  }
  function hasCombo(monsterIds, combo) {
    return combo.every((id) => monsterIds.includes(id));
  }

  // src/ai/trigger_rules.ts
  var PLACING_RULES = [
    {
      name: "NO_NAKED_CORE",
      condition(state, side, action) {
        if (!action) return false;
        const monsterHasTag = hasTag(action.monsterId, "glass_cannon") || hasTag(action.monsterId, "squishy") || hasTag(action.monsterId, "core_dps") || action.monsterId === 109;
        const isFrontline = action.y < 2;
        if (!monsterHasTag || !isFrontline) return false;
        const hasFrontTank = state.players[side].deployed.some(
          (m) => m.position.y < 2 && hasTag(m.monsterId, "tank")
        );
        return !hasFrontTank;
      },
      adjust: -999,
      // 阻断
      message: "\u26D4 \u524D\u6392\u65E0\u5766\u514B\uFF0C\u7981\u6B62\u5C06\u6838\u5FC3\u8F93\u51FA/\u8106\u76AE\u653E\u5728\u524D\u6392"
    },
    {
      name: "TANK_FRONTLINE",
      condition(state, side) {
        const tanks = state.players[side].deployed.filter(
          (m) => hasTag(m.monsterId, "tank")
        );
        return tanks.some((m) => m.position.y > 1);
      },
      adjust: -8,
      message: "\u5766\u514B\u5E94\u653E\u5728 y=0 \u6216 y=1 \u884C\uFF08\u524D\u6392\uFF09"
    },
    {
      name: "DONT_CLUMP",
      condition(state, side) {
        const positions = state.players[side].deployed.map((m) => m.position);
        for (let i = 0; i < positions.length; i++) {
          let adjCount = 0;
          for (let j = i + 1; j < positions.length; j++) {
            if (Board.getDistance(positions[i], positions[j]) <= 1) adjCount++;
          }
          if (adjCount >= 3) return true;
        }
        return false;
      },
      adjust: -10,
      message: "\u4E09\u53EA\u4EE5\u4E0A\u602A\u517D\u7D27\u90BB \u2014 \u9632AOE\uFF1A\u796D\u7940/\u7206\u7834\u5927\u5E08/\u4E09\u632F\u738B"
    },
    {
      name: "PRIEST_SAFETY",
      condition(state, side) {
        const enemySide = side === "p1" ? "p2" : "p1";
        const enemyIds = state.players[enemySide].deployed.map((m) => m.monsterId);
        if (!enemyIds.includes(102)) return false;
        const backlineX = state.players[side].deployed.filter((m) => m.position.y >= 2).map((m) => m.position.x);
        return new Set(backlineX).size !== backlineX.length;
      },
      adjust: -8,
      message: "\u654C\u65B9\u6709\u796D\u7940(102)\uFF0C\u540E\u6392\u5E94\u5206\u6563\u7AD9\u4F4D"
    },
    {
      name: "SAVIOR_JUMP_PATH",
      condition(state, side) {
        const savior = state.players[side].deployed.find((m) => m.monsterId === 108);
        if (!savior) return false;
        return savior.position.y <= 0 || Board.getCell(savior.position.x, savior.position.y - 1) === null;
      },
      adjust: -5,
      message: "\u6551\u661F(108)\u524D\u65B9\u65E0\u8DF3\u8DC3\u7A7A\u95F4"
    },
    {
      name: "IRON_MONKEY_PRESSURE",
      condition(state, side) {
        const monkey = state.players[side].deployed.find((m) => m.monsterId === 117);
        return monkey !== void 0 && monkey.position.y >= 3;
      },
      adjust: -5,
      message: "\u94C1\u7532\u7334(117)\u5E94\u653E\u5728 y<3 \u4FDD\u6301\u524D\u538B"
    },
    {
      name: "CANNON_DRILL_PROTECT",
      condition(state, side) {
        const cannon = state.players[side].deployed.find((m) => m.monsterId === 107);
        if (!cannon) return false;
        const enemySide = side === "p1" ? "p2" : "p1";
        const enemyDrill = state.players[enemySide].deployed.find((m) => m.monsterId === 116);
        if (!enemyDrill) return false;
        return Board.getDistance(cannon.position, enemyDrill.position) <= 2;
      },
      adjust: -10,
      message: "\u5492\u6CD5(107)\u5728\u94BB\u5934(116)\u53CD\u5236\u8303\u56F4\u5185"
    },
    {
      name: "PRAYER_POSITION",
      condition(state, side) {
        const apprentice = state.players[side].deployed.find((m) => m.monsterId === 103);
        const prayer = state.players[side].deployed.find((m) => m.monsterId === 105);
        if (!apprentice || !prayer) return false;
        return Board.getDistance(apprentice.position, prayer.position) > 1;
      },
      adjust: -8,
      message: "\u7977\u5F92\u9635\u4E2D\u7948\u7977(105)\u4E0E\u5B66\u5F92(103)\u5E94\u76F8\u90BB"
    },
    {
      name: "SAVE_BACKLINE",
      condition(state, side, action) {
        if (!action) return false;
        const isBackline = action.y >= 3;
        const isCoreReserved = hasTag(action.monsterId, "goat") || hasTag(action.monsterId, "core_dps") || action.monsterId === 102 || // 祭祀
        action.monsterId === 108 || // 救星
        action.monsterId === 109;
        return isBackline && !isCoreReserved && state.round <= 3;
      },
      adjust: -5,
      message: "\u540E\u6392\u5E94\u7559\u7ED9\u5C1A\u672A\u90E8\u7F72\u7684\u6838\u5FC3\uFF08\u6551\u661F/\u796D\u7940/\u94F6\u72D9\u7B49\uFF09"
    },
    {
      name: "SNIPER_RANGE",
      condition(state, side) {
        const sniper = state.players[side].deployed.find(
          (m) => m.monsterId === 109 && m.badgeIds.includes(20)
        );
        return sniper !== void 0 && sniper.position.y < 3;
      },
      adjust: -5,
      message: "\u94F6\u72D9(109)+\u72D9\u51FB(20)\u5E94\u653E\u5728 y\u22653 \u6700\u5927\u5316\u5C04\u7A0B\u6536\u76CA"
    },
    {
      name: "SACRIFICE_POSITION",
      condition(state, side) {
        return state.players[side].deployed.some(
          (m) => m.badgeIds.includes(24) && m.position.y !== 0
        );
      },
      adjust: -8,
      message: "\u70B8\u5F39(24)\u5FBD\u7AE0\u602A\u517D\u5E94\u653E\u5728\u6700\u524D\u6392 y=0"
    }
  ];
  function applyPlacingRules(state, side, action) {
    const applied = [];
    let totalAdjust = 0;
    for (const rule of PLACING_RULES) {
      const matches = rule.condition(state, side, action);
      if (matches) {
        applied.push({ rule, applied: true, adjust: rule.adjust });
        totalAdjust += rule.adjust;
        if (rule.adjust <= -999) {
          return { totalAdjust, applied };
        }
      }
    }
    return { totalAdjust, applied };
  }

  // src/game/action.ts
  function generateAllActions(state) {
    const side = state.currentPlayer;
    const budget = state.players[side].remainingBudget;
    const availableSlots = Board.getAvailableSlots(state, side);
    const actions = [];
    const candidates = [];
    for (const [cost, monsters] of MONSTERS_BY_COST) {
      if (cost <= budget) {
        for (const m of monsters) {
          candidates.push(m);
        }
      }
    }
    for (const slot of availableSlots) {
      for (const monster of candidates) {
        actions.push({
          monsterId: monster.id,
          badgeIds: [],
          // 徽章选择留待后续细化
          x: slot.x,
          y: slot.y
        });
      }
    }
    return actions;
  }
  function generateActionsWithCards(state, cards) {
    const side = state.currentPlayer;
    const budget = state.players[side].remainingBudget;
    const availableSlots = Board.getAvailableSlots(state, side);
    const actions = [];
    for (const card of cards) {
      const monster = getMonster(card.monsterId);
      if (!monster || monster.cost > budget) continue;
      for (const slot of availableSlots) {
        actions.push({
          monsterId: card.monsterId,
          badgeIds: card.badgeIds,
          x: slot.x,
          y: slot.y
        });
      }
    }
    return actions;
  }
  function sortActionsByHeuristic(actions, state) {
    const byY = /* @__PURE__ */ new Map();
    for (const a of actions) {
      const group = byY.get(a.y);
      if (group) {
        group.push(a);
      } else {
        byY.set(a.y, [a]);
      }
    }
    const sortedYs = [...byY.keys()].sort((a, b) => a - b);
    const result = [];
    let hasMore = true;
    while (hasMore) {
      hasMore = false;
      for (const y of sortedYs) {
        const group = byY.get(y);
        if (group.length > 0) {
          result.push(group.shift());
          hasMore = true;
        }
      }
    }
    return result;
  }

  // src/ai/search/search_engine.ts
  var SearchEngine = class {
    constructor(evaluator, maxDepth = 1, maxCandidates = 80) {
      this.evaluator = evaluator;
      this.maxDepth = maxDepth;
      this.maxCandidates = maxCandidates;
    }
    /**
     * 搜索最优行动
     * 算法：枚举可行行动 → 评估 → 规则修正 → 排序 → 选最优
     */
    search(state, side) {
      const allActions = generateAllActions(state);
      return this.searchWithActions(state, side, allActions);
    }
    /**
     * 使用预生成行动列表搜索（用于限定卡池的场景）
     * @param layoutEval 可选的布局评估器函数
     */
    searchWithActions(state, side, actions, layoutEval) {
      const startTime = Date.now();
      const trace = [];
      const candidates = [];
      trace.push(`\u4F20\u5165 ${actions.length} \u4E2A\u5019\u9009\u884C\u52A8`);
      if (actions.length === 0) {
        return {
          bestAction: null,
          log: {
            timestamp: startTime,
            candidates: [],
            selected: null,
            searchDepth: 0,
            timeCostMs: 0,
            trace: ["\u65E0\u5408\u6CD5\u884C\u52A8"]
          }
        };
      }
      const sorted = sortActionsByHeuristic(actions, state);
      const trimmedActions = sorted.slice(0, this.maxCandidates);
      trace.push(`\u542F\u53D1\u5F0F\u6392\u5E8F\u540E\u53D6\u524D ${trimmedActions.length} \u4E2A\u5019\u9009`);
      for (const action of trimmedActions) {
        let simulatedState;
        try {
          simulatedState = GameEngine.applyAction(state, action);
        } catch {
          trace.push(`\u8DF3\u8FC7\u975E\u6CD5\u884C\u52A8: ${action.monsterId} @(${action.x},${action.y})`);
          continue;
        }
        const evalResult = this.evaluator.evaluate(simulatedState, side);
        const ruleResult = applyPlacingRules(simulatedState, side, action);
        let layoutTotal = 0;
        let layoutReasons = "";
        if (layoutEval) {
          const layoutAdj = layoutEval(simulatedState, side, action);
          layoutTotal = layoutAdj.totalAdjust;
          layoutReasons = layoutAdj.reasons.join("\n");
        }
        if (ruleResult.totalAdjust <= -999) {
          trace.push(`\u884C\u52A8\u88AB\u963B\u65AD: ${action.monsterId}@(${action.x},${action.y}) \u2014 ${ruleResult.applied[0]?.rule.message}`);
          continue;
        }
        const adjustedScore = evalResult.score + ruleResult.totalAdjust + layoutTotal;
        candidates.push({
          action,
          evalResult: {
            ...evalResult,
            score: Math.max(0, Math.min(100, adjustedScore)),
            triggers: ruleResult.applied.map((a) => a.rule.name),
            reasoning: evalResult.reasoning + "\n" + ruleResult.applied.map((a) => `[\u89C4\u5219] ${a.rule.message}`).join("\n") + (layoutReasons ? "\n" + layoutReasons : "")
          }
        });
      }
      candidates.sort((a, b) => b.evalResult.score - a.evalResult.score);
      const bestAction = candidates.length > 0 ? candidates[0].action : null;
      const timeCost = Date.now() - startTime;
      trace.push(`\u8BC4\u4F30\u5B8C\u6210: ${candidates.length} \u4E2A\u6709\u6548\u5019\u9009`);
      trace.push(`\u6700\u4F18: ${bestAction ? `\u602A\u517D${bestAction.monsterId}@(${bestAction.x},${bestAction.y}) \u5F97\u5206${candidates[0]?.evalResult.score}` : "\u65E0"}`);
      trace.push(`\u8017\u65F6: ${timeCost}ms`);
      return {
        bestAction,
        log: {
          timestamp: startTime,
          candidates,
          selected: bestAction,
          searchDepth: this.maxDepth,
          timeCostMs: timeCost,
          trace
        }
      };
    }
    /** 运行时调整搜索深度 */
    setMaxDepth(depth) {
      this.maxDepth = Math.max(1, Math.min(3, depth));
    }
    /** 运行时调整候选上限 */
    setMaxCandidates(n) {
      this.maxCandidates = Math.max(5, n);
    }
  };

  // src/ai/logger.ts
  var DecisionLogger = class {
    /**
     * 格式化决策日志为可读文本
     */
    formatLog(log) {
      const lines = [];
      lines.push("=".repeat(60));
      lines.push("AI \u51B3\u7B56\u65E5\u5FD7");
      lines.push("=".repeat(60));
      lines.push(`\u65F6\u95F4: ${new Date(log.timestamp).toISOString()}`);
      lines.push(`\u641C\u7D22\u6DF1\u5EA6: ${log.searchDepth}`);
      lines.push(`\u8017\u65F6: ${log.timeCostMs}ms`);
      lines.push(`\u5019\u9009\u6570: ${log.candidates.length}`);
      lines.push("");
      lines.push("--- \u8FFD\u8E2A ---");
      for (const t of log.trace) {
        lines.push(`  ${t}`);
      }
      lines.push("");
      if (log.selected) {
        lines.push("--- \u6700\u7EC8\u9009\u62E9 ---");
        lines.push(`  \u602A\u517DID: ${log.selected.monsterId}`);
        lines.push(`  \u5750\u6807: (${log.selected.x}, ${log.selected.y})`);
        lines.push(`  \u5FBD\u7AE0: ${log.selected.badgeIds.length > 0 ? log.selected.badgeIds.join(",") : "(\u5F85\u5206\u914D)"}`);
      } else {
        lines.push("--- \u6700\u7EC8\u9009\u62E9 ---");
        lines.push("  \u65E0\uFF08\u8DF3\u8FC7\u56DE\u5408\uFF09");
      }
      lines.push("");
      const topCandidates = log.candidates.slice(0, 5);
      if (topCandidates.length > 0) {
        lines.push("--- \u5019\u9009\u6392\u884C (\u524D5) ---");
        for (let i = 0; i < topCandidates.length; i++) {
          const c = topCandidates[i];
          lines.push(`  #${i + 1} [${c.evalResult.score.toFixed(1)}\u5206] \u602A\u517D${c.action.monsterId}@(${c.action.x},${c.action.y})`);
          if (c.evalResult.breakdown) {
            const bd = Object.entries(c.evalResult.breakdown).map(([k, v]) => `${k}=${v.toFixed(0)}`).join(", ");
            lines.push(`    \u5206\u9879: ${bd}`);
          }
          if (c.evalResult.triggers && c.evalResult.triggers.length > 0) {
            lines.push(`    \u89E6\u53D1\u89C4\u5219: ${c.evalResult.triggers.join(", ")}`);
          }
        }
      }
      lines.push("");
      lines.push("=".repeat(60));
      const output = lines.join("\n");
      console.log(output);
      return output;
    }
    /**
     * 输出为结构化 JSON
     */
    toJSON(log) {
      return {
        timestamp: new Date(log.timestamp).toISOString(),
        searchDepth: log.searchDepth,
        timeCostMs: log.timeCostMs,
        selected: log.selected ? {
          monsterId: log.selected.monsterId,
          x: log.selected.x,
          y: log.selected.y,
          badgeIds: log.selected.badgeIds
        } : null,
        candidates: log.candidates.map((c) => ({
          monsterId: c.action.monsterId,
          x: c.action.x,
          y: c.action.y,
          score: c.evalResult.score,
          breakdown: c.evalResult.breakdown,
          triggers: c.evalResult.triggers
        })),
        trace: log.trace
      };
    }
  };

  // src/ai/base_evaluator.ts
  var BaseEvaluator = class {
    /** 工具方法：限制分数在 0-100 范围内 */
    clamp(score) {
      return Math.max(0, Math.min(100, score));
    }
    /** 工具方法：生成带评估器名称前缀的详细说明 */
    detail(msg) {
      return `[${this.name}] ${msg}`;
    }
  };

  // src/ai/evaluators/meta_value.ts
  var MetaValueEvaluator = class extends BaseEvaluator {
    constructor() {
      super(...arguments);
      this.name = "MetaValue";
      this.weight = 0.1;
    }
    evaluate(state, side) {
      const details = [];
      let score = 50;
      const deployedIds = GameEngine.getDeployedIds(state, side);
      const allMonsters = [...deployedIds];
      if (allMonsters.length > 0) {
        let tierSum = 0;
        for (const id of allMonsters) {
          const tier = getMonsterTier(id);
          tierSum += TIER_BASE_SCORE[tier];
        }
        const avgTier = tierSum / allMonsters.length;
        score += (avgTier - 50) * 0.5;
        const worstId = allMonsters.reduce((worst, id) => {
          const currentScore = TIER_BASE_SCORE[getMonsterTier(id)];
          const worstScore = TIER_BASE_SCORE[getMonsterTier(worst)];
          return currentScore < worstScore ? id : worst;
        }, allMonsters[0]);
        details.push(this.detail(`\u9635\u5BB9\u57FA\u6570: ${allMonsters.length}\u53EA, \u5747\u5206${avgTier.toFixed(0)}`));
        if (TIER_BASE_SCORE[getMonsterTier(worstId)] <= 45) {
          details.push(this.detail(`\u26A0 \u5B58\u5728\u4F4ETier\u602A\u517D: ID=${worstId} (${getMonsterTier(worstId)})`));
        }
      }
      const missingMust = [];
      if (!allMonsters.includes(110)) missingMust.push("\u5E1D\u56FD\u4E4B\u76FE(110)");
      if (!allMonsters.includes(106)) missingMust.push("\u51B2\u950B(106)");
      if (missingMust.length > 0) {
        details.push(this.detail(`\u26A0 \u7F3A\u5C11\u5FC5\u5907\u5361: ${missingMust.join(", ")}`));
        score -= missingMust.length * 15;
      }
      const trap4CostIds = [101, 118, 120, 115];
      const trapCount = allMonsters.filter((id) => trap4CostIds.includes(id)).length;
      if (trapCount > 0) {
        details.push(this.detail(`\u26A0 \u4F7F\u7528\u4E86${trapCount}\u53EA\u56DB\u8D39\u9677\u9631\u5361\uFF08${trap4CostIds.filter((id) => allMonsters.includes(id)).join(",")}\uFF09`));
        score -= trapCount * 10;
      }
      if (allMonsters.includes(121)) {
        details.push(this.detail("\u26D4 \u4F7F\u7528\u4E86\u50E7\u7334(121) \u2014 \u7248\u672C\u57AB\u5E95"));
        score -= 30;
      }
      const formation = detectFormation(allMonsters);
      if (formation === "prayer") {
        details.push(this.detail("\u2705 \u68C0\u6D4B\u5230\u7977\u5F92\u9635\uFF08\u5B66\u5F92+\u7948\u7977\uFF09"));
        score += 20;
        if (allMonsters.includes(110)) {
          details.push(this.detail("  \u7977\u5F92\u9635+\u5E1D\u56FD\u4E4B\u76FE \u2014 \u524D\u6392\u7A33\u56FA"));
          score += 5;
        }
        if (allMonsters.includes(102)) {
          details.push(this.detail("  \u7977\u5F92\u9635+\u796D\u7940 \u2014 \u540E\u6392AOE\u8986\u76D6"));
          score += 10;
        }
        if (allMonsters.includes(112)) {
          details.push(this.detail("  \u7977\u5F92\u9635+\u5B88\u536B\u8005\u4E4B\u5251 \u2014 \u7B2C\u4E8C\u56DE\u590D\u6838\u5FC3"));
          score += 5;
        }
        if (allMonsters.includes(124)) {
          details.push(this.detail("  \u7977\u5F92\u9635+\u4E09\u632F\u738B \u2014 \u514B\u5236\u5BF9\u65B9\u7977\u5F92"));
          score += 8;
        }
      } else if (formation === "all_rush") {
        details.push(this.detail("\u2705 \u68C0\u6D4B\u5230\u5168\u51B2\u9635\uFF08\u5492\u6CD5+\u94BB\u5934\uFF09"));
        score += 20;
        if (allMonsters.includes(114)) {
          details.push(this.detail("  \u5168\u51B2\u9635+\u7A81\u7A81\u7A81\u77FF\u5DE5 \u2014 \u6700\u5F3A\u5C04\u624B\u8F93\u51FA"));
          score += 8;
        }
        if (allMonsters.includes(117)) {
          details.push(this.detail("  \u5168\u51B2\u9635+\u94C1\u7532\u7334 \u2014 \u8D70\u4F4D\u538B\u5236"));
          score += 5;
        }
      } else {
        details.push(this.detail("\u672A\u5F62\u6210\u660E\u786E\u4F53\u7CFB\uFF0C\u8BC4\u5206\u504F\u4F4E"));
        score -= 5;
      }
      if (hasCombo(allMonsters, [103, 105])) {
        details.push(this.detail("\u5B66\u5F92+\u7948\u7977\u8054\u52A8 \u2014 \u6700\u5F3A\u673A\u5236"));
      } else if (allMonsters.includes(103) && !allMonsters.includes(105)) {
        details.push(this.detail("\u26A0 \u5355\u72EC\u5E26\u5B66\u5F92(103)\u65E0\u7948\u7977(105) \u2014 \u8D1F\u6536\u76CA"));
        score -= 15;
      }
      return { score: this.clamp(score), details };
    }
  };

  // src/ai/evaluators/survival_safety.ts
  var SurvivalSafetyEvaluator = class extends BaseEvaluator {
    constructor() {
      super(...arguments);
      this.name = "SurvivalSafety";
      this.weight = 0.2;
    }
    evaluate(state, side) {
      const details = [];
      let score = 50;
      const deployed = state.players[side].deployed;
      const enemySide = side === "p1" ? "p2" : "p1";
      const enemyDeployed = state.players[enemySide].deployed;
      const enemyIds = enemyDeployed.map((m) => m.monsterId);
      if (deployed.length === 0) {
        return { score: 50, details: [this.detail("\u6682\u65E0\u90E8\u7F72")] };
      }
      score += this.evaluateFrontline(deployed, details);
      score += this.evaluatePrayerFormation(deployed, details);
      score += this.evaluateSquishyProtection(deployed, details);
      score += this.evaluateBadgeProtection(deployed, details);
      score += this.evaluateThreatResponse(deployed, enemyDeployed, enemyIds, details);
      score += this.evaluateFormationResilience(deployed, enemyIds, details);
      return { score: this.clamp(score), details };
    }
    // ================================================================
    // 1. 前排防线
    // ================================================================
    evaluateFrontline(deployed, details) {
      let score = 0;
      const frontline = deployed.filter((m) => m.position.y <= 1);
      const topLine = deployed.filter((m) => m.position.y === 0);
      const shield = deployed.find((m) => m.monsterId === 110 && m.position.y <= 1);
      if (shield) {
        details.push(this.detail("\u5E1D\u56FD\u4E4B\u76FE\u9547\u5B88\u524D\u6392 \u2014 \u9876\u7EA7\u9632\u7EBF\uFF08+18\uFF09"));
        score += 18;
      }
      const tanks = deployed.filter((m) => hasTag(m.monsterId, "tank"));
      const tanksInFront = tanks.filter((m) => m.position.y <= 1);
      if (!shield && tanksInFront.length > 0) {
        details.push(this.detail(`\u524D\u6392${tanksInFront.length}\u53EA\u5766\u514B \u2014 \u9632\u7EBF\u826F\u597D\uFF08+8\uFF09`));
        score += 8;
      }
      if (deployed.length >= 3 && frontline.length === 0) {
        details.push(this.detail("\u26D4 \u5B8C\u5168\u6CA1\u6709\u524D\u6392 \u2014 \u751F\u5B58\u6781\u5371\uFF08-15\uFF09"));
        score -= 15;
      } else if (deployed.length >= 4 && topLine.length === 0 && !deployed.some((m) => m.position.y === 1 && hasTag(m.monsterId, "tank"))) {
        details.push(this.detail("\u26A0 \u7B2C1\u884C\u65E0\u5766\u514B\u628A\u5B88 \u2014 \u9632\u7EBF\u8584\u5F31\uFF08-7\uFF09"));
        score -= 7;
      }
      if (frontline.length > 0 && deployed.length >= 4) {
        const xCovered = new Set(frontline.map((m) => m.position.x));
        if (xCovered.size >= 3) {
          details.push(this.detail(`\u524D\u6392\u8986\u76D6${xCovered.size}\u5217 \u2014 \u9632\u7EBF\u5C55\u5F00\u826F\u597D`));
          score += 3;
        } else if (xCovered.size <= 1 && frontline.length >= 2) {
          details.push(this.detail("\u26A0 \u524D\u6392x\u5217\u96C6\u4E2D \u2014 \u4FA7\u9762\u66B4\u9732\uFF08-4\uFF09"));
          score -= 4;
        }
      }
      return score;
    }
    // ================================================================
    // 2. 祷徒阵
    // ================================================================
    evaluatePrayerFormation(deployed, details) {
      let score = 0;
      const hasApprentice = deployed.some((m) => m.monsterId === 103);
      const hasPrayerMonk = deployed.some((m) => m.monsterId === 105);
      const deployedIds = deployed.map((m) => m.monsterId);
      if (hasApprentice && hasPrayerMonk) {
        details.push(this.detail("\u7977\u5F92\u9635\u6FC0\u6D3B\uFF08\u8840\u91CF\u5171\u4EAB+\u7FA4\u4F53\u56DE\u8840\uFF09\u2014 \u6781\u5927\u63D0\u5347\u5168\u961F\u751F\u5B58\uFF08+28\uFF09"));
        score += 28;
        const apprentice = deployed.find((m) => m.monsterId === 103);
        const prayer = deployed.find((m) => m.monsterId === 105);
        const dist = Board.getDistance(apprentice.position, prayer.position);
        if (dist <= 1) {
          details.push(this.detail("  \u5B66\u5F92\u4E0E\u7948\u7977\u76F8\u90BB \u2014 \u6700\u4F18\u534F\u540C\uFF08+5\uFF09"));
          score += 5;
        } else if (dist <= 2) {
          details.push(this.detail("  \u5B66\u5F92\u4E0E\u7948\u7977\u8DDD\u79BB2\u683C \u2014 \u534F\u540C\u826F\u597D\uFF08+2\uFF09"));
          score += 2;
        } else {
          details.push(this.detail("  \u26A0 \u5B66\u5F92\u4E0E\u7948\u7977\u8DDD\u79BB\u8FDC \u2014 \u534F\u540C\u53D7\u9650\uFF08-4\uFF09"));
          score -= 4;
        }
        if (deployedIds.includes(102)) {
          details.push(this.detail("  \u796D\u7940\u52A0\u5165\u7977\u5F92 \u2014 \u5B8C\u6574\u4F53\u7CFB\uFF08+6\uFF09"));
          score += 6;
        }
        if (deployedIds.includes(112)) {
          details.push(this.detail("  \u5B88\u536B\u8005\u4E4B\u5251\u5728\u573A \u2014 \u7B2C\u4E8C\u56DE\u590D\u6838\u5FC3\uFF08+5\uFF09"));
          score += 5;
        }
        if (deployedIds.includes(104)) {
          details.push(this.detail("  \u6563\u5F39\u5728\u573A \u2014 \u7834\u76FE+\u5143\u7D20\uFF08+3\uFF09"));
          score += 3;
        }
      } else if (hasApprentice || hasPrayerMonk) {
        const which = hasApprentice ? "\u5B66\u5F92" : "\u7948\u7977";
        details.push(this.detail(`\u26A0 \u4EC5\u6709${which}\uFF0C\u7977\u5F92\u9635\u4E0D\u5B8C\u6574 \u2014 \u751F\u5B58\u5927\u5E45\u4E0B\u964D\uFF08-10\uFF09`));
        score -= 10;
      }
      return score;
    }
    // ================================================================
    // 3. 脆皮保护
    // ================================================================
    evaluateSquishyProtection(deployed, details) {
      let score = 0;
      const squishyIds = /* @__PURE__ */ new Set([109, 122, 121, 107, 102, 108, 113]);
      const squishyInFront = deployed.filter(
        (m) => m.position.y <= 1 && (squishyIds.has(m.monsterId) || hasTag(m.monsterId, "glass_cannon") || hasTag(m.monsterId, "squishy"))
      );
      if (squishyInFront.length > 0) {
        const names = squishyInFront.map((m) => getMonster(m.monsterId)?.name ?? "?");
        details.push(this.detail(`\u26D4 \u8106\u76AE\u602A\u517D\u5728\u524D\u6392(y\u22641): ${names.join(",")}\uFF08-${squishyInFront.length * 12}\uFF09`));
        score -= squishyInFront.length * 12;
      }
      const squishyInBack = deployed.filter(
        (m) => m.position.y >= 2 && (squishyIds.has(m.monsterId) || hasTag(m.monsterId, "glass_cannon"))
      );
      if (squishyInBack.length > 0) {
        const blockers = deployed.filter(
          (m) => m.position.y < 2 && (hasTag(m.monsterId, "tank") || hasTag(m.monsterId, "brawler"))
        );
        if (blockers.length > 0) {
          details.push(this.detail(`\u540E\u6392\u8106\u76AE${squishyInBack.length}\u53EA\u53D7\u524D\u6392\u4FDD\u62A4\uFF08+6\uFF09`));
          score += 6;
        }
      }
      return score;
    }
    // ================================================================
    // 4. 徽章防护
    // ================================================================
    evaluateBadgeProtection(deployed, details) {
      let score = 0;
      const reviveCount = deployed.filter((m) => m.badgeIds.includes(18)).length;
      if (reviveCount > 0) {
        details.push(this.detail(`\u590D\u6D3B\u5FBD\u7AE0\xD7${reviveCount} \u2014 \u5173\u952E\u5BB9\u9519\uFF08+${reviveCount * 5}\uFF09`));
        score += reviveCount * 5;
      }
      const thickSkinOnTanks = deployed.filter(
        (m) => m.badgeIds.includes(8) && hasTag(m.monsterId, "tank")
      );
      if (thickSkinOnTanks.length > 0) {
        details.push(this.detail(`\u5766\u514B${thickSkinOnTanks.length}\u53EA\u643A\u5E26\u539A\u76AE \u2014 \u786C\u5EA6\u63D0\u5347\uFF08+${thickSkinOnTanks.length * 4}\uFF09`));
        score += thickSkinOnTanks.length * 4;
      }
      const preventCount = deployed.filter((m) => m.badgeIds.includes(11)).length;
      if (preventCount > 0) {
        details.push(this.detail(`\u9884\u9632\u5FBD\u7AE0\xD7${preventCount} \u2014 \u9632\u79D2\u6740\uFF08+${preventCount * 3}\uFF09`));
        score += preventCount * 3;
      }
      const chargeWithVoodoo = deployed.find((m) => m.monsterId === 106 && m.badgeIds.includes(32));
      if (chargeWithVoodoo) {
        details.push(this.detail("\u51B2\u950B+\u5DEB\u6BD2 \u2014 10s\u7A33\u5B9A\u627F\u4F24\uFF08+8\uFF09"));
        score += 8;
      }
      const formationGuard = deployed.filter((m) => m.badgeIds.includes(12));
      if (formationGuard.length > 0) {
        details.push(this.detail(`\u7ED3\u9635\u5B88\xD7${formationGuard.length} \u2014 \u7FA4\u4F53\u9632\u62A4\uFF08+${formationGuard.length * 4}\uFF09`));
        score += formationGuard.length * 4;
      }
      return score;
    }
    // ================================================================
    // 5. 敌方威胁
    // ================================================================
    evaluateThreatResponse(deployed, enemyDeployed, enemyIds, details) {
      let score = 0;
      if (enemyDeployed.length === 0) return score;
      if (enemyIds.includes(102)) {
        const backline = deployed.filter((m) => m.position.y >= 2);
        if (backline.length > 0) {
          const xSet = new Set(backline.map((m) => m.position.x));
          if (xSet.size >= backline.length * 0.8) {
            details.push(this.detail("\u540E\u6392\u5206\u6563 \u2014 \u6297\u796D\u7940AOE\uFF08+5\uFF09"));
            score += 5;
          } else if (xSet.size <= 2 && backline.length >= 3) {
            details.push(this.detail("\u26A0 \u540E\u6392\u96C6\u4E2D \u2014 \u796D\u7940AOE\u5A01\u80C1\u4E25\u91CD\uFF08-9\uFF09"));
            score -= 9;
          }
        }
      }
      if (enemyIds.includes(106)) {
        const frontline = deployed.filter((m) => m.position.y <= 1);
        if (frontline.length <= 1) {
          details.push(this.detail("\u26A0 \u524D\u6392\u5355\u8584 \u2014 \u51B2\u950B\u53EF\u8F7B\u677E\u7A81\u7834\uFF08-8\uFF09"));
          score -= 8;
        } else if (frontline.length < 3 && deployed.length >= 5) {
          details.push(this.detail("\u26A0 \u524D\u6392\u504F\u5C11 \u2014 \u51B2\u950B\u7A81\u7834\u98CE\u9669\uFF08-3\uFF09"));
          score -= 3;
        }
      }
      if (enemyIds.includes(113) || enemyIds.includes(124)) {
        const clustered = this.countClusters(deployed);
        if (clustered >= 2) {
          details.push(this.detail(`\u26A0 ${clustered}\u5904\u5BC6\u96C6\u6392\u5217 \u2014 \u654C\u65B9AOE\u5A01\u80C1\u9AD8\uFF08-6\uFF09`));
          score -= 6;
        }
      }
      if (enemyIds.includes(106) && enemyIds.includes(116) && enemyIds.includes(107)) {
        details.push(this.detail("\u26A0 \u654C\u65B9\u5168\u51B2\u9635 \u2014 \u7206\u53D1\u5A01\u80C1\u6781\u9AD8\uFF0C\u9700\u8981\u524D\u6392\u786C\u5EA6\uFF08-5\uFF09"));
        score -= 5;
        if (deployed.some((m) => m.monsterId === 103) && deployed.some((m) => m.monsterId === 105)) {
          details.push(this.detail("  \u4F46\u6709\u7977\u5F92\u9635\u652F\u6491 \u2014 \u53EF\u6297\u5168\u51B2\uFF08+8\uFF09"));
          score += 8;
        }
      }
      return score;
    }
    // ================================================================
    // 6. 阵型韧性
    // ================================================================
    evaluateFormationResilience(deployed, enemyIds, details) {
      let score = 0;
      if (deployed.length < 2) return score;
      const frontCount = deployed.filter((m) => m.position.y <= 1).length;
      const midCount = deployed.filter((m) => m.position.y === 2 || m.position.y === 3).length;
      if (frontCount >= 2 && midCount >= 2) {
        details.push(this.detail("\u524D\u63922+\u4E2D\u63922+ \u2014 \u63A5\u529B\u97E7\u6027\u597D\uFF08+4\uFF09"));
        score += 4;
      } else if (frontCount === 1 && midCount >= 2 && deployed.length >= 4) {
        details.push(this.detail("\u26A0 \u4EC51\u53EA\u524D\u6392 \u2014 \u5D29\u76D8\u98CE\u9669\uFF08-4\uFF09"));
        score -= 4;
      }
      const hasHealing = deployed.some(
        (m) => m.badgeIds.includes(17) || // 大厨
        m.monsterId === 112 || // 守卫者之剑
        m.badgeIds.includes(6)
        // 回复光环
      );
      if (hasHealing) {
        details.push(this.detail("\u6709\u56DE\u590D\u624B\u6BB5 \u2014 \u6301\u4E45\u6218\u4F18\u52BF\uFF08+4\uFF09"));
        score += 4;
      }
      return score;
    }
    // ---- 工具 ----
    /** 数出有多少处密集排列（2+只相邻） */
    countClusters(deployed) {
      const positions = deployed.map((m) => m.position);
      let clusters = 0;
      const counted = /* @__PURE__ */ new Set();
      for (let i = 0; i < positions.length; i++) {
        if (counted.has(i)) continue;
        let adjCount = 0;
        for (let j = 0; j < positions.length; j++) {
          if (i === j || counted.has(j)) continue;
          if (Board.getDistance(positions[i], positions[j]) <= 1) {
            adjCount++;
            counted.add(j);
          }
        }
        if (adjCount >= 1) {
          clusters++;
          counted.add(i);
        }
      }
      return clusters;
    }
  };

  // src/ai/evaluators/combo_potential.ts
  var ComboPotentialEvaluator = class extends BaseEvaluator {
    constructor() {
      super(...arguments);
      this.name = "ComboPotential";
      this.weight = 0.35;
    }
    evaluate(state, side) {
      const details = [];
      let score = 40;
      const deployed = state.players[side].deployed;
      const deployedIds = deployed.map((m) => m.monsterId);
      const enemySide = side === "p1" ? "p2" : "p1";
      const enemyIds = state.players[enemySide].deployed.map((m) => m.monsterId);
      if (deployed.length === 0) {
        details.push(this.detail("\u6682\u65E0\u90E8\u7F72\uFF0C\u65E0\u6CD5\u8BC4\u4F30\u7EC4\u5408\u6F5C\u529B"));
        return { score: 40, details };
      }
      if (hasCombo(deployedIds, [103, 105])) {
        details.push(this.detail("\u2705 S\u7EA7: \u7977\u5F92\u6838\u5FC3\uFF08\u5B66\u5F92+\u7948\u7977\uFF09\u2014 \u6700\u5F3A\u673A\u5236\uFF08+30\uFF09"));
        score += 30;
      }
      if (hasCombo(deployedIds, [103, 105, 110, 102])) {
        details.push(this.detail("\u2705 S\u7EA7: \u5B8C\u5907\u7977\u5F92\u9635\uFF08\u7977\u5F92+\u5E1D\u56FD\u4E4B\u76FE+\u796D\u7940\uFF09\u2014 \u63A5\u8FD1\u65E0\u89E3\uFF08+40\uFF09"));
        score += 40;
      }
      if (hasCombo(deployedIds, [107, 116])) {
        details.push(this.detail("\u2705 S\u7EA7: \u5168\u51B2\u6838\u5FC3\uFF08\u5492\u6CD5+\u94BB\u5934\uFF09\u2014 \u514B\u5236\u7977\u5F92\uFF08+20\uFF09"));
        score += 20;
      }
      if (hasCombo(deployedIds, [107, 116, 114, 117])) {
        details.push(this.detail("\u2705 S\u7EA7: \u5B8C\u5907\u5168\u51B2\u9635\uFF08\u5492\u6CD5+\u94BB\u5934+\u7A81\u7A81\u7A81+\u94C1\u7532\u7334\uFF09\uFF08+30\uFF09"));
        score += 30;
      }
      if (hasCombo(deployedIds, [103, 105]) && deployedIds.includes(102)) {
        details.push(this.detail("\u2705 A\u7EA7: \u796D\u7940+\u7977\u5F92 \u2014 AOE\u540E\u6392+\u4E0D\u6B7B\u524D\u6392\uFF08+15\uFF09"));
        score += 15;
      }
      if (hasCombo(deployedIds, [109, 122])) {
        details.push(this.detail("\u2705 A\u7EA7: \u94F6\u72D9\u793C\u7269\u6D41\uFF08+12\uFF09"));
        score += 12;
      }
      const silverSniper = deployed.find((m) => m.monsterId === 109);
      if (silverSniper && silverSniper.badgeIds.includes(33)) {
        details.push(this.detail("\u2705 A\u7EA7: \u94F6\u72D9+\u793C\u7269\u5FBD\u7AE0 \u2014 \u9AD8\u4EF7\u503C\u7EE7\u627F\uFF08+10\uFF09"));
        score += 10;
      }
      const drill = deployed.find((m) => m.monsterId === 116);
      if (drill && drill.badgeIds.includes(5)) {
        details.push(this.detail("\u2705 A\u7EA7: \u94BB\u5934+\u52A9\u8DD1 \u2014 \u5F00\u5C40\u4FDD\u4E0D\u8F93\uFF08+10\uFF09"));
        score += 10;
      }
      if (deployedIds.includes(124)) {
        if (hasCombo(enemyIds, [103, 105])) {
          details.push(this.detail("\u2705 A\u7EA7: \u4E09\u632F\u738B\u514B\u5236\u654C\u65B9\u7977\u5F92 \u2014 \u5BD2\u51B7\u51CF\u653B\u901F\uFF08+12\uFF09"));
          score += 12;
        } else {
          details.push(this.detail("\u4E09\u632F\u738B\u5728\u573A \u2014 \u4E07\u91D1\u6CB9\u63A7\u5236\uFF08+5\uFF09"));
          score += 5;
        }
      }
      if (deployedIds.includes(104)) {
        details.push(this.detail("\u6563\u5F39\u5728\u573A \u2014 \u7834\u76FE\u5229\u5668\uFF08+5\uFF09"));
        const enemyHasShield = enemyIds.some(
          (id) => hasTag(id, "tank") || enemyIds.includes(110)
        );
        if (enemyHasShield) {
          details.push(this.detail("  \u6563\u5F39\u5BF9\u654C\u65B9\u76FE\u6D41\u6709\u514B\u5236\u4F5C\u7528\uFF08+8\uFF09"));
          score += 8;
        }
      }
      if (hasCombo(deployedIds, [103, 105]) && deployedIds.includes(112)) {
        details.push(this.detail("\u5B88\u536B\u8005\u4E4B\u5251\u5728\u7977\u5F92\u9635\u4E2D \u2014 \u7B2C\u4E8C\u56DE\u590D\u6838\u5FC3\uFF08+8\uFF09"));
        score += 8;
      }
      const adjacencyBadges = [12, 13, 16, 29];
      let adjacencyBonus = 0;
      for (const m of deployed) {
        const hasAdjBadge = m.badgeIds.some((bid) => adjacencyBadges.includes(bid));
        if (!hasAdjBadge) continue;
        const adjacent = Board.getAdjacent(m.position.x, m.position.y);
        const hasFriend = adjacent.some((cell) => {
          const occupant = state.board[cell.y][cell.x];
          return occupant && occupant.owner === side;
        });
        if (hasFriend) {
          const badgeNames = m.badgeIds.filter((bid) => adjacencyBadges.includes(bid)).map((bid) => getBadge(bid)?.name ?? "").join("/");
          adjacencyBonus += 3;
          details.push(this.detail(`\u76F8\u90BB\u5FBD\u7AE0\u89E6\u53D1: ${getMonster(m.monsterId)?.name}(${badgeNames})`));
        }
      }
      if (adjacencyBonus > 0) {
        score += Math.min(adjacencyBonus, 10);
      }
      let soloCount = 0;
      for (const m of deployed) {
        const hasSoloBadge = m.badgeIds.some((bid) => [14, 15].includes(bid));
        if (!hasSoloBadge) continue;
        const adjacent = Board.getAdjacent(m.position.x, m.position.y);
        const hasFriend = adjacent.some((cell) => {
          const occupant = state.board[cell.y][cell.x];
          return occupant && occupant.owner === side;
        });
        if (!hasFriend) {
          soloCount++;
        }
      }
      if (soloCount > 0) {
        details.push(this.detail(`\u72EC\u72FC\u5FBD\u7AE0\u89E6\u53D1: ${soloCount}\u53EA\u5B64\u7ACB\u5355\u4F4D\uFF08+${soloCount * 3}\uFF09`));
        score += soloCount * 3;
      }
      const healAuraMonsters = deployed.filter((m) => m.badgeIds.includes(6));
      const healers = deployed.filter((m) => hasTag(m.monsterId, "healer"));
      if (healAuraMonsters.length > 0 && healers.length > 0) {
        details.push(this.detail("\u56DE\u590D\u5149\u73AF+\u6CBB\u7597\u8005 \u2014 \u6CBB\u7597\u91CF\u53E0\u52A0\uFF08+5\uFF09"));
        score += 5;
      }
      if (deployedIds.includes(121)) {
        details.push(this.detail("\u26D4 \u50E7\u7334(121) \u2014 \u81EA\u6B8B\u673A\u5236\uFF0C\u7248\u672C\u57AB\u5E95\uFF08-10\uFF09"));
        score -= 10;
      }
      if (deployedIds.includes(120) && !deployedIds.includes(102)) {
        details.push(this.detail("\u26A0 \u91D1\u7334(120)\u662F\u65E0\u552F\u4E004\u8D39\u540E\u6392 \u2014 \u5355\u4F53\u88AB\u5DEB\u6BD2\u514B\u5236\uFF08-8\uFF09"));
        score -= 8;
      }
      const shovel = deployed.find((m) => m.monsterId === 115);
      if (shovel) {
        const atkBadges = shovel.badgeIds.filter(
          (bid) => badgeHasTag(bid, "damage_amp") || badgeHasTag(bid, "atk_buff")
        );
        if (atkBadges.length > 0) {
          details.push(this.detail("\u26A0 \u94F2\u571F\u4EBA\u5E26\u653B\u51FB\u5FBD\u7AE0 \u2014 \u5766\u514B\u4E0D\u52A1\u6B63\u4E1A\uFF08-5\uFF09"));
          score -= 5;
        }
      }
      const raceCounts = /* @__PURE__ */ new Map();
      for (const m of deployed) {
        const monster = getMonster(m.monsterId);
        if (monster) {
          raceCounts.set(monster.race, (raceCounts.get(monster.race) ?? 0) + 1);
        }
      }
      for (const [race, count] of raceCounts) {
        if (count >= 3) {
          details.push(this.detail(`\u540C\u79CD\u65CF: ${race}\xD7${count}\uFF08+${Math.min(count, 5)}\uFF09`));
          score += Math.min(count, 5);
        }
      }
      return { score: this.clamp(score), details };
    }
  };

  // src/ai/evaluators/positioning_value.ts
  function classifyRole(monsterId) {
    const tags = getMonsterTags(monsterId).strategyTags;
    if (tags.includes("tank") || tags.includes("protector")) return "tank";
    if (tags.includes("brawler") || tags.includes("initiator") || tags.includes("diver") || tags.includes("disruptor") || tags.includes("assassin")) return "frontline_dps";
    if (tags.includes("backline") || tags.includes("glass_cannon") || tags.includes("caster") || tags.includes("sniper") || tags.includes("siege")) return "backline_dps";
    if (tags.includes("healer") || tags.includes("support") || tags.includes("sustain")) return "support";
    return "utility";
  }
  function recommendedY(monsterId) {
    const role = classifyRole(monsterId);
    switch (monsterId) {
      // 坦克
      case 110:
        return { min: 0, max: 1, ideal: 0 };
      // 帝国之盾 — 最前排
      case 111:
        return { min: 0, max: 2, ideal: 1 };
      // 肃清
      case 125:
        return { min: 0, max: 2, ideal: 0 };
      // 战壕
      case 115:
        return { min: 0, max: 2, ideal: 1 };
      // 铲土人
      case 120:
        return { min: 2, max: 4, ideal: 3 };
      // 金面猴王
      // 祷徒体系
      case 103:
        return { min: 0, max: 2, ideal: 1 };
      // 学徒 — 近前排（血量共享需要连线）
      case 105:
        return { min: 0, max: 2, ideal: 1 };
      // 祈祷 — 近前排（大厨厚皮生存）
      case 112:
        return { min: 1, max: 3, ideal: 2 };
      // 守卫者之剑 — 中排接力
      // 冲锋/突进
      case 106:
        return { min: 0, max: 1, ideal: 0 };
      // 冲锋 — 最前排扰乱
      case 116:
        return { min: 0, max: 3, ideal: 0 };
      // 钻头 — y=0开局/ y=3速溶
      case 117:
        return { min: 0, max: 2, ideal: 0 };
      // 铁甲猴 — 前压控制
      // 核心输出
      case 102:
        return { min: 2, max: 4, ideal: 2 };
      // 祭祀 — 中排AOE覆盖
      case 108:
        return { min: 1, max: 3, ideal: 2 };
      // 救星 — 需要跳位+安全
      case 114:
        return { min: 2, max: 4, ideal: 3 };
      // 突突突矿工 — 后排输出
      case 104:
        return { min: 0, max: 2, ideal: 1 };
      // 散弹 — 近距离才有伤害
      case 113:
        return { min: 2, max: 4, ideal: 3 };
      // 矿爆 — 后排AOE
      case 124:
        return { min: 1, max: 3, ideal: 2 };
      // 三振王 — 中排控制
      // 远程脆皮
      case 109:
        return { min: 3, max: 4, ideal: 4 };
      // 银狙 — 最后排
      case 107:
        return { min: 2, max: 4, ideal: 3 };
      // 咒法 — 安全后排
      case 122:
        return { min: 2, max: 4, ideal: 3 };
      // 丛林猴
      case 121:
        return { min: 1, max: 3, ideal: 2 };
      // 僧猴
      // 礼物/辅助
      case 118:
        return { min: 0, max: 2, ideal: 1 };
      // 塞雷 — 前排战士
      case 119:
        return { min: 1, max: 3, ideal: 2 };
      // 见习骑士
      case 123:
        return { min: 0, max: 2, ideal: 1 };
      // 棒球猴 — 前排
      default:
        break;
    }
    switch (role) {
      case "tank":
        return { min: 0, max: 1, ideal: 0 };
      case "frontline_dps":
        return { min: 0, max: 2, ideal: 1 };
      case "backline_dps":
        return { min: 2, max: 4, ideal: 3 };
      case "support":
        return { min: 1, max: 3, ideal: 2 };
      case "utility":
        return { min: 0, max: 4, ideal: 2 };
    }
  }
  var PositioningValueEvaluator = class extends BaseEvaluator {
    constructor() {
      super(...arguments);
      this.name = "PositioningValue";
      this.weight = 0.35;
    }
    // v2: 上调至 35%
    evaluate(state, side) {
      const details = [];
      let score = 50;
      const deployed = state.players[side].deployed;
      const enemySide = side === "p1" ? "p2" : "p1";
      const enemyDeployed = state.players[enemySide].deployed;
      const enemyIds = enemyDeployed.map((m) => m.monsterId);
      if (deployed.length === 0) {
        details.push(this.detail("\u6682\u65E0\u90E8\u7F72"));
        return { score: 50, details };
      }
      score += this.evaluateRolePositioning(deployed, details);
      score += this.evaluateFormationStructure(deployed, side, details);
      score += this.evaluateAdjacencySynergy(deployed, details);
      score += this.evaluateEnemyAwareness(deployed, enemyDeployed, enemyIds, details);
      score += this.evaluateSpacing(deployed, enemyIds, details);
      return { score: this.clamp(score), details };
    }
    // ================================================================
    // 阶段 1: 角色分层
    // ================================================================
    evaluateRolePositioning(deployed, details) {
      let score = 0;
      let okCount = 0;
      let badCount = 0;
      for (const m of deployed) {
        const rec = recommendedY(m.monsterId);
        const y = m.position.y;
        const name = getMonster(m.monsterId)?.name ?? "?";
        if (y < rec.min) {
          const penalty = y === 0 && rec.min <= 1 ? -3 : -8;
          const roleCategory = classifyRole(m.monsterId);
          if (roleCategory === "backline_dps") {
            details.push(this.detail(`\u26D4 ${name}(${roleCategory})\u5728\u6700\u524D\u5217y=${y}\uFF0C\u63A8\u8350y\u2265${rec.min}\uFF08-12\uFF09`));
            score -= 12;
            badCount++;
          } else {
            details.push(this.detail(`\u26A0 ${name}\u8FC7\u4E8E\u9760\u524D y=${y}\uFF0C\u63A8\u8350y\u2265${rec.min}\uFF08${penalty}\uFF09`));
            score += penalty;
            badCount++;
          }
        } else if (y > rec.max) {
          const penalty = y === 4 && rec.max >= 2 ? -3 : -6;
          details.push(this.detail(`\u26A0 ${name}\u8FC7\u4E8E\u9760\u540E y=${y}\uFF0C\u63A8\u8350y\u2264${rec.max}\uFF08${penalty}\uFF09`));
          score += penalty;
          badCount++;
        } else if (y === rec.ideal) {
          details.push(this.detail(`\u2705 ${name}\u5728\u7406\u60F3\u7AD9\u4F4D y=${y}`));
          okCount++;
        } else {
          okCount++;
        }
      }
      if (okCount >= deployed.length * 0.7) {
        score += 8;
        details.push(this.detail(`\u7AD9\u4F4D\u5408\u7406\u7387 ${okCount}/${deployed.length}\uFF08+8\uFF09`));
      } else if (badCount >= 2) {
        score -= 5;
        details.push(this.detail(`\u591A\u53EA\u602A\u517D\u7AD9\u4F4D\u504F\u5DEE\uFF08-5\uFF09`));
      }
      return score;
    }
    // ================================================================
    // 阶段 2: 阵型结构
    // ================================================================
    evaluateFormationStructure(deployed, side, details) {
      let score = 0;
      if (deployed.length < 2) return score;
      const frontRow = deployed.filter((m) => m.position.y <= 1);
      if (frontRow.length >= 4) {
        details.push(this.detail(`\u26A0 \u524D\u6392\u62E5\u6324(${frontRow.length}\u53EA) \u2014 \u6613\u88ABAOE\u56E2\u706D\uFF08-6\uFF09`));
        score -= 6;
      }
      const tanks = deployed.filter((m) => hasTag(m.monsterId, "tank"));
      const tanksInFront = tanks.filter((m) => m.position.y <= 1);
      if (tanks.length > 0 && tanksInFront.length < tanks.length) {
        details.push(this.detail(`\u26A0 ${tanks.length - tanksInFront.length}\u53EA\u5766\u514B\u4E0D\u5728\u524D\u6392\uFF08-5\uFF09`));
        score -= 5;
      }
      const frontlineY0 = deployed.filter((m) => m.position.y === 0);
      if (frontlineY0.length > 0) {
        const y0Squishy = frontlineY0.filter(
          (m) => classifyRole(m.monsterId) === "backline_dps"
        );
        if (y0Squishy.length === frontlineY0.length && deployed.length >= 3) {
          details.push(this.detail(`\u26A0 \u7B2C\u4E00\u6392\u5168\u662F\u8106\u76AE \u2014 \u9632\u7EBF\u7A7A\u865A\uFF08-8\uFF09`));
          score -= 8;
        }
      }
      const ranged = deployed.filter((m) => {
        const data = getMonster(m.monsterId);
        return data?.type === "ranged";
      });
      if (ranged.length > 0) {
        const rangedInBack = ranged.filter((m) => m.position.y >= 2);
        const ratio = rangedInBack.length / ranged.length;
        if (ratio >= 0.8) {
          details.push(this.detail(`\u8FDC\u7A0B${rangedInBack.length}/${ranged.length}\u5728\u540E\u6392 \u2014 \u5C04\u7A0B\u5229\u7528\u597D\uFF08+5\uFF09`));
          score += 5;
        } else if (ratio < 0.5) {
          details.push(this.detail(`\u26A0 \u8FDC\u7A0B\u591A\u6570\u5728\u524D\u6392 \u2014 \u5C04\u7A0B\u672A\u5229\u7528\uFF08-6\uFF09`));
          score -= 6;
        }
      }
      return score;
    }
    // ================================================================
    // 阶段 3: 相邻协同
    // ================================================================
    evaluateAdjacencySynergy(deployed, details) {
      let score = 0;
      if (deployed.length < 2) return score;
      const apprentice = deployed.find((m) => m.monsterId === 103);
      const prayer = deployed.find((m) => m.monsterId === 105);
      if (apprentice && prayer) {
        const dist = Board.getDistance(apprentice.position, prayer.position);
        if (dist <= 1) {
          details.push(this.detail("\u2705 \u5B66\u5F92\u4E0E\u7948\u7977\u76F8\u90BB \u2014 \u7977\u5F92\u534F\u540C\u6700\u5927\u5316\uFF08+8\uFF09"));
          score += 8;
        } else if (dist <= 2) {
          details.push(this.detail("  \u5B66\u5F92\u4E0E\u7948\u7977\u8DDD\u79BB2\u683C \u2014 \u534F\u540C\u826F\u597D\uFF08+3\uFF09"));
          score += 3;
        } else {
          details.push(this.detail("\u26A0 \u5B66\u5F92\u4E0E\u7948\u7977\u8DDD\u79BB\u8FC7\u8FDC \u2014 \u7977\u5F92\u534F\u540C\u53D7\u9650\uFF08-5\uFF09"));
          score -= 5;
        }
      }
      const coreIds = [102, 108, 109, 114, 113, 107, 124];
      const coreUnits = deployed.filter((m) => coreIds.includes(m.monsterId) && m.position.y >= 2);
      const tankUnits = deployed.filter(
        (m) => hasTag(m.monsterId, "tank") || hasTag(m.monsterId, "brawler")
      );
      if (coreUnits.length > 0 && tankUnits.length > 0) {
        let protectedCount = 0;
        for (const core of coreUnits) {
          const hasCover = tankUnits.some(
            (t) => t.position.y < core.position.y && Math.abs(t.position.x - core.position.x) <= 2
          );
          if (hasCover) protectedCount++;
        }
        if (protectedCount >= coreUnits.length * 0.7) {
          details.push(this.detail(`\u6838\u5FC3\u8F93\u51FA${protectedCount}/${coreUnits.length}\u53D7\u5766\u514B\u63A9\u62A4\uFF08+6\uFF09`));
          score += 6;
        } else if (protectedCount === 0 && coreUnits.length >= 2) {
          details.push(this.detail(`\u26A0 \u6838\u5FC3\u8F93\u51FA\u5747\u65E0\u5766\u514B\u63A9\u62A4 \u2014 \u66B4\u9732\u98CE\u9669\uFF08-7\uFF09`));
          score -= 7;
        }
      }
      const sword = deployed.find((m) => m.monsterId === 112);
      if (sword && apprentice && prayer) {
        const distToAppr = Board.getDistance(sword.position, apprentice.position);
        const distToPray = Board.getDistance(sword.position, prayer.position);
        if (distToAppr <= 2 && distToPray <= 2) {
          details.push(this.detail("\u5B88\u536B\u8005\u4E4B\u5251\u9760\u8FD1\u7977\u5F92 \u2014 \u63A5\u529B\u4F4D\u826F\u597D\uFF08+4\uFF09"));
          score += 4;
        }
      }
      return score;
    }
    // ================================================================
    // 阶段 4: 敌方感知
    // ================================================================
    evaluateEnemyAwareness(deployed, enemyDeployed, enemyIds, details) {
      let score = 0;
      if (enemyDeployed.length === 0) return score;
      if (enemyIds.includes(102)) {
        const backline = deployed.filter((m) => m.position.y >= 2);
        if (backline.length >= 2) {
          const xCoords = backline.map((m) => m.position.x);
          const uniqueX = new Set(xCoords);
          if (uniqueX.size === backline.length) {
            details.push(this.detail("\u2705 \u540E\u6392x\u5750\u6807\u5168\u5206\u6563 \u2014 \u514B\u5236\u654C\u65B9\u796D\u7940AOE\uFF08+8\uFF09"));
            score += 8;
          } else if (uniqueX.size >= backline.length * 0.7) {
            details.push(this.detail("\u540E\u6392\u57FA\u672C\u5206\u6563 \u2014 \u6297\u796D\u7940AOE\uFF08+3\uFF09"));
            score += 3;
          } else {
            details.push(this.detail("\u26A0 \u540E\u6392x\u5750\u6807\u96C6\u4E2D \u2014 \u53D7\u654C\u65B9\u796D\u7940AOE\u5A01\u80C1\uFF08-10\uFF09"));
            score -= 10;
          }
        }
      }
      if (enemyIds.includes(106)) {
        const frontline = deployed.filter((m) => m.position.y <= 1);
        if (frontline.length <= 1) {
          details.push(this.detail("\u26A0 \u524D\u6392\u5355\u8584(\u22641) \u2014 \u51B2\u950B\u6613\u7A81\u7834\uFF08-7\uFF09"));
          score -= 7;
        } else if (frontline.length >= 3) {
          details.push(this.detail("\u524D\u6392\u7A33\u56FA(\u22653) \u2014 \u514B\u5236\u51B2\u950B\uFF08+5\uFF09"));
          score += 5;
        }
      }
      if (enemyIds.includes(116)) {
        const drill = enemyDeployed.find((m) => m.monsterId === 116);
        if (drill) {
          const threatened = deployed.filter(
            (m) => m.position.y >= 2 && Math.abs(m.position.x - drill.position.x) <= 1
          );
          if (threatened.length >= 2) {
            details.push(this.detail(`\u26A0 ${threatened.length}\u53EA\u540E\u6392\u4E0E\u94BB\u5934\u540C\u5217 \u2014 \u901F\u6EB6\u98CE\u9669\uFF08-8\uFF09`));
            score -= 8;
          }
        }
      }
      if (enemyIds.includes(117)) {
        const ourFront = deployed.filter((m) => m.position.y <= 1);
        if (ourFront.length >= 2) {
          details.push(this.detail("\u524D\u6392\u5145\u8DB3 \u2014 \u53EF\u5E94\u5BF9\u94C1\u7532\u7334\u524D\u538B\uFF08+3\uFF09"));
          score += 3;
        }
      }
      if (enemyIds.includes(124)) {
        const yuan = enemyDeployed.find((m) => m.monsterId === 124);
        if (yuan) {
          const chilled = deployed.filter((m) => {
            if (!coreDpsIds.has(m.monsterId)) return false;
            return Board.getDistance(m.position, yuan.position) <= 2;
          });
          if (chilled.length > 0) {
            const names = chilled.map((m) => getMonster(m.monsterId)?.name);
            details.push(this.detail(`\u26A0 ${names.join(",")}\u5728\u96EA\u733F\u5BD2\u51B7\u8303\u56F4\u5185 \u2014 \u653B\u901F-35%\uFF08-6\uFF09`));
            score -= 6;
          }
        }
      }
      return score;
    }
    // ================================================================
    // 阶段 5: 间距与防AOE
    // ================================================================
    evaluateSpacing(deployed, enemyIds, details) {
      let score = 0;
      if (deployed.length < 3) return score;
      const positions = deployed.map((m) => m.position);
      let totalClumpPenalty = 0;
      const clumpedUnits = /* @__PURE__ */ new Set();
      for (let i = 0; i < positions.length; i++) {
        let adjCount = 0;
        for (let j = 0; j < positions.length; j++) {
          if (i === j) continue;
          if (Board.getDistance(positions[i], positions[j]) <= 1) {
            adjCount++;
          }
        }
        if (adjCount >= 3) {
          clumpedUnits.add(i);
          totalClumpPenalty += 5;
        }
      }
      if (clumpedUnits.size > 0 && (enemyIds.includes(102) || enemyIds.includes(113))) {
        totalClumpPenalty *= 2;
        details.push(this.detail(`\u26D4 ${clumpedUnits.size}\u53EA\u8FC7\u5BC6 + \u654C\u65B9\u6709AOE \u2014 \u4E25\u91CD\u98CE\u9669\uFF08-${totalClumpPenalty}\uFF09`));
      } else if (clumpedUnits.size > 0) {
        details.push(this.detail(`\u26A0 ${clumpedUnits.size}\u53EA\u602A\u517D\u8FC7\u5EA6\u5BC6\u96C6\uFF08-${totalClumpPenalty}\uFF09`));
      }
      score -= totalClumpPenalty;
      if (deployed.length >= 4 && clumpedUnits.size === 0) {
        const xCoords = deployed.map((m) => m.position.x);
        const xSpread = Math.max(...xCoords) - Math.min(...xCoords);
        if (xSpread >= 3) {
          details.push(this.detail("\u9635\u578B\u6A2A\u5411\u5C55\u5F00\u826F\u597D \u2014 \u6297AOE\uFF08+4\uFF09"));
          score += 4;
        }
      }
      return score;
    }
  };
  var coreDpsIds = /* @__PURE__ */ new Set([102, 108, 109, 114, 113, 107, 124, 104]);

  // src/ai/layout_system.ts
  var LayoutSystem = class {
    constructor(enabled = false) {
      this._enabled = enabled;
    }
    get enabled() {
      return this._enabled;
    }
    enable() {
      this._enabled = true;
    }
    disable() {
      this._enabled = false;
    }
    /**
     * 评估一次放置行动的布局质量
     * @param state  当前游戏状态（含已部署怪兽）
     * @param side   当前决策方
     * @param action 待评估的放置行动
     */
    evaluatePlacement(state, side, action) {
      const reasons = [];
      let totalAdjust = 0;
      const enemySide = side === "p1" ? "p2" : "p1";
      const adjA = this.evalFrontBack(action, reasons);
      totalAdjust += adjA;
      const adjB = this.evalPrayerProximity(state, side, action, reasons);
      totalAdjust += adjB;
      const adjC = this.evalStraightLine(state, enemySide, action, reasons);
      totalAdjust += adjC;
      const adjD = this.evalIronMonkeyThrow(state, side, action, reasons);
      totalAdjust += adjD;
      const adjE = this.evalIronMonkeyCounter(state, enemySide, action, reasons);
      totalAdjust += adjE;
      const adjF = this.evalSpellCounter(state, enemySide, action, reasons);
      totalAdjust += adjF;
      const adjG = this.evalChargeMirror(state, enemySide, action, reasons);
      totalAdjust += adjG;
      return { totalAdjust, reasons };
    }
    // ================================================================
    // 规则 A: 前排坦 / 后排射
    // ================================================================
    evalFrontBack(action, reasons) {
      const isTank = hasTag(action.monsterId, "tank") || hasTag(action.monsterId, "brawler");
      const isSquishy = hasTag(action.monsterId, "backline") || hasTag(action.monsterId, "glass_cannon") || hasTag(action.monsterId, "squishy");
      if (isTank && action.y > 1) {
        reasons.push(`[\u5E03\u5C40] \u5766\u514B\u5E94\u5728\u524D\u6392 y\u22641\uFF0C\u5F53\u524D y=${action.y}\uFF08-15\uFF09`);
        return -15;
      }
      if (isSquishy && action.y < 2) {
        reasons.push(`[\u5E03\u5C40] \u8106\u76AE/\u540E\u6392\u5E94\u5728\u540E\u6392 y\u22652\uFF0C\u5F53\u524D y=${action.y}\uFF08-15\uFF09`);
        return -15;
      }
      return 0;
    }
    // ================================================================
    // 规则 B: 祈祷相邻
    // ================================================================
    evalPrayerProximity(state, side, action, reasons) {
      if (action.monsterId === 105) return 0;
      const prayer = state.players[side].deployed.find((m) => m.monsterId === 105);
      if (!prayer) return 0;
      const actionPos = { x: action.x, y: action.y };
      const dist = Board.getDistance(actionPos, prayer.position);
      const hasApprentice = state.players[side].deployed.some((m) => m.monsterId === 103);
      if (dist <= 2) {
        reasons.push(`[\u5E03\u5C40] \u5728\u7948\u7977\u56DE\u8840\u8303\u56F4\u5185\uFF08\u8DDD\u79BB${dist}\uFF09\uFF08+8\uFF09`);
        return 8;
      }
      if (hasApprentice) {
        reasons.push(`[\u5E03\u5C40] \u8FDC\u79BB\u7948\u7977\u56DE\u8840\u8303\u56F4\uFF08\u8DDD\u79BB${dist}>2\uFF09\uFF0C\u7977\u5F92\u9635\u534F\u540C\u4E0B\u964D\uFF08-5\uFF09`);
        return -5;
      }
      return 0;
    }
    // ================================================================
    // 规则 C: 突突(114) / 咒法(107) 正前方行
    // ================================================================
    evalStraightLine(state, enemySide, action, reasons) {
      if (action.monsterId !== 114 && action.monsterId !== 107) return 0;
      const enemyRows = new Set(
        state.players[enemySide].deployed.map((m) => m.position.y)
      );
      if (enemyRows.size === 0) return 0;
      if (enemyRows.has(action.y)) {
        const monsterName = action.monsterId === 114 ? "\u7A81\u7A81\u7A81\u77FF\u5DE5" : "\u5492\u6CD5";
        reasons.push(`[\u5E03\u5C40] ${monsterName}\u653E\u7F6E\u5728\u654C\u4EBA\u6240\u5728\u884C y=${action.y}\uFF08+10\uFF09`);
        return 10;
      }
      return 0;
    }
    // ================================================================
    // 规则 D: 铁甲投掷保护
    // ================================================================
    evalIronMonkeyThrow(state, side, action, reasons) {
      const PROTECTED_BADGES = [11, 28, 30];
      const hasAllThree = (m) => PROTECTED_BADGES.every((b) => m.badgeIds.includes(b));
      const protectedMonsters = state.players[side].deployed.filter(hasAllThree);
      const placingMonster = PROTECTED_BADGES.every((b) => action.badgeIds.includes(b)) ? { position: { x: action.x, y: action.y } } : null;
      const ironMonkey = state.players[side].deployed.find((m) => m.monsterId === 117);
      const placingIronMonkey = action.monsterId === 117;
      if (ironMonkey && placingMonster) {
        const expectedY = ironMonkey.position.y + 1;
        if (placingMonster.position.y !== expectedY || placingMonster.position.x !== ironMonkey.position.x) {
          reasons.push(`[\u5E03\u5C40] \u94C1\u7532\u6295\u63B7\u4FDD\u62A4\uFF1A\u53D7\u4FDD\u62A4\u602A\u517D\u5E94\u5728\u94C1\u7532(${ironMonkey.position.x},${ironMonkey.position.y})\u540E\u4E00\u683C\uFF08-20\uFF09`);
          return -20;
        }
        reasons.push(`[\u5E03\u5C40] \u94C1\u7532\u6295\u63B7\u4FDD\u62A4\u6B63\u786E\uFF1A\u53D7\u4FDD\u62A4\u602A\u517D\u5728\u94C1\u7532\u540E\u4E00\u683C\uFF08+10\uFF09`);
        return 10;
      }
      if ((protectedMonsters.length > 0 || placingMonster) && placingIronMonkey) {
        const target = placingMonster ?? protectedMonsters[0];
        if (!target) return 0;
        const expectedX = target.position.x;
        const expectedY = target.position.y - 1;
        if (action.x !== expectedX || action.y !== expectedY) {
          reasons.push(`[\u5E03\u5C40] \u94C1\u7532\u5E94\u5728\u53D7\u4FDD\u62A4\u602A\u517D(${target.position.x},${target.position.y})\u524D\u4E00\u683C\uFF08-20\uFF09`);
          return -20;
        }
        reasons.push(`[\u5E03\u5C40] \u94C1\u7532\u6B63\u786E\u653E\u7F6E\u5728\u53D7\u4FDD\u62A4\u602A\u517D\u524D\u65B9\uFF08+10\uFF09`);
        return 10;
      }
      if (ironMonkey && protectedMonsters.length > 0) {
        const prot = protectedMonsters[0];
        const isCorrect = prot.position.x === ironMonkey.position.x && prot.position.y === ironMonkey.position.y + 1;
        if (!isCorrect) {
          reasons.push(`[\u5E03\u5C40] \u94C1\u7532\u4E0E\u53D7\u4FDD\u62A4\u602A\u517D\u672A\u6B63\u786E\u5BF9\u9F50\uFF08\u94C1\u7532\u5E94\u5728\u540Cx\u5217\u3001\u7D27\u90BB\u524D\u65B9\uFF09\uFF08-10\uFF09`);
          return -10;
        }
      }
      return 0;
    }
    // ================================================================
    // 规则 E: 铁甲反制 → 冲锋
    // ================================================================
    evalIronMonkeyCounter(state, enemySide, action, reasons) {
      if (action.monsterId !== 106) return 0;
      const enemyMonkey = state.players[enemySide].deployed.find((m) => m.monsterId === 117);
      if (!enemyMonkey) return 0;
      const monkeyBack = state.players[enemySide].deployed.find(
        (m) => m.position.x === enemyMonkey.position.x && m.position.y === enemyMonkey.position.y + 1
      );
      if (!monkeyBack) return 0;
      if (action.y === enemyMonkey.position.y) {
        reasons.push(`[\u53CD\u5236] \u654C\u65B9\u94C1\u7532(${enemyMonkey.position.x},${enemyMonkey.position.y})\u540E\u6709\u602A\u517D\uFF0C\u51B2\u950B\u540Cy\u884C\u53CD\u5236\uFF08+15\uFF09`);
        return 15;
      }
      return 0;
    }
    // ================================================================
    // 规则 F: 咒法反制 → 钻头
    // ================================================================
    evalSpellCounter(state, enemySide, action, reasons) {
      if (action.monsterId !== 116) return 0;
      const enemySpell = state.players[enemySide].deployed.find((m) => m.monsterId === 107);
      if (!enemySpell) return 0;
      const targetX = enemySpell.position.x + 6;
      const targetY = enemySpell.position.y;
      if (action.x === targetX && action.y === targetY) {
        reasons.push(`[\u53CD\u5236] \u94BB\u5934\u5728\u5492\u6CD5(${enemySpell.position.x},${enemySpell.position.y})\u7684 x+6 \u53CD\u5236\u4F4D\uFF08+15\uFF09`);
        return 15;
      }
      return 0;
    }
    // ================================================================
    // 规则 G: 冲锋镜像反制
    // ================================================================
    evalChargeMirror(state, enemySide, action, reasons) {
      if (action.monsterId !== 106) return 0;
      const enemyCharge = state.players[enemySide].deployed.find(
        (m) => m.monsterId === 106 && m.badgeIds.includes(32) && m.badgeIds.includes(24)
      );
      if (!enemyCharge) return 0;
      if (action.y === enemyCharge.position.y) {
        reasons.push(`[\u53CD\u5236] \u654C\u65B9\u51B2\u950B(\u5DEB\u6BD2\u70B8\u5F39)\u540Cy\u884C\u955C\u50CF\u53CD\u5236\uFF08+12\uFF09`);
        return 12;
      }
      return 0;
    }
  };

  // src/ai/strategy/formation_library.ts
  var \u6CC9\u6C34\u5251 = {
    id: "springsword",
    name: "\u6CC9\u6C34\u5251",
    archetype: "prayer",
    signatureCards: [110, 103, 105, 102],
    hasFourCost: true,
    fourCostName: "\u796D\u7940",
    team: [
      { monsterId: 110, badgeIds: [23, 8] },
      { monsterId: 105, badgeIds: [8, 17] },
      { monsterId: 103, badgeIds: [8, 18] },
      { monsterId: 112, badgeIds: [8, 6] },
      { monsterId: 102, badgeIds: [3, 22, 21] },
      { monsterId: 104, badgeIds: [8, 4] },
      { monsterId: 106, badgeIds: [32, 24] },
      { monsterId: 116, badgeIds: [32, 24] }
    ],
    tree: {
      id: "n1",
      round: 0,
      label: "\u5F00\u5C40",
      comment: "",
      placement: [],
      children: [{
        id: "n2",
        round: 1,
        label: "\u5C401",
        comment: "",
        placement: [
          { monsterId: 110, badgeIds: [23, 8], x: 9, y: 3 },
          { monsterId: 105, badgeIds: [8, 17], x: 10, y: 3 }
        ],
        children: [{
          id: "n3",
          round: 2,
          label: "\u5C402",
          comment: "",
          placement: [
            { monsterId: 102, badgeIds: [3, 22, 21], x: 9, y: 2 }
          ],
          children: [{
            id: "n4",
            round: 3,
            label: "\u5C403",
            comment: "",
            placement: [
              { monsterId: 112, badgeIds: [8, 6], x: 10, y: 4 },
              { monsterId: 103, badgeIds: [8, 12], x: 9, y: 4 }
            ],
            children: [{
              id: "n5",
              round: 4,
              label: "\u5C404",
              comment: "\u7528\u51B2\u950B\u54E5\u53CD\u5236\u51B2\u950B\u54E5\uFF0C\u5BF9\u9876",
              placement: [
                { monsterId: 106, badgeIds: [32, 24], x: 7, y: 3 }
              ],
              children: [{
                id: "n6",
                round: 5,
                label: "\u5C405",
                comment: "",
                placement: [
                  { monsterId: 104, badgeIds: [8, 4], x: 10, y: 2 }
                ],
                children: []
              }]
            }]
          }]
        }]
      }]
    }
  };
  var \u575A\u679C\u6551\u661F = {
    id: "nutsavior",
    name: "\u575A\u679C\u6551\u661F",
    archetype: "half_rush",
    signatureCards: [110, 105, 108],
    hasFourCost: true,
    fourCostName: "\u6551\u661F",
    team: [
      { monsterId: 110, badgeIds: [23, 16] },
      { monsterId: 105, badgeIds: [8, 17] },
      { monsterId: 106, badgeIds: [32, 24] },
      { monsterId: 116, badgeIds: [32, 24] },
      { monsterId: 108, badgeIds: [3, 22, 21] },
      { monsterId: 125, badgeIds: [27, 9] },
      { monsterId: 104, badgeIds: [27, 35] },
      { monsterId: 114, badgeIds: [3, 32] }
    ],
    tree: {
      id: "n7",
      round: 0,
      label: "\u5F00\u5C40",
      comment: "",
      placement: [],
      children: [{
        id: "n8",
        round: 1,
        label: "\u5C401",
        comment: "",
        placement: [
          { monsterId: 110, badgeIds: [23, 16], x: 9, y: 2 },
          { monsterId: 105, badgeIds: [8, 17], x: 10, y: 2 }
        ],
        children: [{
          id: "n9",
          round: 2,
          label: "\u5C402",
          comment: "\u53EF\u4EE5\u653E\u5728\u5E1D\u56FD\u4E0A\u9762\uFF0C\u4E5F\u53EF\u4EE5\u5728\u4E0B\u9762",
          placement: [
            { monsterId: 108, badgeIds: [3, 22, 21], x: 9, y: 1 }
          ],
          children: [
            {
              // 主分支：无三振王
              id: "n10",
              round: 3,
              label: "\u5C403",
              comment: "\u6CA1\u6709\u4E09\u632F\u738B\u5C31\u5148\u4E0A\u51B2\u950B",
              placement: [
                { monsterId: 104, badgeIds: [27, 35], x: 10, y: 3 },
                { monsterId: 106, badgeIds: [32, 24], x: 6, y: 1 }
              ],
              children: [{
                id: "n11",
                round: 4,
                label: "\u5C404",
                comment: "\u7A81\u7A81\u603C\u8138",
                placement: [
                  { monsterId: 114, badgeIds: [3, 32], x: 6, y: 2 }
                ],
                children: [{
                  id: "n12",
                  round: 5,
                  label: "\u5C405",
                  comment: "",
                  placement: [
                    { monsterId: 116, badgeIds: [32, 24], x: 7, y: 2 }
                  ],
                  children: []
                }]
              }]
            },
            {
              // 分支：对方有三振王
              id: "n15",
              round: 3,
              label: "\u5982\u679C\u5BF9\u9762\u6709\u4E09\u632F\u738B",
              comment: "\u6218\u58D5\u514B\u5236\u4E09\u632F\u738B",
              placement: [
                { monsterId: 125, badgeIds: [27, 9], x: 10, y: 1 },
                { monsterId: 104, badgeIds: [27, 35], x: 10, y: 3 }
              ],
              children: [{
                id: "n16",
                round: 4,
                label: "\u5C404",
                comment: "\u4E4B\u540E\u5C31\u4E0A\u51B2\u950B\u548C\u94BB\u5934",
                placement: [
                  { monsterId: 106, badgeIds: [32, 24], x: 6, y: 2 }
                ],
                children: [{
                  id: "n17",
                  round: 5,
                  label: "\u5C405",
                  comment: "",
                  placement: [
                    { monsterId: 116, badgeIds: [32, 24], x: 6, y: 1 }
                  ],
                  children: []
                }]
              }]
            }
          ]
        }]
      }]
    }
  };
  var \u5168\u4E8C\u51B2 = {
    id: "all2rush",
    name: "\u5168\u4E8C\u51B2",
    archetype: "full_rush",
    signatureCards: [110, 107, 113, 116],
    hasFourCost: false,
    team: [
      { monsterId: 110, badgeIds: [23, 30] },
      { monsterId: 117, badgeIds: [8, 3] },
      { monsterId: 107, badgeIds: [20, 1] },
      { monsterId: 113, badgeIds: [3, 20] },
      { monsterId: 114, badgeIds: [3, 32] },
      { monsterId: 116, badgeIds: [3, 5] },
      { monsterId: 106, badgeIds: [32, 24] },
      { monsterId: 104, badgeIds: [3, 4] }
    ],
    tree: {
      id: "n18",
      round: 0,
      label: "\u5F00\u5C40",
      comment: "\u5982\u679C\u5BF9\u65B9\u662F\u76FE\u6D41\uFF0C\u65E9\u70B9\u4E0A\u6563\u5F39",
      placement: [],
      children: [
        {
          // 对方祷徒
          id: "n19",
          round: 1,
          label: "\u5BF9\u65B9\u662F\u7977\u5F92",
          comment: "",
          placement: [
            { monsterId: 110, badgeIds: [23, 30], x: 7, y: 2 },
            { monsterId: 117, badgeIds: [8, 3], x: 6, y: 2 }
          ],
          children: [{
            id: "n20",
            round: 2,
            label: "\u5C402",
            comment: "\u76EE\u6807\u79D2\u6740\u7948\u7977",
            placement: [
              { monsterId: 106, badgeIds: [32, 24], x: 6, y: 3 },
              { monsterId: 113, badgeIds: [3, 20], x: 7, y: 3 }
            ],
            children: [{
              id: "n21",
              round: 3,
              label: "\u5C403",
              comment: "\u5492\u6CD5\u9632\u94BB\u5934\uFF0C\u94BB\u5934\u7784\u51C6\u7948\u7977",
              placement: [
                { monsterId: 116, badgeIds: [3, 5], x: 7, y: 4 },
                { monsterId: 107, badgeIds: [20, 1], x: 8, y: 3 }
              ],
              children: [{
                id: "n22",
                round: 4,
                label: "\u5C404",
                comment: "",
                placement: [
                  { monsterId: 114, badgeIds: [3, 32], x: 9, y: 3 }
                ],
                children: [{
                  id: "n23",
                  round: 5,
                  label: "\u5C405",
                  comment: "",
                  placement: [
                    { monsterId: 104, badgeIds: [3, 4], x: 7, y: 1 }
                  ],
                  children: []
                }]
              }]
            }]
          }]
        },
        {
          // 对方全冲
          id: "n29",
          round: 1,
          label: "\u5BF9\u65B9\u662F\u5168\u51B2",
          comment: "\u5168\u51B2\u7528\u76FE\u94BB\u5F00",
          placement: [
            { monsterId: 110, badgeIds: [23, 30], x: 7, y: 2 },
            { monsterId: 116, badgeIds: [3, 5], x: 6, y: 0 }
          ],
          children: [{
            id: "n30",
            round: 2,
            label: "\u5C402",
            comment: "\u5728\u5E1D\u56FD\u8FB9\u4E0A\u653E\u5C04\u624B",
            placement: [
              { monsterId: 104, badgeIds: [3, 4], x: 7, y: 1 },
              { monsterId: 113, badgeIds: [3, 20], x: 8, y: 2 }
            ],
            children: [{
              id: "n31",
              round: 3,
              label: "\u5C403",
              comment: "\u94C1\u7532\u53EF\u540E\u7F6E\u4E3A\u6218\u58EB",
              placement: [
                { monsterId: 114, badgeIds: [3, 32], x: 9, y: 3 },
                { monsterId: 117, badgeIds: [8, 3], x: 10, y: 1 }
              ],
              children: [{
                id: "n32",
                round: 4,
                label: "\u5C404",
                comment: "\u51B2\u950B\u5438\u5F15\u706B\u529B",
                placement: [
                  { monsterId: 106, badgeIds: [32, 24], x: 6, y: 2 }
                ],
                children: [{
                  id: "n33",
                  round: 5,
                  label: "\u5C405",
                  comment: "\u5492\u6CD5\u8981\u6709\u653B\u51FB\u5BF9\u8C61",
                  placement: [
                    { monsterId: 107, badgeIds: [20, 1], x: 10, y: 2 }
                  ],
                  children: []
                }]
              }]
            }]
          }]
        }
      ]
    }
  };
  var \u7ECF\u5178\u6551\u661F = {
    id: "classicsavior",
    name: "\u7ECF\u5178\u6551\u661F",
    archetype: "full_rush",
    signatureCards: [110, 108, 107, 116, 117],
    hasFourCost: true,
    fourCostName: "\u6551\u661F",
    team: [
      { monsterId: 117, badgeIds: [3, 9] },
      { monsterId: 110, badgeIds: [11, 28] },
      { monsterId: 108, badgeIds: [3, 22, 21] },
      { monsterId: 114, badgeIds: [3, 1] },
      { monsterId: 116, badgeIds: [3, 5] },
      { monsterId: 106, badgeIds: [32, 24] },
      { monsterId: 107, badgeIds: [20, 1] },
      { monsterId: 119, badgeIds: [3, 5] }
    ],
    tree: {
      id: "n34",
      round: 0,
      label: "\u5F00\u5C40",
      comment: "",
      placement: [],
      children: [{
        id: "n35",
        round: 1,
        label: "\u5C401",
        comment: "\u6551\u661F\u5F00\u53EF\u4EE5\u6740\u6B7B\u76FE\u7977",
        placement: [
          { monsterId: 108, badgeIds: [3, 22, 21], x: 9, y: 1 }
        ],
        children: [{
          id: "n36",
          round: 2,
          label: "\u5C402",
          comment: "",
          placement: [
            { monsterId: 117, badgeIds: [3, 9], x: 6, y: 2 },
            { monsterId: 110, badgeIds: [11, 28], x: 7, y: 2 }
          ],
          children: [{
            id: "n37",
            round: 3,
            label: "\u5C403",
            comment: "\u7A81\u7A81\u548C\u5492\u6CD5\u8981\u653E\u5728\u6709\u654C\u4EBA\u7684\u4E00\u884C",
            placement: [
              { monsterId: 114, badgeIds: [3, 1], x: 8, y: 2 },
              { monsterId: 107, badgeIds: [20, 1], x: 9, y: 2 }
            ],
            children: [{
              id: "n38",
              round: 4,
              label: "\u5C404",
              comment: "\u7977\u5F92\u4E0A\u51B2\u950B\uFF0C\u975E\u7977\u5F92\u7528\u5FCD\u7334",
              placement: [
                { monsterId: 106, badgeIds: [32, 24], x: 7, y: 3 }
              ],
              children: [{
                id: "n39",
                round: 5,
                label: "\u5C405",
                comment: "",
                placement: [
                  { monsterId: 116, badgeIds: [3, 5], x: 7, y: 0 }
                ],
                children: []
              }]
            }]
          }]
        }]
      }]
    }
  };
  var \u5168\u4E8C\u6C38\u5E73 = {
    id: "all2prayer",
    name: "\u5168\u4E8C\u6C38\u5E73",
    archetype: "prayer",
    signatureCards: [110, 103, 105, 116],
    hasFourCost: false,
    team: [
      { monsterId: 110, badgeIds: [23, 8] },
      { monsterId: 105, badgeIds: [8, 17] },
      { monsterId: 103, badgeIds: [8, 12] },
      { monsterId: 116, badgeIds: [3, 5] },
      { monsterId: 106, badgeIds: [27, 35] },
      { monsterId: 104, badgeIds: [8, 4] },
      { monsterId: 114, badgeIds: [8, 3] },
      { monsterId: 112, badgeIds: [8, 6] }
    ],
    tree: {
      id: "n54",
      round: 0,
      label: "\u5F00\u5C40",
      comment: "",
      placement: [],
      children: [{
        id: "n55",
        round: 1,
        label: "\u5C401",
        comment: "",
        placement: [
          { monsterId: 110, badgeIds: [23, 8], x: 6, y: 1 },
          { monsterId: 116, badgeIds: [3, 5], x: 8, y: 0 }
        ],
        children: [{
          id: "n56",
          round: 2,
          label: "\u5C402",
          comment: "",
          placement: [
            { monsterId: 103, badgeIds: [8, 12], x: 7, y: 1 },
            { monsterId: 105, badgeIds: [8, 17], x: 8, y: 1 }
          ],
          children: [{
            id: "n57",
            round: 3,
            label: "\u5C403",
            comment: "\u51B2\u950B\u653E\u7948\u7977\u8FB9\u4E0A\uFF08\u63A5\u529B\uFF09",
            placement: [
              { monsterId: 112, badgeIds: [8, 6], x: 7, y: 2 },
              { monsterId: 106, badgeIds: [27, 35], x: 8, y: 2 }
            ],
            children: [{
              id: "n58",
              round: 4,
              label: "\u5C404",
              comment: "",
              placement: [
                { monsterId: 104, badgeIds: [8, 4], x: 7, y: 0 }
              ],
              children: [{
                id: "n59",
                round: 5,
                label: "\u5C405",
                comment: "",
                placement: [
                  { monsterId: 114, badgeIds: [8, 3], x: 9, y: 2 }
                ],
                children: []
              }]
            }]
          }]
        }]
      }]
    }
  };
  var \u8083\u6E05 = {
    id: "suqing",
    name: "\u8083\u6E05",
    archetype: "half_rush",
    signatureCards: [110, 105, 101, 124],
    hasFourCost: true,
    fourCostName: "\u8083\u6E05",
    team: [
      { monsterId: 110, badgeIds: [23, 8] },
      { monsterId: 124, badgeIds: [10, 25] },
      { monsterId: 101, badgeIds: [23, 3, 2] },
      { monsterId: 105, badgeIds: [8, 17] },
      { monsterId: 106, badgeIds: [32, 24] },
      { monsterId: 116, badgeIds: [3, 5] },
      { monsterId: 107, badgeIds: [20, 1] },
      { monsterId: 114, badgeIds: [3, 2] }
    ],
    tree: {
      id: "n40",
      round: 0,
      label: "\u5F00\u5C40",
      comment: "DOF \u7ED3\u5408\u5168\u51B2\u901F\u6218\u901F\u51B3",
      placement: [],
      children: [{
        id: "n41",
        round: 1,
        label: "\u5C401",
        comment: "",
        placement: [
          { monsterId: 110, badgeIds: [23, 8], x: 7, y: 2 },
          { monsterId: 124, badgeIds: [10, 25], x: 8, y: 2 }
        ],
        children: [{
          id: "n42",
          round: 2,
          label: "\u5C402",
          comment: "\u8083\u6E05\u907F\u4F24\uFF1A\u5BF9\u65B9\u4E0A\u534A\u2192\u653E\u4E0B\u534A",
          placement: [
            { monsterId: 101, badgeIds: [23, 3, 2], x: 9, y: 3 }
          ],
          children: [
            {
              // 主分支
              id: "n43",
              round: 3,
              label: "\u5C403",
              comment: "\u65E0\u76FE\u70AE\u65F6\u65E9\u51FA\u51B2\u950B\u9632\u5DEB\u6BD2",
              placement: [
                { monsterId: 106, badgeIds: [32, 24], x: 6, y: 3 },
                { monsterId: 114, badgeIds: [3, 2], x: 8, y: 1 }
              ],
              children: [{
                id: "n44",
                round: 4,
                label: "\u5C404",
                comment: "",
                placement: [
                  { monsterId: 105, badgeIds: [8, 17], x: 9, y: 2 }
                ],
                children: [{
                  id: "n45",
                  round: 5,
                  label: "\u5C405",
                  comment: "",
                  placement: [
                    { monsterId: 107, badgeIds: [20, 1], x: 10, y: 1 }
                  ],
                  children: []
                }]
              }]
            },
            {
              // 对方上钻头
              id: "n48",
              round: 3,
              label: "\u5982\u679C\u5BF9\u65B9\u4E0A\u94BB\u5934",
              comment: "\u4E0A\u7948\u7977\u4FDD\u62A4\u4E09\u632F\u738B",
              placement: [
                { monsterId: 105, badgeIds: [8, 17], x: 9, y: 2 },
                { monsterId: 114, badgeIds: [3, 2], x: 8, y: 1 }
              ],
              children: [{
                id: "n49",
                round: 4,
                label: "\u5C404",
                comment: "",
                placement: [
                  { monsterId: 106, badgeIds: [32, 24], x: 7, y: 3 }
                ],
                children: [{
                  id: "n50",
                  round: 5,
                  label: "\u5C405",
                  comment: "",
                  placement: [
                    { monsterId: 116, badgeIds: [3, 5], x: 9, y: 1 }
                  ],
                  children: []
                }]
              }]
            },
            {
              // 对方祷徒
              id: "n51",
              round: 3,
              label: "\u5982\u679C\u5BF9\u65B9\u662F\u7977\u5F92",
              comment: "\u7528\u7A81\u7A81\u548C\u5492\u6CD5",
              placement: [
                { monsterId: 114, badgeIds: [3, 2], x: 7, y: 3 },
                { monsterId: 107, badgeIds: [20, 1], x: 10, y: 3 }
              ],
              children: [{
                id: "n52",
                round: 4,
                label: "\u5C404",
                comment: "",
                placement: [
                  { monsterId: 116, badgeIds: [3, 5], x: 8, y: 4 }
                ],
                children: [{
                  id: "n53",
                  round: 5,
                  label: "\u5C405",
                  comment: "",
                  placement: [
                    { monsterId: 106, badgeIds: [32, 24], x: 6, y: 3 }
                  ],
                  children: []
                }]
              }]
            }
          ]
        }]
      }]
    }
  };
  var \u68AF\u5B50\u585E\u96F7 = {
    id: "laddersel",
    name: "\u68AF\u5B50\u585E\u96F7",
    archetype: "full_rush",
    signatureCards: [110, 118, 116, 117],
    hasFourCost: true,
    fourCostName: "\u585E\u96F7",
    team: [
      { monsterId: 110, badgeIds: [23, 8] },
      { monsterId: 116, badgeIds: [3, 5] },
      { monsterId: 117, badgeIds: [8, 3] },
      { monsterId: 118, badgeIds: [11, 28, 30] },
      { monsterId: 107, badgeIds: [20, 1] },
      { monsterId: 113, badgeIds: [3, 20] },
      { monsterId: 106, badgeIds: [32, 24] },
      { monsterId: 114, badgeIds: [3, 32] }
    ],
    tree: {
      id: "n60",
      round: 0,
      label: "\u5F00\u5C40",
      comment: "",
      placement: [],
      children: [{
        id: "n61",
        round: 1,
        label: "\u5C401",
        comment: "",
        placement: [
          { monsterId: 110, badgeIds: [23, 8], x: 7, y: 2 },
          { monsterId: 116, badgeIds: [3, 5], x: 6, y: 0 }
        ],
        children: [
          {
            // 主分支：先双射手
            id: "n62",
            round: 2,
            label: "\u5C402",
            comment: "\u53CC\u5C04\u624B+\u52A9\u8DD1\u8F93\u51FA",
            placement: [
              { monsterId: 113, badgeIds: [3, 20], x: 8, y: 2 },
              { monsterId: 114, badgeIds: [3, 32], x: 7, y: 1 }
            ],
            children: [{
              id: "n63",
              round: 3,
              label: "\u5C403",
              comment: "",
              placement: [
                { monsterId: 118, badgeIds: [11, 28, 30], x: 7, y: 3 }
              ],
              children: [{
                id: "n64",
                round: 4,
                label: "\u5C404",
                comment: "",
                placement: [
                  { monsterId: 107, badgeIds: [20, 1], x: 9, y: 2 }
                ],
                children: [{
                  id: "n65",
                  round: 5,
                  label: "\u5C405",
                  comment: "",
                  placement: [
                    { monsterId: 106, badgeIds: [32, 24], x: 6, y: 3 }
                  ],
                  children: []
                }]
              }]
            }]
          },
          {
            // 方法二：先塞雷
            id: "n66",
            round: 2,
            label: "\u65B9\u6CD5\u4E8C",
            comment: "",
            placement: [
              { monsterId: 118, badgeIds: [11, 28, 30], x: 7, y: 3 }
            ],
            children: [{
              id: "n67",
              round: 3,
              label: "\u5C403",
              comment: "\u94C1\u7532\u76FE\u70AE",
              placement: [
                { monsterId: 117, badgeIds: [8, 3], x: 6, y: 3 },
                { monsterId: 106, badgeIds: [32, 24], x: 8, y: 3 }
              ],
              children: [{
                id: "n68",
                round: 4,
                label: "\u5C404",
                comment: "",
                placement: [
                  { monsterId: 107, badgeIds: [20, 1], x: 9, y: 2 }
                ],
                children: [{
                  id: "n69",
                  round: 5,
                  label: "\u5C405",
                  comment: "",
                  placement: [
                    { monsterId: 113, badgeIds: [3, 20], x: 8, y: 2 }
                  ],
                  children: []
                }]
              }]
            }]
          }
        ]
      }]
    }
  };
  var FORMATION_LIBRARY = [
    \u6CC9\u6C34\u5251,
    \u575A\u679C\u6551\u661F,
    \u5168\u4E8C\u51B2,
    \u7ECF\u5178\u6551\u661F,
    \u5168\u4E8C\u6C38\u5E73,
    \u8083\u6E05,
    \u68AF\u5B50\u585E\u96F7
  ];

  // src/ai/strategy/formation_matcher.ts
  function matchFormation(hand, formation) {
    const handIds = new Set(hand.map((c) => c.monsterId));
    const sigSet = new Set(formation.signatureCards);
    const missingCards = [];
    if (formation.hasFourCost) {
      const fourCostSig = formation.signatureCards.find((id) => {
        const m = DB_MONSTERS.find((d) => d.id === id);
        return m && m.cost === 4;
      });
      if (fourCostSig && !handIds.has(fourCostSig)) {
        return { formation, score: 0, missingCards: [fourCostSig] };
      }
    }
    let matchCount = 0;
    for (const sig of formation.signatureCards) {
      if (handIds.has(sig)) {
        matchCount++;
      } else {
        missingCards.push(sig);
      }
    }
    const score = formation.signatureCards.length > 0 ? matchCount / formation.signatureCards.length : 0;
    let bonus = 0;
    const has103 = handIds.has(103);
    const has105 = handIds.has(105);
    const has110 = handIds.has(110);
    if (formation.archetype === "prayer" && has110 && has103 && has105) {
      bonus = 0.1;
    } else if (formation.archetype === "half_rush" && has110 && has105 && !has103) {
      bonus = 0.1;
    } else if (formation.archetype === "full_rush" && has110 && !has105) {
      bonus = 0.1;
    }
    return {
      formation,
      score: Math.min(1, score + bonus),
      missingCards
    };
  }
  function matchAllFormations(hand) {
    return FORMATION_LIBRARY.map((f) => matchFormation(hand, f)).sort((a, b) => b.score - a.score);
  }
  function weightedSelectFormation(matches) {
    if (matches.length === 0) {
      return FORMATION_LIBRARY[0];
    }
    const valid = matches.filter((m) => m.score > 0);
    if (valid.length === 0) {
      return matches[0].formation;
    }
    // When all valid formations are tied (e.g. full DB hand), pick purely random
    const topScore = valid[0].score;
    const allTied = valid.every((m) => Math.abs(m.score - topScore) < 1e-6);
    if (allTied) {
      return valid[Math.floor(Math.random() * valid.length)].formation;
    }
    const roll = Math.random();
    if (roll < 0.7) {
      return valid[0].formation;
    } else if (roll < 0.9) {
      const topN = valid.slice(0, Math.min(3, valid.length));
      return topN[Math.floor(Math.random() * topN.length)].formation;
    } else {
      return valid[Math.floor(Math.random() * valid.length)].formation;
    }
  }

  // src/ai/strategy/special_calculator.ts
  function getOpponentUnits(gs) {
    return [...gs.players.p1.deployed].filter(
      (u) => u.position && Number.isFinite(u.position.x) && Number.isFinite(u.position.y)
    );
  }
  function getFriendlyUnits(gs) {
    return [...gs.players.p2.deployed].filter(
      (u) => u.position && Number.isFinite(u.position.x) && Number.isFinite(u.position.y)
    );
  }
  function getMonsterCost(id) {
    return DB_MONSTERS.find((m) => m.id === id)?.cost ?? 0;
  }
  function getMonsterRole(id) {
    return DB_MONSTERS.find((m) => m.id === id)?.role ?? "";
  }
  function pickBestRow(opponents, defaultY) {
    if (opponents.length === 0) return defaultY;
    const rowCount = /* @__PURE__ */ new Map();
    for (const u of opponents) {
      const py = u.position.y;
      rowCount.set(py, (rowCount.get(py) ?? 0) + 1);
    }
    let bestY = defaultY;
    let bestCount = -1;
    for (const [y, count] of rowCount) {
      if (count > bestCount) {
        bestCount = count;
        bestY = y;
      }
    }
    return bestY;
  }
  var SPECIAL_CALCULATORS = {
    // ==========================================================
    // 冲锋(106)：高优对线铁甲(117) → 其次敌方坦克 → 默认行
    // ==========================================================
    106: {
      name: "\u51B2\u950B",
      computePosition: (_regular, gameState, defaultX, defaultY) => {
        const opponents = getOpponentUnits(gameState);
        const enemyTiejia = opponents.find((u) => u.monsterId === 117);
        if (enemyTiejia) return { x: defaultX, y: enemyTiejia.position.y };
        const enemyTank = opponents.find((u) => getMonsterRole(u.monsterId) === "\u5766\u514B");
        if (enemyTank) return { x: defaultX, y: enemyTank.position.y };
        return { x: defaultX, y: defaultY };
      }
    },
    // ==========================================================
    // 咒法(107)：选敌人最多行 → 挑不会被钻的安全位 → 取最远距离
    // 安全位：敌方怪兽的 x+6 位置（P2侧），因已放怪位置不能再放钻头
    // ==========================================================
    107: {
      name: "\u5492\u6CD5",
      computePosition: (_regular, gameState, defaultX, defaultY) => {
        const opponents = getOpponentUnits(gameState);
        if (opponents.length === 0) return { x: defaultX, y: defaultY };
        const bestY = pickBestRow(opponents, defaultY);
        const safePositions = opponents.filter((u) => u.position.y === bestY).map((u) => u.position.x + 6).filter((x) => x >= P2_ZONE_X_START && x <= 10);
        if (safePositions.length > 0) {
          return { x: Math.max(...safePositions), y: bestY };
        }
        return { x: defaultX, y: bestY };
      }
    },
    // ==========================================================
    // 突突(114)：扫射一行 → 选敌人最多的行
    // ==========================================================
    114: {
      name: "\u7A81\u7A81",
      computePosition: (_regular, gameState, defaultX, defaultY) => {
        const opponents = getOpponentUnits(gameState);
        return { x: defaultX, y: pickBestRow(opponents, defaultY) };
      }
    },
    // ==========================================================
    // 钻头(116)：若有敌方咒法 → 贴咒法 x+6 反制；否则优先4费行
    // ==========================================================
    116: {
      name: "\u94BB\u5934",
      computePosition: (_regular, gameState, defaultX, defaultY) => {
        const opponents = getOpponentUnits(gameState);
        if (opponents.length === 0) return { x: defaultX, y: defaultY };
        const enemySpell = opponents.find((u) => u.monsterId === 107);
        if (enemySpell) {
          const drillX = enemySpell.position.x + 6;
          return { x: Math.max(P2_ZONE_X_START, Math.min(10, drillX)), y: enemySpell.position.y };
        }
        const fourCostRows = opponents.filter((u) => getMonsterCost(u.monsterId) === 4).map((u) => u.position.y);
        if (fourCostRows.length > 0) {
          return { x: defaultX, y: fourCostRows[0] };
        }
        return { x: defaultX, y: pickBestRow(opponents, defaultY) };
      }
    },
    // ==========================================================
    // 铁甲猴(117)：放置在携带预防(11)/加固(28)/反应装甲(30)的队友前一格
    // 铁甲技能（throw）：与带防装队友相邻触发保护
    // ==========================================================
    117: {
      name: "\u94C1\u7532",
      computePosition: (regularActions, gameState, defaultX, defaultY) => {
        const DEF_BADGE_IDS = [11, 28, 30];
        const mate = regularActions.find(
          (a) => a.badgeIds.some((bid) => DEF_BADGE_IDS.includes(bid))
        );
        if (mate) return { x: mate.x - 1, y: mate.y };
        const friendlies = getFriendlyUnits(gameState);
        const deployedMate = friendlies.find(
          (u) => u.badgeIds.some((bid) => DEF_BADGE_IDS.includes(bid))
        );
        if (deployedMate) {
          return { x: deployedMate.position.x - 1, y: deployedMate.position.y };
        }
        return { x: defaultX, y: defaultY };
      }
    }
  };
  var SPECIAL_IDS = new Set(
    Object.keys(SPECIAL_CALCULATORS).map(Number)
  );
  function collectOccupied(regularActions, gameState) {
    const occupied = /* @__PURE__ */ new Set();
    for (const a of regularActions) {
      if (Number.isFinite(a.x) && Number.isFinite(a.y)) {
        occupied.add(`${a.x},${a.y}`);
      }
    }
    for (const u of gameState.players.p2.deployed) {
      if (u.position && Number.isFinite(u.position.x) && Number.isFinite(u.position.y)) {
        occupied.add(`${u.position.x},${u.position.y}`);
      }
    }
    return occupied;
  }
  function resolvePosition(preferredX, preferredY, occupied, defaultX, defaultY) {
    if (!occupied.has(`${preferredX},${preferredY}`)) {
      return { x: preferredX, y: preferredY };
    }
    const ROW_X_RANGE = [6, 7, 8, 9, 10];
    const sortedX = ROW_X_RANGE.filter((x) => !occupied.has(`${x},${preferredY}`)).sort((a, b) => Math.abs(a - preferredX) - Math.abs(b - preferredX));
    if (sortedX.length > 0) {
      return { x: sortedX[0], y: preferredY };
    }
    const ROW_Y_RANGE = [0, 1, 2, 3, 4];
    const allCells = [];
    for (const y of ROW_Y_RANGE) {
      for (const x of ROW_X_RANGE) {
        if (!occupied.has(`${x},${y}`)) {
          allCells.push({ x, y });
        }
      }
    }
    allCells.sort(
      (a, b) => Math.abs(a.x - preferredX) + Math.abs(a.y - preferredY) - (Math.abs(b.x - preferredX) + Math.abs(b.y - preferredY))
    );
    if (allCells.length > 0) {
      return allCells[0];
    }
    return { x: defaultX, y: defaultY };
  }
  function computeSpecialPosition(monsterId, regularActions, gameState, defaultX, defaultY) {
    const calculator = SPECIAL_CALCULATORS[monsterId];
    if (!calculator) {
      return { x: defaultX, y: defaultY };
    }
    let pos = { x: defaultX, y: defaultY };
    try {
      pos = calculator.computePosition(regularActions, gameState, defaultX, defaultY);
    } catch (e) {
      console.warn(`[SpecialCalc] \u602A\u517D ${monsterId}(${calculator.name}) computePosition \u5F02\u5E38:`, e);
    }
    if (!Number.isFinite(pos.x)) pos = { ...pos, x: defaultX };
    if (!Number.isFinite(pos.y)) pos = { ...pos, y: defaultY };
    const clampedX = Math.max(P2_ZONE_X_START, Math.min(10, pos.x));
    const clampedY = Math.max(0, Math.min(BOARD_HEIGHT - 1, pos.y));
    const safeX = Number.isFinite(clampedX) ? clampedX : P2_ZONE_X_START;
    const safeY = Number.isFinite(clampedY) ? clampedY : 2;
    const occupied = collectOccupied(regularActions, gameState);
    return resolvePosition(safeX, safeY, occupied, defaultX, defaultY);
  }

  // src/ai/strategy/formation_engine.ts
  var IMPERIAL_ID = 110;
  var FOUR_COST_IDS = new Set(
    Object.values(DB_MONSTERS).filter((m) => m.cost === 4).map((m) => m.id)
  );
  var FormationEngine = class {
    constructor() {
      this.hand = [];
      this.handIds = /* @__PURE__ */ new Set();
      this.selectedFormation = null;
      this.matchResult = null;
      this.currentRound = 1;
      this.currentNode = null;
      this.variant = "original";
      /** 已部署的 monsterId 集合（跨局去重） */
      this.deployedIds = /* @__PURE__ */ new Set();
    }
    // ============================================================
    // 初始化
    // ============================================================
    init(hand) {
      this.hand = hand;
      this.handIds = new Set(hand.map((c) => c.monsterId));
      this.currentRound = 1;
      this.deployedIds = /* @__PURE__ */ new Set();
      const matches = matchAllFormations(hand);
      const formation = weightedSelectFormation(matches);
      const matchResult = matches.find((m) => m.formation.id === formation.id);
      this.selectedFormation = formation;
      this.matchResult = matchResult;
      this.currentNode = formation.tree;
      this.selectVariant();
      return { formation, score: matchResult.score, matches };
    }
    /**
     * 随机选择变体
     * 全局镜像 25% + 帝国轴镜像 25% = 镜像 50%
     * 上下移 30% + 左右移 20%
     */
    selectVariant() {
      const roll = Math.random();
      if (roll < 0.25) {
        this.variant = "mirror_global";
      } else if (roll < 0.5) {
        this.variant = "mirror_imperial";
      } else if (roll < 0.8) {
        this.variant = Math.random() < 0.5 ? "shift_up" : "shift_down";
      } else {
        this.variant = Math.random() < 0.5 ? "shift_left" : "shift_right";
      }
    }
    // ============================================================
    // 自定义阵型加载
    // ============================================================
    /**
     * 从策略编辑器 JSON 加载自定义阵型
     * 格式: { name, archetype, team, tree }
     */
    loadCustomFormation(json) {
      const convertNode = (raw, parent) => ({
        id: raw.id || `cn${Math.random().toString(36).slice(2, 8)}`,
        round: raw.round,
        label: raw.label || "",
        comment: raw.comment || "",
        placement: (raw.placement || []).map((p) => ({
          monsterId: p.monsterId,
          badgeIds: p.badgeIds || [],
          x: p.x,
          y: p.y
        })),
        children: (raw.children || []).map((c) => convertNode(c, void 0))
      });
      const teamIds = new Set(json.team.map((c) => c.monsterId));
      const fourCostCards = json.team.filter((c) => {
        const m = DB_MONSTERS.find((d) => d.id === c.monsterId);
        return m && m.cost === 4;
      }).map((c) => c.monsterId);
      const signatureCards = [];
      if (teamIds.has(110)) signatureCards.push(110);
      if (json.archetype === "prayer") {
        if (teamIds.has(103)) signatureCards.push(103);
        if (teamIds.has(105)) signatureCards.push(105);
      } else if (json.archetype === "half_rush") {
        if (teamIds.has(105)) signatureCards.push(105);
      }
      for (const id of fourCostCards) {
        if (!signatureCards.includes(id)) signatureCards.push(id);
      }
      if (signatureCards.length < 2) {
        for (const c of json.team) {
          if (!signatureCards.includes(c.monsterId)) {
            signatureCards.push(c.monsterId);
            if (signatureCards.length >= 4) break;
          }
        }
      }
      const formation = {
        id: `custom_${json.name}`,
        name: json.name,
        archetype: json.archetype,
        team: json.team.map((c) => ({ monsterId: c.monsterId, badgeIds: c.badgeIds })),
        tree: convertNode(json.tree),
        signatureCards,
        hasFourCost: fourCostCards.length > 0,
        fourCostName: fourCostCards.length > 0 ? DB_MONSTERS.find((m) => m.id === fourCostCards[0])?.name : void 0
      };
      this.selectedFormation = formation;
      this.currentNode = formation.tree;
      return formation;
    }
    // ============================================================
    // 逐局决策
    // ============================================================
    getRoundPlan(round, gameState) {
      if (!this.selectedFormation) {
        return { round, placements: [] };
      }
      this.currentRound = round;
      const node = this.findNodeForRound(round, gameState);
      if (!node) {
        return { round, placements: [] };
      }
      this.currentNode = node;
      const freshPlacements = node.placement.filter((p) => {
        if (this.deployedIds.has(p.monsterId)) return false;
        if (round >= 4 && FOUR_COST_IDS.has(p.monsterId)) return false;
        return true;
      });
      const regularPlacements = freshPlacements.filter((p) => !SPECIAL_IDS.has(p.monsterId));
      const specialPlacements = freshPlacements.filter((p) => SPECIAL_IDS.has(p.monsterId));
      let regularActions = regularPlacements.map((p) => ({
        monsterId: p.monsterId,
        badgeIds: [...p.badgeIds],
        x: p.x,
        y: p.y
      }));
      regularActions = this.applyVariant(regularActions);
      regularActions = regularActions.map((a) => ({
        ...a,
        x: Math.max(P2_ZONE_X_START, Math.min(10, a.x)),
        y: Math.max(0, Math.min(BOARD_HEIGHT - 1, a.y))
      }));
      regularActions = regularActions.map((a) => {
        if (a.monsterId === IMPERIAL_ID) {
          return {
            ...a,
            x: Math.max(7, Math.min(9, a.x)),
            y: Math.max(1, Math.min(3, a.y))
          };
        }
        return a;
      });
      const specialActions = specialPlacements.map((p) => {
        const pos = computeSpecialPosition(
          p.monsterId,
          regularActions,
          gameState,
          p.x,
          p.y
        );
        return {
          monsterId: p.monsterId,
          badgeIds: [...p.badgeIds],
          ...pos
        };
      });
      const actions = [...regularActions, ...specialActions];
      // Only mark the first action as deployed — caller consumes one at a time.
      // Previously all fresh placements were marked at once, causing subsequent
      // decide() calls to return null (all filtered as already deployed).
      if (actions.length > 0) {
        this.deployedIds.add(actions[0].monsterId);
      }
      if (actions.length > 0) {
        const coordStr = actions.map((a) => `${a.monsterId}@(${a.x},${a.y})`).join(", ");
        console.log(`[Formation R${round}] ${this.selectedFormation?.name} placements: ${coordStr}`);
      }
      return { round, placements: actions };
    }
    getRoundComment() {
      if (!this.currentNode) return "";
      return this.currentNode.comment;
    }
    /**
     * 沿阵型树查找对应回合的节点，遇到多分支时选择分支
     */
    findNodeForRound(round, gameState) {
      if (!this.selectedFormation) return null;
      let node = this.selectedFormation.tree;
      for (let r = 1; r <= round; r++) {
        const children = node.children;
        if (children.length === 0) return null;
        let target = children.find((c) => c.round === r);
        if (!target) target = children[0];
        if (r === round && children.length > 1) {
          target = this.selectBranch(gameState, children);
        }
        node = target;
      }
      return node;
    }
    /**
     * 分支选择逻辑
     * - Round 1（对手尚未部署）：随机选分支
     * - Round 2+：根据对手已部署单位匹配分支标签
     * - 无匹配标签：随机选择（而非永远选第一个）
     */
    selectBranch(gameState, branches) {
      const opponentDeployed = gameState.players.p1.deployed;
      if (opponentDeployed.length === 0) {
        const picked2 = branches[Math.floor(Math.random() * branches.length)];
        console.log(`[Formation] \u5BF9\u624B\u672A\u90E8\u7F72\uFF0C\u968F\u673A\u9009\u62E9\u5206\u652F: ${picked2.label}`);
        return picked2;
      }
      const hasTripleKing = opponentDeployed.some((m) => m.monsterId === 124);
      const hasDrill = opponentDeployed.some((m) => m.monsterId === 116);
      const hasPrayer = opponentDeployed.some((m) => m.monsterId === 105);
      const hasRush = opponentDeployed.some((m) => m.monsterId === 106);
      const hasFullRush = !hasPrayer && (opponentDeployed.some((m) => m.monsterId === 107) || opponentDeployed.some((m) => m.monsterId === 113) || opponentDeployed.some((m) => m.monsterId === 117));
      for (const branch of branches) {
        const label = branch.label;
        if (hasTripleKing && (label.includes("\u4E09\u632F\u738B") || label.includes("\u4E09\u632F"))) return branch;
        if (hasDrill && label.includes("\u94BB\u5934")) return branch;
        if (hasPrayer && (label.includes("\u7977\u5F92") || label.includes("\u7948\u7977"))) return branch;
        if (hasFullRush && label.includes("\u5168\u51B2")) return branch;
        if (hasRush && label.includes("\u51B2\u950B")) return branch;
      }
      const picked = branches[Math.floor(Math.random() * branches.length)];
      console.log(`[Formation] \u65E0\u5339\u914D\u5206\u652F\u6807\u7B7E\uFF0C\u968F\u673A\u9009\u62E9: ${picked.label}`);
      return picked;
    }
    // ============================================================
    // 变体应用（仅作用于普通怪兽，特殊怪兽不参与）
    // ============================================================
    applyVariant(actions) {
      switch (this.variant) {
        case "mirror_global":
          return this.applyMirrorGlobal(actions);
        case "mirror_imperial":
          return this.applyMirrorImperial(actions);
        case "shift_up":
          return this.applyShift(actions, 0, -(1 + Math.floor(Math.random() * 2)));
        case "shift_down":
          return this.applyShift(actions, 0, 1 + Math.floor(Math.random() * 2));
        case "shift_left":
          return this.applyShift(actions, -(1 + Math.floor(Math.random() * 2)), 0);
        case "shift_right":
          return this.applyShift(actions, 1 + Math.floor(Math.random() * 2), 0);
        default:
          return actions;
      }
    }
    /**
     * 全局镜像：以 y=2 为轴，全体上下翻转
     * newY = 4 - oldY
     */
    applyMirrorGlobal(actions) {
      return actions.map((a) => ({
        ...a,
        y: Math.max(0, Math.min(BOARD_HEIGHT - 1, BOARD_HEIGHT - 1 - a.y))
      }));
    }
    /**
     * 帝国轴镜像：以帝国之盾(110)所在行为轴，仅翻转非核心怪兽
     * 坦克/核心不动，射手、战士、辅助绕帝国翻转
     */
    applyMirrorImperial(actions) {
      const imperial = actions.find((a) => a.monsterId === IMPERIAL_ID);
      if (!imperial) return actions;
      const axisY = imperial.y;
      const lockedIds = /* @__PURE__ */ new Set([IMPERIAL_ID]);
      return actions.map((a) => {
        if (lockedIds.has(a.monsterId) || FOUR_COST_IDS.has(a.monsterId)) {
          return a;
        }
        const newY = 2 * axisY - a.y;
        const clampedY = Math.max(0, Math.min(BOARD_HEIGHT - 1, newY));
        return { ...a, y: clampedY };
      });
    }
    /**
     * 整体平移：保持阵型结构，整体不越界
     * 计算 group 最大安全偏移量，统一应用到全体
     * 额外约束：帝国之盾必须在中心 3×3（x:7-9, y:1-3）
     * 若被完全约束（位移归零），记录日志（不影响正常流程）
     */
    applyShift(actions, dx, dy) {
      if (actions.length === 0) return actions;
      const minX = Math.min(...actions.map((a) => a.x));
      const maxX = Math.max(...actions.map((a) => a.x));
      const minY = Math.min(...actions.map((a) => a.y));
      const maxY = Math.max(...actions.map((a) => a.y));
      let safeDx = dx < 0 ? Math.max(dx, P2_ZONE_X_START - minX) : Math.min(dx, 10 - maxX);
      let safeDy = dy < 0 ? Math.max(dy, 0 - minY) : Math.min(dy, BOARD_HEIGHT - 1 - maxY);
      const imperial = actions.find((a) => a.monsterId === IMPERIAL_ID);
      if (imperial) {
        if (dx < 0) safeDx = Math.max(safeDx, 7 - imperial.x);
        else if (dx > 0) safeDx = Math.min(safeDx, 9 - imperial.x);
        if (dy < 0) safeDy = Math.max(safeDy, 1 - imperial.y);
        else if (dy > 0) safeDy = Math.min(safeDy, 3 - imperial.y);
      }
      if (safeDx === 0 && safeDy === 0) {
        console.log(`[Formation] shift\u53D8\u4F53(${this.variant}, dx=${dx}, dy=${dy})\u88AB\u8FB9\u754C/\u5E1D\u56FD\u7EA6\u675F\u62B5\u6D88\uFF0C\u4FDD\u6301\u539F\u4F4D`);
        return actions;
      }
      const applied = actions.map((a) => ({ ...a, x: a.x + safeDx, y: a.y + safeDy }));
      console.log(`[Formation] shift\u53D8\u4F53 \u5B9E\u9645\u504F\u79FB: dx=${safeDx}, dy=${safeDy}`);
      return applied;
    }
    // ============================================================
    // 查询
    // ============================================================
    getSelectedFormation() {
      return this.selectedFormation;
    }
    getMatchScore() {
      return this.matchResult?.score ?? 0;
    }
    getVariant() {
      return this.variant;
    }
    getHandIds() {
      return this.handIds;
    }
    getDeploySummary() {
      if (!this.selectedFormation) return "\u672A\u521D\u59CB\u5316";
      return `\u9635\u578B: ${this.selectedFormation.name} (${this.selectedFormation.archetype}) | \u53D8\u4F53: ${this.variant} | \u5339\u914D\u5EA6: ${(this.getMatchScore() * 100).toFixed(0)}%`;
    }
    reset() {
      this.hand = [];
      this.handIds = /* @__PURE__ */ new Set();
      this.selectedFormation = null;
      this.matchResult = null;
      this.currentRound = 1;
      this.currentNode = null;
      this.deployedIds = /* @__PURE__ */ new Set();
    }
  };

  // src/ai/decision_pipeline.ts
  function createDefaultEvaluator() {
    return new CompositeEvaluator([
      new MetaValueEvaluator(),
      new SurvivalSafetyEvaluator(),
      new ComboPotentialEvaluator(),
      new PositioningValueEvaluator()
    ]);
  }
  var DecisionPipeline = class {
    constructor(evaluator, searchEngine, layoutSystem, formationEngine) {
      this.useFormationMode = true;
      this.evaluator = evaluator ?? createDefaultEvaluator();
      this.searchEngine = searchEngine ?? new SearchEngine(this.evaluator);
      this.logger = new DecisionLogger();
      this.layoutSystem = layoutSystem ?? new LayoutSystem(false);
      this.formationEngine = formationEngine ?? new FormationEngine();
    }
    /**
     * 核心决策接口：给定局面，返回最优放置行动
     */
    decide(request) {
      const { gameState, playerSide } = request;
      const { bestAction, log } = this.searchEngine.search(gameState, playerSide);
      this.logger.formatLog(log);
      return {
        action: bestAction,
        log
      };
    }
    /**
     * 限定卡池决策：只考虑指定卡片，返回最优(怪兽+位置)
     */
    decideWithCards(request, cards) {
      const { gameState, playerSide } = request;
      const actions = generateActionsWithCards(gameState, cards);
      const layoutEval = this.layoutSystem.enabled ? (s, p, a) => this.layoutSystem.evaluatePlacement(s, p, a) : void 0;
      const { bestAction, log } = this.searchEngine.searchWithActions(
        gameState,
        playerSide,
        actions,
        layoutEval
      );
      this.logger.formatLog(log);
      return {
        action: bestAction,
        log
      };
    }
    /**
     * 构筑规划：规划 8 只怪兽 + 徽章组合（总计 16 费）
     * 返回推荐的怪兽 ID 列表和徽章建议
     * 8只×2费 = 16费，全二费阵容
     */
    planBuild() {
      const reasoning = [];
      const selected = [];
      let remainingBudget = TOTAL_BUDGET;
      const mustBring = [110, 106];
      for (const id of mustBring) {
        const monster = DB_MONSTERS.find((m) => m.id === id);
        if (monster && monster.cost <= remainingBudget) {
          selected.push({ monsterId: id, badgeIds: [] });
          remainingBudget -= monster.cost;
          reasoning.push(`\u5FC5\u5907: ${monster.name}(${monster.cost}\u8D39)`);
        }
      }
      selected.push({ monsterId: 103, badgeIds: [] });
      selected.push({ monsterId: 105, badgeIds: [] });
      remainingBudget -= 4;
      reasoning.push("\u6838\u5FC3\u4F53\u7CFB: \u7977\u5F92\u9635\uFF08\u5B66\u5F92+\u7948\u7977\uFF09\u2014 \u6700\u5F3A\u673A\u5236");
      const supplements = [112, 104, 116, 124];
      for (const id of supplements) {
        const monster = DB_MONSTERS.find((m) => m.id === id);
        if (monster && monster.cost <= remainingBudget) {
          selected.push({ monsterId: id, badgeIds: [] });
          remainingBudget -= monster.cost;
          reasoning.push(`\u8865\u5145: ${monster.name}(${monster.cost}\u8D39)`);
        }
      }
      reasoning.push(`\u603B\u8D39\u7528: ${TOTAL_BUDGET - remainingBudget}/${TOTAL_BUDGET}\uFF0C\u5171${selected.length}\u53EA\u602A\u517D`);
      reasoning.push(`\u5EFA\u8BAE\u5FBD\u7AE0: \u5E1D\u56FD\u4E4B\u76FE\u2192\u539A\u76AE(8)+\u97E7\u6027(23), \u51B2\u950B\u2192\u5DEB\u6BD2(32)+\u70B8\u5F39(24), \u5B66\u5F92\u2192\u539A\u76AE(8)+\u7ED3\u9635\u5B88(12), \u7948\u7977\u2192\u539A\u76AE(8)+\u5927\u53A8(17), \u5B88\u536B\u8005\u2192\u539A\u76AE(8)+\u56DE\u590D\u5149\u73AF(6), \u6563\u5F39\u2192\u539A\u76AE(8)+\u5143\u7D20\u6D8C\u52A8(4), \u94BB\u5934\u2192\u7834\u76FE(3)+\u52A9\u8DD1(5), \u4E09\u632F\u738B\u2192\u84C4\u80FD(10)+\u4E2D\u6BD2(25)`);
      return {
        monsters: selected,
        reasoning,
        totalCost: TOTAL_BUDGET - remainingBudget
      };
    }
    /** 获取当前评估器（运行时调整权重等） */
    getEvaluator() {
      return this.evaluator;
    }
    /** 获取当前搜索引擎 */
    getSearchEngine() {
      return this.searchEngine;
    }
    /** 获取布局系统 */
    getLayoutSystem() {
      return this.layoutSystem;
    }
    /** 设置搜索深度 */
    setSearchDepth(depth) {
      this.searchEngine.setMaxDepth(depth);
    }
    // ============================================================
    // 阵型引擎 接口
    // ============================================================
    /** 获取阵型引擎 */
    getFormationEngine() {
      return this.formationEngine;
    }
    /** 是否启用阵型模式 */
    isFormationMode() {
      return this.useFormationMode;
    }
    /** 切换阵型模式 / 评估搜索模式 */
    setFormationMode(enabled) {
      this.useFormationMode = enabled;
    }
    /**
     * 阵型模式决策：给定手牌和游戏状态，返回本轮部署计划
     * 调用时机：每回合 AI 开始放置前
     * 首次调用自动初始化阵型引擎（不再限制仅 round===1）
     */
    decideWithFormation(hand, round, gameState) {
      if (!this.formationEngine.getSelectedFormation()) {
        const totalCost = hand.reduce(
          (sum, c) => sum + (DB_MONSTERS.find((m) => m.id === c.monsterId)?.cost ?? 0),
          0
        );
        if (hand.length < 7 || totalCost > TOTAL_BUDGET) {
          console.warn(
            `[Formation] \u624B\u724C\u4E0D\u5408\u6CD5: ${hand.length}\u53EA/${totalCost}\u8D39, \u65E0\u6CD5\u521D\u59CB\u5316\u9635\u578B\u5F15\u64CE`
          );
          return { round, placements: [] };
        }
        const initResult = this.formationEngine.init(hand);
        console.log(
          `[Formation] \u9009\u5B9A\u9635\u578B: ${initResult.formation.name} (${initResult.formation.archetype}) \u5339\u914D\u5EA6: ${(initResult.score * 100).toFixed(0)}%`
        );
      }
      return this.formationEngine.getRoundPlan(round, gameState);
    }
    /** 重置阵型引擎 */
    resetFormation() {
      this.formationEngine.reset();
    }
  };

  // src/battle-ai.ts
  var BattleAI = class {
    constructor() {
      this.hand = [];
      this.pipeline = new DecisionPipeline();
      this.pipeline.setFormationMode(true);
    }
    // ============================================================
    // 数据查询
    // ============================================================
    getAllMonsters() {
      return DB_MONSTERS;
    }
    getMonster(id) {
      return getMonster(id);
    }
    getAllBadges() {
      return DB_BADGES;
    }
    getBadge(id) {
      return getBadge(id);
    }
    // ============================================================
    // 游戏状态
    // ============================================================
    createGame() {
      return createEmptyGameState();
    }
    cloneGame(state) {
      return cloneGameState(state);
    }
    getAvailableSlots(state) {
      return Board.getAvailableSlots(state, state.currentPlayer);
    }
    getRoundBudget(round) {
      return getRoundBudget(round);
    }
    // ============================================================
    // 行动校验与执行
    // ============================================================
    validateAction(state, action) {
      return GameEngine.validateAction(state, action);
    }
    applyAction(state, action) {
      return GameEngine.applyAction(state, action);
    }
    advancePhase(state) {
      return GameEngine.advancePhase(state);
    }
    // ============================================================
    // ==== 卡牌接口：buildTeam(hand) — 根据手牌匹配阵型，推荐卡组 ====
    // ============================================================
    /**
     * 从手牌中选出最优卡组。内部匹配 7 个预定义阵型，返回最适合的 8 张卡。
     * 同时初始化阵型引擎，后续 decide() 将按此阵型布阵。
     */
    buildTeam(hand) {
      this.hand = hand;
      this.pipeline.resetFormation();
      const engine = this.pipeline.getFormationEngine();
      const result = engine.init(hand);
      return {
        cards: result.formation.team.map((c) => ({
          monsterId: c.monsterId,
          badgeIds: c.badgeIds
        })),
        formationName: result.formation.name,
        archetype: result.formation.archetype,
        matchScore: result.score
      };
    }
    // ============================================================
    // ==== 布阵接口：decide(state) — 每回合放置决策 ====
    // ============================================================
    /**
     * 当前局面最优放置决策。
     * 前提：已调用 buildTeam(hand) 初始化阵型引擎。
     * 若未初始化，降级为评估搜索模式。
     */
    decide(state, side) {
      const playerSide = side ?? state.currentPlayer;
      if (this.pipeline.isFormationMode() && this.hand.length > 0) {
        const plan = this.pipeline.decideWithFormation(this.hand, state.round, state);
        const action = plan.placements[0] ?? null;
        return {
          action,
          log: {
            timestamp: Date.now(),
            candidates: [],
            selected: action,
            searchDepth: 0,
            timeCostMs: 0,
            trace: [`[\u9635\u578B\u6A21\u5F0F] \u7B2C${state.round}\u5C40 \u2014 ${plan.placements.length}\u4E2A\u90E8\u7F72`]
          }
        };
      }
      return this.pipeline.decide({ gameState: state, playerSide });
    }
    // ============================================================
    // 配置
    // ============================================================
    setDifficulty(level) {
      const depths = { easy: 1, normal: 1, hard: 2 };
      this.pipeline.setSearchDepth(depths[level]);
      this.pipeline.setFormationMode(true);
    }
    setSearchDepth(depth) {
      this.pipeline.setSearchDepth(depth);
    }
    setFormationMode(on) {
      this.pipeline.setFormationMode(on);
    }
    resetFormation() {
      this.pipeline.resetFormation();
    }
  };
  return __toCommonJS(battle_ai_exports);
})();
// Override global BattleAI with the actual constructor class (IIFE result is the exports object)
window.BattleAI = BattleAI.BattleAI;
