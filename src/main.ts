// ============================================
//  入口文件 — 资源预加载 → UI 缩放 → 系统初始化 → 启动
// ============================================
import './style.css';
import { director } from './core/Director';
import { Node } from './core/Node';
import { Sprite } from './core/Sprite';
import { Component } from './core/Component';
import { gameEngine } from './game/GameEngine';
import { battleSystem } from './game/BattleSystem';
import { gridToScreen } from './game/Database';
import { uiManager } from './ui/UIManager';
import { vfx } from './game/VfxManager';
import { registerAllBadges } from './game/BadgeSystem';
import { networkManager } from './net/NetworkManager';
import { computeWeaponPose, getAnimationClip } from './game/animation/AnimationAnimator';
import { getCutoutTune, AIM_IDLE_WEAPONS, FRAME_SIZES, MUZZLE_TUNE, WEAPON_ROT_LIMIT, GUN_ROT_CENTER_ANCHOR } from './game/animation/AnimTuning';
import { music } from './game/MusicManager';
import { preloadAll, loadedImages } from './loader';

const frameImages = new Map<number, HTMLImageElement>();
function getFrameImage(dbId: number): HTMLImageElement {
  let img = frameImages.get(dbId);
  if (!img) {
    img = new Image();
    img.decoding = 'async';
    img.src = `frames/${dbId}.png`;
    frameImages.set(dbId, img);
  }
  return img;
}

const weaponImages = new Map<string, HTMLImageElement>();
/**
 * 获取武器贴图。所有武器统一按 `{dbId}-{序号}.png` 命名（108-1、108-2…），
 * 每个武器逻辑完全一致；仅第一个武器在 `-1` 贴图缺失时回退旧的无序号 `{dbId}.png`。
 */
function getWeaponImage(weaponKey: string, fallback?: string): HTMLImageElement {
  let img = weaponImages.get(weaponKey);
  if (!img) {
    img = new Image();
    const primarySrc = `weapons/${weaponKey}.png`;
    img.src = primarySrc;
    if (fallback) {
      img.onerror = () => {
        const fbSrc = `weapons/${fallback}.png`;
        if (img && img.src !== fbSrc) img.src = fbSrc;
      };
    }
    weaponImages.set(weaponKey, img);
  }
  return img;
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
        // 防御：同一帧 battleSystem 只更新一次（防止重复挂载/重复求值导致战斗双倍速）
        const win = window as any;
        const fid = win.__monsrise_frame_id__ || 0;
        if (win.__monsrise_last_battle_frame__ !== fid) {
          win.__monsrise_last_battle_frame__ = fid;
          battleSystem.update(_dt);
        }
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

      // ==== 1. 累计武器/身体动画播放时间 (weaponAnimTime) ====
      // 非战斗阶段（ROUND_END / PREPARATION / GAME_OVER）强制待机姿态：
      // 回合结束时技能动画可能仍在播，若不重置会顺延到下一回合继续播放。
      const animPlayable = (state === 'BATTLE' || isReplayCombat) && !m.isDead;
      const animState = animPlayable ? m.state : 'idle';
      if (animState === 'attack' || animState === 'skill') {
        // attack 状态会跨整个攻速间隔持续保持，第 2 次及以后的普攻不会触发状态切换，
        // 仅靠状态切换重置会导致武器动画时间超过 duration 被强制回第 0 帧（看起来没动画）。
        // 轮式攻击（段式攻击，BURST_CONFIG：救星打 2 下/突突突 4 下/钻头 10 下…）：
        // 一轮内多次打击只重播一次动画，重播信号 = 轮次序号 roundIndex = floor(攻击次数/每轮次数)；
        // 非轮式怪每轮次数=1，roundIndex=攻击次数，行为与原来一致。
        const attackCount = (m as any).animAttackCount || 0;
        const burstCount = (m as any).burstCount || 0;
        const roundIndex = burstCount > 1 ? Math.floor(attackCount / burstCount) : attackCount;
        if ((m as any)._lastAnimState !== animState || (m as any)._lastRoundIndex !== roundIndex) {
          if (animState === 'skill') {
            // 技能：状态切换即真实事件，从第 0 帧播放技能动画
            (m as any).weaponAnimTime = 0;
          } else {
            const realAttack = (m as any)._lastRoundIndex !== undefined && (m as any)._lastRoundIndex !== roundIndex;
            if (realAttack) {
              // 新一轮攻击开始：重播一轮挥击动画（一轮内的后续打击不重播）
              (m as any).weaponAnimTime = 0;
            } else {
              // 仅进入攻击状态（如开局即在射程内）但尚无真实攻击：
              // 武器动画停在待机帧（时间=一个完整时长 → 帧回绕到 0 待机），
              // 避免"开局先打一下"的假挥击；走位入射程的立即攻击会同步递增计数触发重播。
              const clipRef = getAnimationClip(m.dbId, animState);
              (m as any).weaponAnimTime = clipRef ? clipRef.clip.duration / 100 : 0.3;
            }
          }
          (m as any)._lastAnimState = animState;
          (m as any)._lastRoundIndex = roundIndex;
        }
        if (!gameEngine.isReplayPaused) {
          (m as any).weaponAnimTime = ((m as any).weaponAnimTime || 0) + _dt;
        }
      } else {
        (m as any).weaponAnimTime = 0;
        (m as any)._lastAnimState = animState;
        (m as any)._lastRoundIndex = (m as any).animAttackCount || 0;
      }

      // ==== 2. 提前计算身体的相对动作偏移量与旋转自转 ====
      // 切图微调：人物在单元格内的位置偏差修正（帧像素→本地像素在 setSprite 处应用）
      const tune = getCutoutTune(m.dbId);
      // 帧单元尺寸（切图每个单元的大小；特殊尺寸怪兽见 FRAME_SIZES）
      const sizeConfig = FRAME_SIZES[m.dbId] || { fw: 40, fh: 40 };
      const fw = sizeConfig.fw;
      const fh = sizeConfig.fh;
      const displayW = m.data.sw * tune.scale;
      // 显示高度按单元宽高比推导（源单元与显示矩形等比），避免 m.data.sh（旧静态图裁切高）
      // 与单元比例不一致时把人物压扁（如 104 散弹哥 sh=180 ≠ 单元正方形）。
      const displayH = displayW * (fh / fw);
      const isMelee = m.data.type === 'melee';

      // 单位换算 + 姿态计算（body 部分；targetAngle 在下方瞄准计算后再加到武器旋转上）
      // idlePose：攻击间隔期武器姿态（aim=一直瞄准停最后静止帧 / hold=回待机首帧摆正）
      const idlePose = AIM_IDLE_WEAPONS.has(m.dbId) ? 'aim' : 'hold';
      const pose = computeWeaponPose(
        !m.isDead ? (getAnimationClip(m.dbId, animState)?.clip ?? null) : null,
        animState,
        (m as any).weaponAnimTime || 0,
        displayW,
        0,
        isMelee,
        tune,
        idlePose,
        GUN_ROT_CENTER_ANCHOR.has(m.dbId)
      );

      const bodyOffsetX = pose.body.offsetX;
      const bodyOffsetY = pose.body.offsetY;
      const bodyLocalAngle = pose.body.rotation;
      const isUsingCustomAnim = pose.usingCustomClip;

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
          const finalBodyOffsetX = mNode.scaleX < 0 ? -bodyOffsetX : bodyOffsetX;
          mNode.position = { x: smoothPos.x + finalBodyOffsetX, y: smoothPos.y + dy - 20 + bodyOffsetY };
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
          // 冲锋朝向：强制锁定冲锋方向（dir=1 向右 → 面向右）
          mNode.scaleX = (m as any)._chargeDir === 1 ? baseScale : -baseScale;
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
        } else if (isBattle && !m.isDead && isUsingCustomAnim) {
          // 身体自转不旋转节点整体：Lottie 中身体层独立绕锚点旋转、武器层不随之旋转，
          // 因此身体自转改由 Sprite.bodyRotation（绕 pose.body.rotCenter）单独绘制。
          mNode.rotation = 0;
        } else {
          mNode.rotation = 0;
        }
      } else {
        // Use grid cell center positions during prep
        const gridPos = gridToScreen(m.gridX, m.gridY);
        mNode.scaleX = (m.team === 2) ? -baseScale : baseScale;
        mNode.scaleY = baseScale;
        mNode.rotation = 0;
        const finalBodyOffsetX = mNode.scaleX < 0 ? -bodyOffsetX : bodyOffsetX;
        mNode.position = { x: gridPos.x + finalBodyOffsetX, y: gridPos.y + dy - 20 + bodyOffsetY };
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

        let sx = 0;
        let sy = 0;
        let isDeadBody = false;
        if (m.isDead) {
          sy = fh * 2;
          sx = 0;
          isDeadBody = true;
        } else {
          // 用 animState（非战斗阶段强制 idle）而非 m.state：
          // 防止上一回合残留的 'walk' 状态在布阵阶段继续播放行走序列帧
          if (animState === 'walk') {
            sy = fh;
            const frameIndex = Math.floor(director.elapsedGameTime / 100) % 8;
            sx = frameIndex * fw;
          } else {
            sy = 0;
            const speed = (animState === 'attack' || animState === 'skill') ? 60 : 120;
            const frameIndex = Math.floor(director.elapsedGameTime / speed) % 8;
            sx = frameIndex * fw;
          }
        }
        sprite.isDeadBody = isDeadBody;
        sprite.setSprite(frameImg, sx, sy, fw, fh, displayW, displayH);
        // 切图微调：人物在单元格内的偏移修正（帧单元像素 → 本地像素）
        sprite.offsetX = tune.x * (displayW / fw);
        sprite.offsetY = tune.y * (displayH / fh);

        // 身体自转：绕 Lottie 身体锚点旋转（Sprite 内部只旋转身体贴图，武器不随之旋转）。
        // 肃清哥旋转/忍小猴蓄力倾斜由节点整体旋转负责，此时不再叠加身体自转。
        const spinActive = (m as any)._rotationRemaining > 0;
        const tiltActive = (m as any)._tiltTotal > 0;
        sprite.bodyRotation = (isBattle && !m.isDead && isUsingCustomAnim && !spinActive && !tiltActive) ? bodyLocalAngle : 0;
        sprite.bodyRotCenterX = pose.body.rotCenterX;
        sprite.bodyRotCenterY = pose.body.rotCenterY;

        // ==== 3. 统一在身体 Sprite 上同步武器参数进行拼装绘制 ====
        const hasWeapon = !m.isDead && m.dbId !== 126;

        if (hasWeapon) {
          // 武器朝向：
          // - 所有技能动画不需要朝向敌人（左右翻转即可），只播动画自身旋转
          //   （例外：散弹哥 104 技能是散弹射击，需要跟随瞄准角）
          // - 法杖角色（学徒 102 / 祈祷 103 / 祭祀 105）普攻也不用朝向
          const noTargetRotate = (animState === 'skill' && m.dbId !== 104) || (animState === 'attack' && (m.dbId === 102 || m.dbId === 103 || m.dbId === 105));

          // 6. 大旋转计算：面对敌人的夹角旋转
          let targetAngle = 0;
          const targetId = (m as any).currentTargetId;
          const targetMonster = (battleSystem as any)._monsters.find((x: any) => x.id === targetId);

          if (targetMonster && (animState === 'attack' || animState === 'skill')) {
            // 间隔期武器姿态：hold 时仅在动画播放中瞄准（间隔期武器摆正不歪），
            // aim（枪炮类）时间隔期也持续瞄准目标。
            const clipRef2 = getAnimationClip(m.dbId, animState);
            const animDuration = clipRef2 ? clipRef2.clip.duration / 100 : 0.3;
            const animPlaying = (m as any).weaponAnimTime < animDuration;
            if (idlePose === 'aim' || animPlaying) {
              const targetPos = battleSystem.screenPositions.get(targetId);
              const smoothPos = battleSystem.screenPositions.get(m.id);

              if (targetPos && smoothPos) {
                const dx = targetPos.x - smoothPos.x;
                const dy = targetPos.y - smoothPos.y;
                const globalAngle = Math.atan2(dy, dx) * 180 / Math.PI;

                if (mNode.scaleX < 0) {
                  targetAngle = -(globalAngle - 180);
                } else {
                  targetAngle = globalAngle;
                }

                // 大型武器（守卫者之剑 112 / 铲土人 115）：动画近似平面运动，
                // 限制瞄准倾斜角（WEAPON_ROT_LIMIT，度），避免武器大角度倾斜。
                const rotLimit = WEAPON_ROT_LIMIT[m.dbId];
                if (rotLimit !== undefined) {
                  targetAngle = Math.max(-rotLimit, Math.min(rotLimit, targetAngle));
                }
              }
            }
          }

          // 7. 把所有武器层（主武器 + 第二/三武器…）写入身体 Sprite 内部进行嵌套渲染。
          //    每个武器逻辑一致：贴图统一按 {dbId}-1 / {dbId}-2 / {dbId}-3 … 序号映射，
          //    数量由动画数据 weapons 数组决定；第一个武器在 -1 贴图缺失时回退 {dbId}.png。
          //    武器"位置 + 贴图"一起绕节点中心旋转瞄准角 targetAngle：
          //    这样动画位移（后坐力前后、出拳前后）的方向也跟随武器朝向，而不是沿身体水平 x 轴。
          const baseWeaponKey = String(m.dbId);
          const rotA = (targetAngle * Math.PI) / 180;
          const rotCa = Math.cos(rotA);
          const rotSa = Math.sin(rotA);
          const applyRot = (wx: number, wy: number) =>
            noTargetRotate
              ? { x: wx, y: wy }
              : { x: wx * rotCa - wy * rotSa, y: wx * rotSa + wy * rotCa };
          sprite.weapons = pose.weapons.map((w, i) => {
            const rp = applyRot(w.x, w.y);
            return {
              image: getWeaponImage(`${baseWeaponKey}-${i + 1}`, i === 0 ? baseWeaponKey : undefined),
              x: rp.x,
              y: rp.y,
              rotation: noTargetRotate ? w.rotation : w.rotation + targetAngle,
              scale: w.scale,
              anchorX: w.anchorX,
              anchorY: w.anchorY,
              opacity: w.opacity,
            };
          });

          // 武器枪口世界坐标：供战斗层远程子弹从动画枪口发射（跟随武器位置）
          if (pose.weapons.length > 0) {
            const w0 = pose.weapons[0];
            const flipX = mNode.scaleX < 0 ? -1 : 1;
            // 枪口 = 武器锚点 + (dx, dy) 武器本地偏移，一起随武器旋转绕锚点转动。
            // 旋转角度必须与渲染一致（含瞄准角 targetAngle），否则枪口不跟随枪的朝向。
            const mt = MUZZLE_TUNE[m.dbId] || { dx: 0, dy: 0 };
            const weaponAngle = noTargetRotate ? w0.rotation : w0.rotation + targetAngle;
            const r = (weaponAngle * Math.PI) / 180;
            const cr = Math.cos(r);
            const sr = Math.sin(r);
            // 锚点位置与渲染一致：同样绕节点中心旋转瞄准角（后坐力位移方向跟随朝向）
            const rp0 = applyRot(w0.x, w0.y);
            const localX = rp0.x + mt.dx * cr - mt.dy * sr;
            const localY = rp0.y + mt.dx * sr + mt.dy * cr;
            (m as any)._weaponMuzzle = {
              x: mNode.position.x + localX * flipX,
              y: mNode.position.y + localY,
              length: 0, // 枪口伸出量已并入 x，发射点即枪口坐标
            };
          }
        } else {
          sprite.weapons = null;
        }
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
  // 防御：Vite dev 下模块可能被重复求值（HMR `?t=`/`?v=` 缓存参数），
  // 导致整个初始化执行两遍 → boardNode 被挂到同一 rootNode 两次 →
  // battleSystem.update 每帧跑两遍 → 战斗双倍速（准备阶段不调用故正常）。
  // 用 window 标记保证只初始化一次。
  const win = window as any;
  if (win.__monsrise_initialized__) return;
  win.__monsrise_initialized__ = true;

  const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
  
  preloadAll().then(() => {
    console.log('Game booting after assets preloaded!');
    
    // 0. Register badge system
    registerAllBadges();

    // 1. Initialize Cocos-like Director
    // Canvas 内部分辨率与设计分辨率 2556x1179 保持一致（1:1），
    // 避免文字/特效被先 0.5x 光栅化再 CSS 放大 2x 导致模糊
    canvas.width = 2556;
    canvas.height = 1179;
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
    (window as any).music = music;

    // 后台预载音乐（不阻塞游戏启动；iOS 在用户点"开始游戏"后解锁播放）
    music.preload();

    // 右上角声音按钮：音量按 20% 步进循环（100→80→…→0→100），设置持久化在 localStorage
    const VOLUME_STEPS = [1, 0.8, 0.6, 0.4, 0.2, 0];
    const storedStep = VOLUME_STEPS.indexOf(music.getVolume());
    let volumeStep = storedStep >= 0 ? storedStep : 0;
    const soundBtn = document.getElementById('soundToggleBtn');
    const applyVolume = () => {
      music.setVolume(VOLUME_STEPS[volumeStep]);
      if (soundBtn) {
        const pct = Math.round(VOLUME_STEPS[volumeStep] * 100);
        soundBtn.textContent = `${pct === 0 ? '🔇' : pct === 100 ? '🔊' : '🔉'} ${pct}`;
        soundBtn.classList.toggle('muted', pct === 0);
      }
    };
    if (soundBtn) {
      soundBtn.addEventListener('click', () => {
        volumeStep = (volumeStep + 1) % VOLUME_STEPS.length;
        applyVolume();
      });
      applyVolume();
    }

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

/** 锁定屏幕方向为横屏，若浏览器不支持 API 则静默失败（全程 try/catch，iOS 不抛错） */
function lockOrientation(): void {
  try {
    const orientation = (screen as any).orientation;
    if (orientation && typeof orientation.lock === 'function') {
      orientation.lock('landscape').catch(() => {});
    }
  } catch (e) {
    // iOS 等不支持横屏锁定，静默跳过
  }
}
