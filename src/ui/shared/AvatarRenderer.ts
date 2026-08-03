/**
 * 根据头像列表中索引渲染头像 HTML。
 * 头像精灵图 head.png 每格 32×32，按 4×4 排列（共 16 个）。
 */
export function renderAvatarHtml(avatarIndex: number, frameClass: 'p1-frame' | 'p2-frame', size: number = 135, flipH: boolean = false, extraStyle: string = ''): string {
  const col = avatarIndex % 4;
  const row = Math.floor(avatarIndex / 4);
  const sx = col * 32;
  const sy = row * 31;
  const scale = size / 32;
  return `
    <div class="player-avatar-frame ${frameClass}" style="display: flex; justify-content: center; align-items: center; overflow: hidden; position: relative; ${extraStyle}">
      <div style="
        position: absolute;
        left: 50%;
        top: 50%;
        width: 32px;
        height: 32px;
        background-image: url('head.png');
        background-position: -${sx}px -${sy}px;
        background-repeat: no-repeat;
        transform: translate(-50%, -50%) scale(${scale})${flipH ? ' scaleX(-1)' : ''};
        transform-origin: center;
        image-rendering: pixelated;
        image-rendering: crisp-edges;
      "></div>
    </div>
  `;
}
