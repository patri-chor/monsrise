// ============================================
//  入口文件 — 资源预加载 → UI 缩放 → 系统初始化 → 启动
// ============================================
import './style.css';
import { director } from './core/Director';
import { Node } from './core/Node';
import { Sprite } from './core/Sprite';
import { Component } from './core/Component';
import { gameEngine } from './game/GameEngine';
import { battleSystem, gridToScreen } from './game/BattleSystem';
import { uiManager } from './ui/UIManager';
import { vfx } from './game/VfxManager';
import { registerAllBadges } from './game/BadgeSystem';
import { networkManager } from './net/NetworkManager';

// ============================================
//  资源预加载
// ============================================
const _IMG_VERSION = Date.now();
const ASSETS_TO_LOAD = {
  spritesheet: `all.png?v=${_IMG_VERSION}`,
  bgSky: `background/sky.webp?v=${_IMG_VERSION}`,
  bgYun1: `background/yun1.png?v=${_IMG_VERSION}`,
  bgYun2: `background/yun2.png?v=${_IMG_VERSION}`,
};

const frameImages = new Map<number, HTMLImageElement>();
function getFrameImage(dbId: number): HTMLImageElement {
  let img = frameImages.get(dbId);
  if (!img) {
    img = new Image();
    img.src = `frames/${dbId}.png`;
    frameImages.set(dbId, img);
  }
  return img;
}

const loadedImages: Record<string, HTMLImageElement> = {};

function preloadAssets(onComplete: () => void): void {
  const keys = Object.keys(ASSETS_TO_LOAD) as Array<keyof typeof ASSETS_TO_LOAD>;
  let loadedCount = 0;
  
  if (keys.length === 0) {
    onComplete();
    return;
  }

  keys.forEach(key => {
    const img = new Image();
    img.src = ASSETS_TO_LOAD[key];
    img.onload = () => {
      loadedImages[key] = img;
      loadedCount++;
      if (loadedCount === keys.length) {
        onComplete();
      }
    };
    img.onerror = () => {
      console.error(`Failed to load asset: ${ASSETS_TO_LOAD[key]}`);
      loadedCount++;
      if (loadedCount === keys.length) {
        onComplete();
      }
    };
  });
}

// ============================================
//  游戏循环组件（Canvas 板同步）
// ============================================
class BoardSyncComponent extends Component {
  private _monstersContainer!: Node;
  private _monsterNodes: Map<string, Node> = new Map();

  public onLoad(): void {
    // Create Monsters Container Node (Background is drawn by DOM gameBg now)
    this._monstersContainer = new Node('MonstersContainer');
    this.node.addChild(this._monstersContainer);
  }

  public update(_dt: number): void {
    const state = gameEngine.state;
    const isEdit = state === 'TEAM_EDIT';
    
    if (isEdit) {
      this._monstersContainer.active = false;
      return;
    }
    this._monstersContainer.active = true;

    const isReplayCombat = (state === 'REPLAY' && gameEngine.isReplaying && battleSystem.active);

    if (state === 'BATTLE' || isReplayCombat) {
      if (!gameEngine.isReplayPaused) {
        battleSystem.update(_dt);
      }
    }

    const isP1 = state === 'PREPARATION_LEFT';
    const isP2 = state === 'PREPARATION_RIGHT';
    const isBattle = state === 'BATTLE' || state === 'ROUND_END' || state === 'GAME_OVER' || isReplayCombat;

    // Track active monsters in engine
    const activeIds = new Set<string>();

    for (const m of gameEngine.boardMonsters) {
      const shouldRenderDead = isBattle && m.isDead && !(m as any).resurrecting;
      if (m.isDead && !(m as any).resurrecting && !shouldRenderDead) continue;
      
      activeIds.add(m.id);

      // Determine fog of war hiding: only hide monsters placed in the current round
      const hide = (m.placedRound === gameEngine.currentRound) && ((isP1 && m.gridX >= 6) || (isP2 && m.gridX < 5));

      let mNode = this._monsterNodes.get(m.id);
      const baseScale = (8.5/10) * m.data.scale;
      if (!mNode) {
        // Create new Node for monster
        mNode = new Node(`Monster_${m.id}`);
        mNode.addComponent(Sprite);
        
        // Melee facing P1 (faces right) or P2 (faces left) with 0.8 scale to fit cell
        mNode.scaleX = (m.gridX >= 6) ? -baseScale : baseScale;
        mNode.scaleY = baseScale;

        this._monstersContainer.addChild(mNode);
        this._monsterNodes.set(m.id, mNode);
      }

      // Update active state based on fog of war and noSprite status
      mNode.active = !hide && !(m as any).noSprite;

      // 死亡下落动画计算 (500ms 沉降半个格子高度约 63px)
      let dy = 0;
      if (m.isDead) {
        if (!(m as any).deathTime) {
          (m as any).deathTime = Date.now();
        }
        const elapsed = Date.now() - (m as any).deathTime;
        const progress = Math.min(1, elapsed / 200);
        dy = progress * 20;
      } else {
        (m as any).deathTime = undefined;
        (m as any)._deadFacing = undefined;
      }

      // Update position and flip scaleX dynamically
      if (isBattle) {
        // Use smooth interpolated positions from BattleSystem during combat
        const smoothPos = battleSystem.screenPositions.get(m.id);
        const targetPos = (battleSystem as any)._targetPositions.get(m.id);
        if (smoothPos) {
          mNode.position = { x: smoothPos.x, y: smoothPos.y + dy - 20 };
        }

        if (m.isDead) {
          // 尸体固定死亡瞬间朝向，不随敌人移动改变；不做技能旋转
          if (!(m as any)._deadFacing) {
            (m as any)._deadFacing = mNode.scaleX < 0 ? -1 : 1;
          }
          mNode.scaleX = (m as any)._deadFacing * baseScale;
          mNode.scaleY = baseScale;
          mNode.rotation = 0;
        } else if ((m as any)._chargeDir !== undefined) {
          // 冲锋朝向：强制锁定冲锋方向
          mNode.scaleX = (m as any)._chargeDir === 1 ? -baseScale : baseScale;
          mNode.scaleY = baseScale;
        } else if (smoothPos && targetPos && Math.abs(targetPos.x - smoothPos.x) > 1) {
          // Face the direction of active movement
          mNode.scaleX = (targetPos.x > smoothPos.x) ? baseScale : -baseScale;
          mNode.scaleY = baseScale;
        } else {
          // Face the closest enemy
          const enemy = (battleSystem as any).findClosestEnemy(m);
          if (enemy) {
            mNode.scaleX = (enemy.gridX > m.gridX) ? baseScale : -baseScale;
            mNode.scaleY = baseScale;
          } else {
            mNode.scaleX = (m.team === 1) ? baseScale : -baseScale;
            mNode.scaleY = baseScale;
          }
        }

        // Skill rotation（肃清哥、见习骑士：反方向蓄力 + 加速减速一圈）
        if (state === 'BATTLE' && !m.isDead && (m as any)._rotationDuration && (m as any)._rotationRemaining > 0) {
          const total = (m as any)._rotationDuration as number;
          const remaining = (m as any)._rotationRemaining as number;
          const elapsed = total - remaining;
          const windupRatio = 0.2; // 前20%时间反方向蓄力

          let angle: number;
          if (elapsed < total * windupRatio) {
            // 反方向蓄力：0° → -30°
            const t = elapsed / (total * windupRatio);
            angle = t * (-30);
          } else {
            // 旋转一圈：-30° → 360°，easeInOutCubic
            const spinElapsed = elapsed - total * windupRatio;
            const spinDuration = total * (1 - windupRatio);
            const t = Math.min(1, spinElapsed / spinDuration);
            const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
            angle = -30 + eased * 390; // -30° → 360°
          }
          mNode.rotation = angle;
        } else if (isBattle && m.state === 'skill' && m.data.skill === 'shadow' && (m as any)._tiltTotal) {
          // 忍小猴技能蓄力倾斜：后倾30° → 前倾60°
          const total = (m as any)._tiltTotal as number;
          const remaining = (m as any).skillAnimationTimeLeft || 0;
          const elapsed = total - remaining;
          const half = total / 2;
          let angle: number;
          if (elapsed < half) {
            angle = (elapsed / half) * (-30);
          } else if (remaining > 0) {
            angle = -30 + ((elapsed - half) / half) * 90;
          } else {
            angle = 0;
            (m as any)._tiltTotal = 0;
          }
          mNode.rotation = angle;
        } else {
          mNode.rotation = 0;
        }
      } else {
        // Use grid cell center positions during prep
        const gridPos = gridToScreen(m.gridX, m.gridY);
        mNode.position = { x: gridPos.x, y: gridPos.y + dy - 20 };
        mNode.scaleX = (m.team === 2) ? -baseScale : baseScale;
        mNode.scaleY = baseScale;
        mNode.rotation = 0;
      }

      // Sync flashTime and deepStealth to sprite component
      const sprite = mNode.getComponent(Sprite);
      if (sprite) {
        sprite.flashTime = m.flashTime || 0;
        sprite.team = m.team;
        sprite.deepStealth = (m as any).deepStealth || false;
        sprite.isGhost = (m as any).resurrecting || false;
        // 忍小猴 stealth 半透明（自定义标志，不走 statusEffects 系统）
        sprite.stealthAlpha = (m as any)._shadowStealth ? 0.4 : undefined;
        if (isBattle) {
          sprite.hp = m.hp;
          sprite.maxHp = m.maxHp;
          sprite.shield = m.shield;
          sprite.statusEffects = m.statusEffects;
          sprite.skillCdProgress = m.skillCdProgress;
          sprite.skillCd = m.data.skillCd;
        } else {
          sprite.hp = null;
        }

        // 动态计算序列帧 sx/sy/isDeadBody 并更新 Sprite 贴图
        const frameImg = getFrameImage(m.dbId);

        // 统一所有怪兽的单帧大小为 40x40 像素
        const fw = 40;
        const fh = 40;
        const displayW = m.data.sw;
        const displayH = m.data.sh;

        let sx = 0;
        let sy = 0;
        let isDeadBody = false;
        if (m.isDead) {
          sy = fh * 2;
          sx = 0;
          isDeadBody = true;
        } else {
          if (m.state === 'walk') {
            sy = fh;
            const frameIndex = Math.floor(Date.now() / 100) % 8;
            sx = frameIndex * fw;
          } else {
            sy = 0;
            const speed = (m.state === 'attack' || m.state === 'skill') ? 60 : 120;
            const frameIndex = Math.floor(Date.now() / speed) % 8;
            sx = frameIndex * fw;
          }
        }
        sprite.isDeadBody = isDeadBody;
        sprite.setSprite(frameImg, sx, sy, fw, fh, displayW, displayH);
      }
    }

    // 排序：死亡尸体先绘制（最底层），活着的怪兽后绘制（顶层），尸体不遮挡活怪
    const deadNodes: Node[] = [];
    const aliveNodes: Node[] = [];
    for (const c of this._monstersContainer.children) {
      const sp = c.getComponent(Sprite);
      (sp && sp.isDeadBody ? deadNodes : aliveNodes).push(c);
    }
    this._monstersContainer.children = [...deadNodes, ...aliveNodes];

    // Clean up nodes for monsters that were removed
    this._monsterNodes.forEach((node, id) => {
      if (!activeIds.has(id)) {
        node.destroy();
        this._monsterNodes.delete(id);
      }
    });
  }
}

// ============================================
//  系统初始化 & 启动
// ============================================
window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
  
  preloadAssets(() => {
    console.log('All assets preloaded successfully!');
    
    // 0. Register badge system
    registerAllBadges();

    // 1. Initialize Cocos-like Director
    canvas.width = 1280;
    canvas.height = 590;
    director.init(canvas);

    // Utility: apply scale+translate to a DOM element
    function applyTransform(el: HTMLElement | null, baseW: number, baseH: number, scale: number, ox: number, oy: number) {
      if (!el) return;
      el.style.position = 'absolute';
      el.style.left = '0';
      el.style.top = '0';
      el.style.width = `${baseW}px`;
      el.style.height = `${baseH}px`;
      el.style.transform = `translate(${ox}px, ${oy}px) scale(${scale})`;
      el.style.transformOrigin = 'top left';
    }

    // Dynamic UI scaling to fill viewport
    function resizeUI() {
      const baseWidth = 2556;
      const baseHeight = 1179;
      
      const isPortrait = window.innerHeight > window.innerWidth;
      const vw = isPortrait ? window.innerHeight : window.innerWidth;
      const vh = isPortrait ? window.innerWidth : window.innerHeight;

      const scale = Math.min(vw / baseWidth, vh / baseHeight);
      const offsetX = (vw - baseWidth * scale) / 2;
      const offsetY = (vh - baseHeight * scale) / 2;

      applyTransform(document.getElementById('gameBg'), baseWidth, baseHeight, scale, offsetX, offsetY);
      applyTransform(document.getElementById('uiOverlay'), baseWidth, baseHeight, scale, offsetX, offsetY);
      applyTransform(canvas, baseWidth, baseHeight, scale, offsetX, offsetY);
      applyTransform(document.getElementById('battleBgLayer'), baseWidth, baseHeight, scale, offsetX, offsetY);
      applyTransform(document.getElementById('battleGroundLayer'), baseWidth, baseHeight, scale, offsetX, offsetY);
    }
    window.addEventListener('resize', resizeUI);
    resizeUI();

    // Expose systems to window for debugging
    (window as any).gameEngine = gameEngine;
    (window as any).battleSystem = battleSystem;
    (window as any).uiManager = uiManager;
    (window as any).director = director;
    (window as any).vfx = vfx;
    (window as any).net = networkManager;

    // Auto-connect to WebSocket server
    const isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (isDev) {
      networkManager.connect('ws://localhost:3001');
    } else {
      const wsProtocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
      networkManager.connect(`${wsProtocol}${location.host}/ws`);
    }

    // 2. Add BoardSyncComponent to root scene tree
    const boardNode = new Node('BattlefieldBoard');
    boardNode.addComponent(BoardSyncComponent);
    director.rootNode.addChild(boardNode);

    // 3. Initialize HTML UI Manager
    uiManager.init('uiOverlay');

    // 4. Lock landscape orientation
    lockOrientation();

    // 5. Start Director run loop
    director.startLoop();
  });
});
export { loadedImages };

/** 锁定屏幕方向为横屏，若浏览器不支持 API 则静默失败 */
function lockOrientation(): void {
  const orientation = screen.orientation as any;
  if (orientation && orientation.lock) {
    orientation.lock('landscape').catch(() => {});
  }
}

/** 请求全屏（需用户手势触发），隐藏浏览器 UI 和状态栏。iOS 不支持，静默跳过 */
export function requestFullscreen(): void {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (isIOS) return;
  const el = document.documentElement;
  if (el.requestFullscreen) {
    el.requestFullscreen().catch(() => {});
  } else if ((el as any).webkitRequestFullscreen) {
    (el as any).webkitRequestFullscreen();
  }
}
