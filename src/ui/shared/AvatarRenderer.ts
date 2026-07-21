/**
 * 根据头像列表中索引渲染头像 HTML。
 * 头像精灵图 avatars.png 每格 170×170，按6列排列。
 */
export function renderAvatarHtml(avatarIndex: number, frameClass: 'p1-frame' | 'p2-frame', size: number = 90): string {
  const col = avatarIndex % 6;
  const row = Math.floor(avatarIndex / 6);
  const sx = col * 170;
  const sy = row * 170;
  const scale = size / 170;
  return `
    <div class="player-avatar-frame ${frameClass}" style="display: flex; justify-content: center; align-items: center; overflow: hidden; position: relative;">
      <div style="
        position: absolute;
        left: 50%;
        top: 50%;
        width: 170px;
        height: 170px;
        background-image: url('avatars.png');
        background-position: -${sx}px -${sy}px;
        background-repeat: no-repeat;
        transform: translate(-50%, -50%) scale(${scale});
        transform-origin: center;
        image-rendering: pixelated;
        image-rendering: crisp-edges;
      "></div>
    </div>
  `;
}
