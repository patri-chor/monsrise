import { Node } from './Node';
import { Sprite } from './Sprite';
import { vfx } from '../game/VfxManager';
import { uiManager } from '../ui/UIManager';
import { gameEngine } from '../game/GameEngine';

export class Director {
  private static _instance: Director | null = null;

  public static get instance(): Director {
    if (!Director._instance) {
      Director._instance = new Director();
    }
    return Director._instance;
  }

  public canvas!: HTMLCanvasElement;
  public ctx!: CanvasRenderingContext2D;
  public rootNode: Node = new Node('Root');

  /** 战斗倍速（1x/2x/3x），默认 1 */
  public timeScale: number = 1;
  /** 随倍速缩放累计的游戏时间（ms），贴图序列帧动画用它保证与战斗逻辑同速 */
  public elapsedGameTime: number = 0;

  private _isRunning: boolean = false;
  private _lastTime: number = 0;
  private _animationFrameId: number = 0;
  private _accumulator: number = 0;

  private constructor() {}

  public init(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not get 2D context from canvas');
    }
    this.ctx = context;
    // Set default image rendering to pixelated for retro feel
    this.ctx.imageSmoothingEnabled = false;
    this._lastTime = performance.now();
  }

  public startLoop(): void {
    if (this._isRunning) return;

    // 防御：Vite dev 下模块可能被重复实例化（HMR `?t=`/`?v=` 缓存参数）导致
    // 多个 Director 各起一个 rAF 主循环 → dt 每帧累加两遍 → 战斗双倍速。
    // 保证整个页面只有一个主循环在跑（通过 window 共享标记，跨模块副本有效）。
    const win = window as any;
    if (win.__monsrise_active_director__ && win.__monsrise_active_director__ !== this) {
      try { win.__monsrise_active_director__.stopLoop(); } catch { /* ignore */ }
    }
    win.__monsrise_active_director__ = this;

    this._isRunning = true;
    this._lastTime = performance.now();
    this._animationFrameId = requestAnimationFrame(this.loop.bind(this));
  }

  public stopLoop(): void {
    this._isRunning = false;
    cancelAnimationFrame(this._animationFrameId);
    const win = window as any;
    if (win.__monsrise_active_director__ === this) {
      win.__monsrise_active_director__ = null;
    }
  }

  public loop(timestamp: number): void {
    if (!this._isRunning) return;

    // 全局帧号：供 BoardSyncComponent 做"每帧 battleSystem 只更新一次"的去重
    const win = window as any;
    win.__monsrise_frame_id__ = (win.__monsrise_frame_id__ || 0) + 1;

    let dt = (timestamp - this._lastTime) / 1000;
    // Cap dt to prevent massive jumps during lag spikes
    if (dt > 0.1) dt = 0.1;
    this._lastTime = timestamp;

    // 纯 DOM 界面（开始界面/队伍编辑/联机大厅）下 canvas 无可绘制内容：
    // 跳过逻辑更新与渲染，只保留 rAF 心跳——避免 iOS 上长时间停留队伍界面时
    // 每帧全量重绘 2556×1179 大 canvas 的持续 GPU/内存压力（触发 Safari 杀页刷新）
    const domOnly = gameEngine.state === 'OPENING' || gameEngine.state === 'TEAM_EDIT' || gameEngine.state === 'MATCH_LOBBY';
    if (domOnly) {
      this._accumulator = 0; // 丢弃停留期间累积的时间，防止切回战斗时一次性回补
      this._animationFrameId = requestAnimationFrame(this.loop.bind(this));
      return;
    }

    // ---- 固定逻辑步长（fixed-step）：战斗逻辑恒按 FIXED_DT 积分，消除显示器帧率
    // 对战斗结果的影响（60Hz/120Hz/144Hz 下 dt 不同 → 移动/攻击时序分叉 → 同阵容
    // 胜负翻转）。训练沙盒（search.ts BATTLE_DT）与此保持完全一致。
    // timeScale 倍速（1x/2x/3x）仍生效：每逻辑步 scaledDt = FIXED_DT * timeScale。
    this._accumulator += dt;
    const FIXED_DT = 0.04; // 25 帧/秒
    const scaledStep = FIXED_DT * this.timeScale;
    let steps = 0;
    while (this._accumulator >= FIXED_DT && steps < 8) {
      // 1. Update logic（rootNode → BoardSyncComponent → battleSystem.update(FIXED_DT*scale)）
      this.rootNode.updateNode(scaledStep);
      // 2. Update VFX particles and float texts（战斗逻辑同一步长，保证弹幕/粒子与战斗同步）
      vfx.update(scaledStep);
      this.elapsedGameTime += scaledStep * 1000;
      this._accumulator -= FIXED_DT;
      steps++;
    }
    // 极端掉帧：丢弃积压，避免死亡螺旋
    if (this._accumulator > FIXED_DT * 4) this._accumulator = 0;

    // 3. Update DOM UI layers (like HP bar translations) —— UI 仍随渲染帧走，不累积
    uiManager.update();

    // 4. Render
    this.render();

    this._animationFrameId = requestAnimationFrame(this.loop.bind(this));
  }

  private render(): void {
    // Clear canvas（使用内部分辨率，在 scale 之前）
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // 设计分辨率 → Canvas 内部分辨率映射（2556/2556=1, 1179/1179=1，1:1 保证文字锐利）
    const sx = this.canvas.width / 2556;
    const sy = this.canvas.height / 1179;
    this.ctx.save();
    this.ctx.scale(sx, sy);

    // 第 -1 层：背景粒子（献祭火焰等，在怪物之下）
    vfx.drawBackground(this.ctx);

    // 第 0 层：怪物贴图
    Sprite.drawMode = 'imageOnly';
    this.drawNode(this.rootNode);

    // 第 1 层：粒子 + 子弹（在怪物之上）
    vfx.draw(this.ctx);

    // 第 2 层：血条 + HUD（在粒子之上）
    Sprite.drawMode = 'hudOnly';
    this.drawNode(this.rootNode);

    // 第 3 层：飘字（最顶层）
    vfx.drawFloatingTexts(this.ctx);

    // 重置模式
    Sprite.drawMode = 'all';

    this.ctx.restore();
  }

  private drawNode(node: Node): void {
    if (!node.active || node.isDestroyed) return;

    // Draw sprite if exists
    const sprite = node.getComponent(Sprite);
    if (sprite) {
      sprite.draw(this.ctx);
    }

    // Call any custom render functions if custom systems need to draw on top of node
    for (const child of node.children) {
      this.drawNode(child);
    }
  }
}
export const director = Director.instance;

