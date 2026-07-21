import { Component } from './Component';
import { gameEngine } from '../game/GameEngine';

export class Sprite extends Component {
  /** 静态绘制模式：all=全画，imageOnly=仅贴图，hudOnly=仅血条/HUD */
  public static drawMode: 'all' | 'imageOnly' | 'hudOnly' = 'all';

  public image: HTMLImageElement | null = null;
  public sx: number = 0;
  public sy: number = 0;
  public sw: number = 0;
  public sh: number = 0;
  public width: number = 0;
  public height: number = 0;
  public anchorX: number = 0.5;
  public anchorY: number = 0.5;

  public flashTime: number = 0;
  public flashDuration: number = 0.15;

  public deepStealth: boolean = false;
  public team: number = 1;

  public hp: number | null = null;
  public maxHp: number = 0;
  public shield: number = 0;
  public skillCdProgress: number = 0;
  public skillCd: number = 0;
  public statusEffects: any[] = [];
  public isGhost: boolean = false;
  /** stealth 状态下的半透明度（0 全透明 ~ 1 不透明），undefined 表示无 stealth */
  public stealthAlpha: number | undefined;

  public update(dt: number): void {
    if (this.flashTime > 0) {
      this.flashTime -= dt;
      if (this.flashTime < 0) this.flashTime = 0;
    }
  }

  public setSprite(
    img: HTMLImageElement,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    width: number = sw,
    height: number = sh
  ) {
    this.image = img;
    this.sx = sx;
    this.sy = sy;
    this.sw = sw;
    this.sh = sh;
    this.width = width;
    this.height = height;
  }

  public draw(ctx: CanvasRenderingContext2D): void {
    if (!this.enabled || !this.image || !this.node.active) return;

    const wPos = this.node.worldPosition;
    
    // Use absolute dimensions for drawImage to prevent browser layout engine errors
    const absW = this.width * Math.abs(this.node.scaleX);
    const absH = this.height * Math.abs(this.node.scaleY);
    
    if (this.deepStealth && Sprite.drawMode !== 'hudOnly') {
      return; // 深层隐身：不渲染贴图，但 hudOnly 轮次仍需画血条
    }
    
    // ---- 贴图层（imageOnly / all 模式绘制） ----
    if (Sprite.drawMode !== 'hudOnly') {
      ctx.save();
      // 半透明优先级：stealth > ghost
      if (this.stealthAlpha !== undefined) {
        ctx.globalAlpha = this.stealthAlpha;
      } else if (this.isGhost) {
        ctx.globalAlpha = 0.4;
      }
      
      // Translate context to center of node
      ctx.translate(wPos.x, wPos.y);
      
      // Safely apply horizontal and vertical flips via canvas API scale
      const scaleX = this.node.scaleX < 0 ? -1 : 1;
      const scaleY = this.node.scaleY < 0 ? -1 : 1;
      if (scaleX !== 1 || scaleY !== 1) {
        ctx.scale(scaleX, scaleY);
      }

      if (this.node.rotation !== 0) {
        ctx.rotate((this.node.rotation * Math.PI) / 180);
      }
      
      // Compute rendering offset based on anchor point
      const dx = -absW * this.anchorX;
      const dy = -absH * this.anchorY;

      if (this.sw > 0 && this.sh > 0) {
        ctx.drawImage(
          this.image,
          this.sx,
          this.sy,
          this.sw,
          this.sh,
          dx,
          dy,
          absW,
          absH
        );
      } else {
        ctx.drawImage(this.image, dx, dy, absW, absH);
      }

      if (this.flashTime > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1.0, this.flashTime / this.flashDuration)})`;
        ctx.fillRect(dx, dy, absW, absH);
        ctx.restore();
      }
      ctx.restore();
    }

    // ---- HUD 层（hudOnly / all 模式绘制） ----
    if (Sprite.drawMode !== 'imageOnly') {
      if (this.hp !== null && !this.isGhost) {
        // Draw HP Bar
        const barW = 50;
        const barH = 8;
        const hx = wPos.x - barW / 2;
        const hy = wPos.y - absH * this.anchorY - 5 + 47;
        
        // HP Bar BG
        ctx.fillStyle = '#000';
        ctx.fillRect(hx, hy, barW, barH);
        ctx.strokeStyle = '#5a5a5a';
        ctx.lineWidth = 1;
        ctx.strokeRect(hx, hy, barW, barH);
        
        // HP Bar Fill
        const pct = Math.max(0, Math.min(1, this.hp / this.maxHp));
        const flip = gameEngine.mode === 'online' && !gameEngine.isOnlineHost;
        const ownGreen = flip ? this.team === 2 : this.team === 1;
        ctx.fillStyle = ownGreen ? '#5ac54f' : '#ff3333';
        ctx.fillRect(hx + 1, hy + 1, (barW - 2) * pct, barH - 2);

        // Skill CD
        if (this.skillCd > 0) {
          const skillY = hy + barH;
          ctx.fillStyle = '#000';
          ctx.fillRect(hx, skillY, barW, 4);
          ctx.strokeRect(hx, skillY, barW, 4);
          const sPct = Math.max(0, Math.min(1, this.skillCdProgress / this.skillCd));
          ctx.fillStyle = '#ffd700';
          ctx.fillRect(hx + 1, skillY + 1, (barW - 2) * sPct, 2);
        }
        
        // Shield
        if (this.shield > 0) {
          ctx.fillStyle = '#0d2d52';
          ctx.strokeStyle = '#4ba3e3';
          ctx.lineWidth = 1;
          ctx.fillRect(hx + barW + 2, hy, 32, 24);
          ctx.strokeRect(hx + barW + 2, hy, 32, 24);
          ctx.fillStyle = '#7dd4ff';
          ctx.font = `20px 'Press Start 2P', 'Zpix', monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(this.shield.toString(), hx + barW + 2 + 16, hy + 12);
        }

        // Status Effects
        if (this.statusEffects && this.statusEffects.length > 0) {
          const uniqueEffects = this.statusEffects.filter((effect, idx, self) =>
            self.findIndex(e => e.type === effect.type) === idx
          );
          let iconX = hx;
          const iconY = hy - 16;
          ctx.font = `14px Arial`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          for (const effect of uniqueEffects) {
            let symbol = '';
            if (effect.type === 'poison') symbol = '🦠';
            else if (effect.type === 'bleed') symbol = '🩸';
            else if (effect.type === 'burn') symbol = '🔥';
            else if (effect.type === 'stun') symbol = '⚡️';
            else if (effect.type === 'chill') symbol = '❄️';
            else if (effect.type === 'invincible') symbol = '🛡️';
            
            if (symbol) {
               ctx.fillStyle = '#000';
               ctx.fillText(symbol, iconX + 1, iconY + 1);
               ctx.fillText(symbol, iconX, iconY);
               iconX += 16;
            }
          }
        }
      }
    }
  }
}
