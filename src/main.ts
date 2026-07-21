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

// Preloader for image assets
const ASSETS_TO_LOAD = {
  spritesheet: 'all.png',
  ground: 'ground.png',
  bench: 'bench.png',
  editorBg: 'editor.png',
  detailsBg: 'details.png',
  readyBtn: 'complete.png'
};

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

// Cocos-like BoardSyncComponent to manage canvas board rendering
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
      if (m.isDead && !(m as any).resurrecting) continue;
      
      activeIds.add(m.id);

      // Determine fog of war hiding: only hide monsters placed in the current round
      const hide = (m.placedRound === gameEngine.currentRound) && ((isP1 && m.gridX >= 6) || (isP2 && m.gridX < 5));

      let mNode = this._monsterNodes.get(m.id);
      if (!mNode) {
        // Create new Node for monster
        mNode = new Node(`Monster_${m.id}`);
        const sprite = mNode.addComponent(Sprite);
        
        // Setup sprite texture coordinate clipping
        sprite.setSprite(
          loadedImages.spritesheet,
          m.data.sx,
          m.data.sy,
          m.data.sw,
          m.data.sh,
          m.data.sw,
          m.data.sh
        );
        
        // Melee facing P1 (faces right) or P2 (faces left) with 0.8 scale to fit cell
        mNode.scaleX = (m.gridX >= 6) ? -0.8 : 0.8;
        mNode.scaleY = 0.8;

        this._monstersContainer.addChild(mNode);
        this._monsterNodes.set(m.id, mNode);
      }

      // Update active state based on fog of war and noSprite status
      mNode.active = !hide && !(m as any).noSprite;

      // Update position and flip scaleX dynamically
      if (isBattle) {
        // Use smooth interpolated positions from BattleSystem during combat
        const smoothPos = battleSystem.screenPositions.get(m.id);
        const targetPos = (battleSystem as any)._targetPositions.get(m.id);
        if (smoothPos) {
          mNode.position = { x: smoothPos.x, y: smoothPos.y };
        }

        if ((m as any)._chargeDir !== undefined) {
          // 冲锋朝向：强制锁定冲锋方向
          mNode.scaleX = (m as any)._chargeDir === 1 ? 0.8 : -0.8;
        } else if (smoothPos && targetPos && Math.abs(targetPos.x - smoothPos.x) > 1) {
          // Face the direction of active movement
          mNode.scaleX = (targetPos.x > smoothPos.x) ? 0.8 : -0.8;
        } else {
          // Face the closest enemy
          const enemy = (battleSystem as any).findClosestEnemy(m);
          if (enemy) {
            mNode.scaleX = (enemy.gridX > m.gridX) ? 0.8 : -0.8;
          } else {
            mNode.scaleX = (m.team === 1) ? 0.8 : -0.8;
          }
        }

        // Skill rotation（肃清哥、见习骑士：反方向蓄力 + 加速减速一圈）
        if (state === 'BATTLE' && (m as any)._rotationDuration && (m as any)._rotationRemaining > 0) {
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
        mNode.position = { x: gridPos.x, y: gridPos.y };
        mNode.scaleX = (m.team === 2) ? -0.8 : 0.8;
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
      }
    }

    // Clean up nodes for monsters that were removed
    this._monsterNodes.forEach((node, id) => {
      if (!activeIds.has(id)) {
        node.destroy();
        this._monsterNodes.delete(id);
      }
    });
  }
}

// Start Game Entry Point
window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
  
  preloadAssets(() => {
    console.log('All assets preloaded successfully!');
    
    // 0. Register badge system
    registerAllBadges();

    // 1. Initialize Cocos-like Director
    canvas.width = 2556;
    canvas.height = 1179;
    director.init(canvas);

    // Dynamic UI scaling to fill viewport in lockstep with stretched background (Uniform scale & Center)
    function resizeUI() {
      const uiOverlay = document.getElementById('uiOverlay');
      const baseWidth = 2556;
      const baseHeight = 1179;
      
      // 竖屏时 CSS 旋转了容器，宽高应互换来计算 scale
      const isPortrait = window.innerHeight > window.innerWidth;
      const vw = isPortrait ? window.innerHeight : window.innerWidth;
      const vh = isPortrait ? window.innerWidth : window.innerHeight;

      const scale = Math.min(vw / baseWidth, vh / baseHeight);
      const offsetX = (vw - baseWidth * scale) / 2;
      const offsetY = (vh - baseHeight * scale) / 2;
      
      const gameBg = document.getElementById('gameBg');
      if (gameBg) {
        gameBg.style.position = 'absolute';
        gameBg.style.left = '0';
        gameBg.style.top = '0';
        gameBg.style.width = `${baseWidth}px`;
        gameBg.style.height = `${baseHeight}px`;
        gameBg.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
        gameBg.style.transformOrigin = 'top left';
      }

      if (uiOverlay) {
        uiOverlay.style.position = 'absolute';
        uiOverlay.style.left = '0';
        uiOverlay.style.top = '0';
        uiOverlay.style.width = `${baseWidth}px`;
        uiOverlay.style.height = `${baseHeight}px`;
        uiOverlay.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
        uiOverlay.style.transformOrigin = 'top left';
      }
      
      if (canvas) {
        canvas.style.position = 'absolute';
        canvas.style.left = '0';
        canvas.style.top = '0';
        canvas.style.width = `${baseWidth}px`;
        canvas.style.height = `${baseHeight}px`;
        canvas.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
        canvas.style.transformOrigin = 'top left';
      }
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
      // 根据页面协议自动选择 ws:// 或 wss://
      const wsProtocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
      networkManager.connect(`${wsProtocol}${location.host}/ws`);
    }

    // 2. Add BoardSyncComponent to root scene tree
    const boardNode = new Node('BattlefieldBoard');
    boardNode.addComponent(BoardSyncComponent);
    director.rootNode.addChild(boardNode);

    // 3. Initialize HTML UI Manager
    uiManager.init('uiOverlay');

    // 4. Start Director run loop
    director.startLoop();
  });
});
export { loadedImages };
