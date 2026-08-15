// ============================================
//  动画计算模块（身体层 + 武器层统一动画）
//  从 main.ts BoardSyncComponent 中迁出的动画逻辑，统一处理：
//  - 关键帧插值
//  - 动画剪辑选择（普通攻击 / 技能）
//  - Lottie comp 坐标 → 游戏本地坐标的单位换算
//  - 无 JSON 剪辑怪兽的兜底摆动动画
//
//  单位约定：
//  - Lottie 中各层 tracks.positions 为 comp 像素（相对本层锚点）
//  - weapon.scale 为百分比（如 6 代表 6%）
//  - weapon.anchor 为武器贴图像素坐标
//  - 游戏内身体显示宽度（displayW，本地 px）与 comp 身体宽度（clip.body.size.x）
//    的比值 k 即为"整体放大系数"：所有长度量（位置、缩放）都乘以 k
// ============================================
import { ANIMATIONS } from './AnimationData';
import type { AnimationClip, Keyframe, LayerTracks, WeaponLayer } from './AnimationData';

export { ANIMATIONS };
export type { AnimationClip, Keyframe, LayerTracks };

export function interpolateKeyframes<T>(keyframes: Keyframe<T>[], currentFrame: number, defaultValue: T): T {
  if (!keyframes || keyframes.length === 0) return defaultValue;
  if (currentFrame <= keyframes[0].t) return keyframes[0].value;
  if (currentFrame >= keyframes[keyframes.length - 1].t) return keyframes[keyframes.length - 1].value;

  for (let i = 0; i < keyframes.length - 1; i++) {
    const kf1 = keyframes[i];
    const kf2 = keyframes[i + 1];
    if (currentFrame >= kf1.t && currentFrame <= kf2.t) {
      const t = (currentFrame - kf1.t) / (kf2.t - kf1.t);
      if (typeof kf1.value === 'number' && typeof kf2.value === 'number') {
        return (kf1.value * (1 - t) + kf2.value * t) as any;
      } else {
        const v1 = kf1.value as { x: number; y: number };
        const v2 = kf2.value as { x: number; y: number };
        return {
          x: v1.x * (1 - t) + v2.x * t,
          y: v1.y * (1 - t) + v2.y * t
        } as any;
      }
    }
  }
  return defaultValue;
}

export interface AnimClipRef {
  clip: AnimationClip;
  key: string;
}

export function getAnimationClip(dbId: number, state: string): AnimClipRef | null {
  if (state === 'skill') {
    const key = `${dbId}s`;
    if (ANIMATIONS[key]) {
      return { clip: ANIMATIONS[key], key };
    }
  }
  const key = String(dbId);
  if (ANIMATIONS[key]) {
    return { clip: ANIMATIONS[key], key };
  }
  return null;
}

/** 攻击峰值时刻缓存（dbId:state → 秒） */
const peakTimeCache = new Map<string, number>();

/**
 * 计算攻击动画中武器水平位移最远的时刻（秒）：
 * - 近战：武器挥到最远点 → 伤害触发时刻
 * - 远程：子弹发射时刻的默认值（可被 AnimTuning.ATTACK_DELAY 覆盖）
 * 取武器 positions 轨道中 |x| 最大的关键帧时刻，找不到则兜底 0.2s。
 */
export function computeAttackPeakTime(dbId: number, state: string): number {
  const key = `${dbId}:${state}`;
  const cached = peakTimeCache.get(key);
  if (cached !== undefined) return cached;

  let peak = 0.2;
  const clip = getAnimationClip(dbId, state)?.clip;
  if (clip) {
    let peakDist = -1;
    let peakT = 0;
    for (const w of clip.weapons) {
      for (const kf of w.tracks.positions) {
        const dist = Math.abs(kf.value.x);
        if (dist > peakDist) {
          peakDist = dist;
          peakT = kf.t;
        }
      }
    }
    if (peakDist >= 0) {
      peak = Math.max(0.05, peakT / 100);
    }
  }
  peakTimeCache.set(key, peak);
  return peak;
}

export interface WeaponPose {
  /** 武器锚点在身体本地坐标系中的位置（本地 px，已按放大系数换算） */
  x: number;
  y: number;
  /** 武器本地旋转角（度，不含朝向目标夹角） */
  rotation: number;
  /** 武器绘制缩放系数（已按放大系数换算） */
  scale: number;
  /** 武器锚点归一化坐标（相对武器贴图尺寸） */
  anchorX: number;
  anchorY: number;
  /** 武器透明度（0~1），用于贴图切换/淡入淡出 */
  opacity: number;
}

export interface BodyPose {
  /** 身体相对节点中心的偏移（本地 px，已按放大系数换算） */
  offsetX: number;
  offsetY: number;
  /** 身体自转角（度） */
  rotation: number;
  /** 身体旋转中心相对节点中心的偏移（本地 px，Lottie body 锚点换算；游戏据此绕真实旋转中心转） */
  rotCenterX: number;
  rotCenterY: number;
}

export interface AnimPose {
  /** 是否使用了 JSON 自定义动画剪辑 */
  usingCustomClip: boolean;
  /** 全部武器层姿态（主武器 + 可选第二武器） */
  weapons: WeaponPose[];
  body: BodyPose;
}

// 从单武器层数据计算姿态（comp → 本地坐标，含放大系数与锚点归一化）
function evalWeaponLayer(
  layer: WeaponLayer,
  k: number,
  refX: number,
  refY: number,
  frame: number,
  targetAngle: number,
  bodyScaleX = 100,
): WeaponPose {
  const posVal = interpolateKeyframes(layer.tracks.positions, frame, { x: 0, y: 0 });
  const rotVal = interpolateKeyframes(layer.tracks.rotations, frame, 0);
  const opVal = interpolateKeyframes(layer.tracks.opacities, frame, 100);
  return {
    x: (posVal.x + refX) * k,
    y: (posVal.y + refY) * k,
    rotation: rotVal + targetAngle,
    // Lottie 缩放是百分比（如 8 代表 8%），乘整体放大系数与身体一起放大；
    // 身体图层可能自带缩放（如救星骑士身体 18%），武器百分比相对"身体显示比例"换算，
    // 需除以 bodyScale 才能与游戏内身体固定显示尺寸保持 SVGator 中一致的比例。
    scale: (layer.scale.x / 100.0) * k / (bodyScaleX / 100.0),
    // 锚点：武器贴图像素坐标 → 归一化（不再依赖 naturalWidth 的加载状态）
    anchorX: layer.anchor.x / (layer.size.x || 1),
    anchorY: layer.anchor.y / (layer.size.y || 1),
    // 透明度 0~100 → 0~1
    opacity: Math.max(0, Math.min(1, opVal / 100)),
  };
}

/**
 * 计算武器与身体的动画姿态。
 * @param clip        当前怪兽的动画剪辑（无 JSON 剪辑时传 null）
 * @param animState   动画状态：attack / skill / 其他
 * @param animTime    动画播放时间（秒）
 * @param displayW    身体显示宽度（本地 px，调用方应传入已含切图缩放的值）
 * @param targetAngle 朝向目标夹角（度），由调用方计算后传入
 * @param isMelee     是否近战（用于兜底动画）
 * @param charTune    切图微调（帧单元像素，CutoutTune.x/y）。
 *                    游戏节点中心=人物中心（=单元格中心-微调），
 *                    而动画 positions 是相对身体锚点的，需要换算。
 */
export function computeWeaponPose(
  clip: AnimationClip | null,
  animState: string,
  animTime: number,
  displayW: number,
  targetAngle: number,
  isMelee: boolean,
  charTune?: { x: number; y: number },
  idlePose: 'hold' | 'aim' = 'hold',
): AnimPose {
  let weapons: WeaponPose[] = [];
  let usingCustomClip = false;
  let bodyOffsetX = 0;
  let bodyOffsetY = 0;
  let bodyLocalAngle = 0;
  let bodyRotCX = 0;
  let bodyRotCY = 0;

  if (clip) {
    const currentFrame = animTime * 100;
    // 攻击/技能超时后的姿态：
    // hold = 回第 0 帧（待机首帧，收刀摆正）；aim = 停最后静止帧（最后关键帧姿态）保持瞄准。
    const frame = currentFrame >= clip.duration ? (idlePose === 'aim' ? clip.duration - 1 : 0) : currentFrame;

    const bt = clip.body.tracks;
    const bPosVal = interpolateKeyframes(bt.positions, frame, { x: 0, y: 0 });
    const bRotVal = interpolateKeyframes(bt.rotations, frame, 0);

    // 整体放大系数：comp 像素 → 游戏本地像素
    const k = displayW / (clip.body.size.x || 40);

    // 锚点基准换算：动画 positions 相对身体锚点，而游戏节点中心=人物中心
    // 人物中心 = 单元格中心(body.size/2) − 切图微调(charTune)
    const cellCX = (clip.body.size.x || 40) / 2;
    const cellCY = (clip.body.size.y || 40) / 2;
    const charCX = cellCX - (charTune?.x ?? 0);
    const charCY = cellCY - (charTune?.y ?? 0);
    const anchorCX = clip.body.anchor?.x ?? cellCX;
    const anchorCY = clip.body.anchor?.y ?? cellCY;
    const refX = anchorCX - charCX; // 锚点→人物中心 的水平偏移
    const refY = anchorCY - charCY; // 锚点→人物中心 的垂直偏移（comp y 向下）

    // 全部武器层（主武器 + 第二/三武器…，数量可变），各自独立计算姿态
    const bodyScaleX = clip.body.scale?.x ?? 100;
    weapons = clip.weapons.map(w => evalWeaponLayer(w, k, refX, refY, frame, targetAngle, bodyScaleX));

    bodyOffsetX = bPosVal.x * k;
    bodyOffsetY = bPosVal.y * k;
    bodyLocalAngle = bRotVal;
    // 身体贴图自转中心 = 身体几何中心（"身体中间"）相对人物中心的偏移（本地 px）。
    // （武器整体瞄准旋转的中心由 main.ts 按 AnimTuning.AIM_ROT_CENTER 控制，不在这里。）
    bodyRotCX = (cellCX - charCX) * k;
    bodyRotCY = (cellCY - charCY) * k;
    usingCustomClip = true;
  } else if (animState === 'attack' || animState === 'skill') {
    // 兜底动画：尚未制作 JSON 动画剪辑的怪兽（默认按自然尺寸绘制武器）
    const totalDuration = 0.3;
    const time = animTime || 0;
    const progress = Math.min(1.0, time / totalDuration);

    let localX = 0;
    let localAngle = 0;
    if (isMelee) {
      if (progress < 0.5) {
        const t = progress / 0.5;
        localX = t * 15;
        localAngle = t * 20;
      } else {
        const t = (progress - 0.5) / 0.5;
        localX = 15 - t * 15;
        localAngle = 20 - t * 20;
      }
    } else {
      if (progress < 0.3) {
        const t = progress / 0.3;
        localX = -t * 8;
        localAngle = -t * 10;
      } else {
        const t = (progress - 0.3) / 0.7;
        localX = -8 + t * 8;
        localAngle = -10 + t * 10;
      }
    }
    weapons = [{
      x: localX,
      y: 0,
      rotation: localAngle + targetAngle,
      scale: 1.0,
      anchorX: 0.5,
      anchorY: 0.5,
      opacity: 1,
    }];
  }

  return {
    usingCustomClip,
    weapons,
    body: {
      offsetX: bodyOffsetX,
      offsetY: bodyOffsetY,
      rotation: bodyLocalAngle,
      rotCenterX: bodyRotCX,
      rotCenterY: bodyRotCY,
    },
  };
}
