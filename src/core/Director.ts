import { Node } from './Node';
import { Sprite } from './Sprite';
import { vfx } from '../game/VfxManager';
import { uiManager } from '../ui/UIManager';

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
  
  private _isRunning: boolean = false;
  private _lastTime: number = 0;
  private _animationFrameId: number = 0;

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
    this._isRunning = true;
    this._lastTime = performance.now();
    this._animationFrameId = requestAnimationFrame(this.loop.bind(this));
  }

  public stopLoop(): void {
    this._isRunning = false;
    cancelAnimationFrame(this._animationFrameId);
  }

  private loop(timestamp: number): void {
    if (!this._isRunning) return;

    let dt = (timestamp - this._lastTime) / 1000;
    // Cap dt to prevent massive jumps during lag spikes
    if (dt > 0.1) dt = 0.1;
    this._lastTime = timestamp;

    // 1. Update logic
    this.rootNode.updateNode(dt);

    // 2. Update VFX particles and float texts
    vfx.update(dt);

    // 3. Update DOM UI layers (like HP bar translations)
    uiManager.update();

    // 4. Render
    this.render();

    this._animationFrameId = requestAnimationFrame(this.loop.bind(this));
  }

  private render(): void {
    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

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

