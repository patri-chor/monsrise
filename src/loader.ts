/**
 * 载入模块 — 与游戏逻辑解耦
 * 负责：关键资源预载 → 进度条更新 → 载入层隐藏（含超时兜底）
 * 独立成模块是为了防止 main.ts 被合并/覆盖时载入层逻辑丢失（会导致永久卡在载入界面）。
 * 保险起见，index.html 中还内置了一条 15 秒强制隐藏的兜底脚本。
 */

/** 开屏 / 队伍编辑界面会立即用到的关键资源（点击"开始游戏"时已全部缓存，避免 iOS Safari 加载卡顿/崩溃） */
const CRITICAL_IMAGES = [
  'all.png',
  'badge.png',
  'background/sky.webp',
  'background/yun1.png',
  'background/yun2.png',
  'background/yun3.png',
  'background/yun4.png',
  'background/ship.png',
  'background/start.png',
  'edite/bg.png',
  'edite/set.png',
  'edite/tab1.png',
  'edite/tab2.png',
  'edite/inner.png',
  'edite/switch.png',
  'edite/detail.png',
  'edite/UI2.png',
  'edite/b1.png',
  'edite/b2.png',
  'edite/b3.png',
  'edite/txtbox.png',
  'edite/scroll.png',
  'edite/netp.png',
  'edite/net.png',
  'fight/bg.png',
];

/** 需要提前就绪的像素字体（zpix.ttf 约 6.8MB，必须在载入界面期间加载完） */
const CRITICAL_FONTS = ['Zpix'];

/** 开场音乐（Hymn，14.7MB）：在载入界面阶段就预载，点击"开始游戏"时立即可播。
 *  注意：iOS Safari 无用户手势时可能只加载元数据，播放时才补下载，故预载带超时不阻塞进度。 */
const CRITICAL_AUDIO = [
  'music/HymnToTheSea.mp3',
];

export const loadedImages: Record<string, HTMLImageElement> = {};

let _loadDoneCount = 0;
const _loadTotal = CRITICAL_IMAGES.length + CRITICAL_FONTS.length + CRITICAL_AUDIO.length;
let _finished = false;

function updateLoadingProgress(): void {
  _loadDoneCount = Math.min(_loadDoneCount + 1, _loadTotal);
  const pct = Math.floor((_loadDoneCount / _loadTotal) * 100);
  const fill = document.getElementById('loadingBarFill');
  const text = document.getElementById('loadingText');
  if (fill) fill.style.width = `${pct}%`;
  if (text) text.textContent = `加载中 ${pct}%`;
}

function hideLoadingOverlay(): void {
  const overlay = document.getElementById('loadingOverlay');
  if (!overlay) return;
  overlay.classList.add('done');
  // 等淡出动画结束再移除，避免残留遮挡点击
  window.setTimeout(() => overlay.remove(), 700);
}

function preloadImages(urls: string[], onItemDone: () => void): Promise<void> {
  return new Promise<void>(resolve => {
    if (urls.length === 0) {
      resolve();
      return;
    }
    // 限制并发解码数量，降低 iOS Safari 内存峰值（一次性并发 24 张图容易触发崩溃刷新）
    const CONCURRENCY = 4;
    let next = 0;
    let done = 0;
    const finish = () => {
      done++;
      onItemDone();
      if (done === urls.length) {
        resolve();
      } else {
        startNext();
      }
    };
    const startNext = () => {
      if (next >= urls.length) return;
      const url = urls[next++];
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        loadedImages[url] = img;
        finish();
      };
      img.onerror = () => {
        console.error(`Failed to load asset: ${url}`);
        finish();
      };
      img.src = url;
    };
    for (let i = 0; i < Math.min(CONCURRENCY, urls.length); i++) {
      startNext();
    }
  });
}

function preloadFonts(onItemDone: () => void): Promise<void> {
  const fonts = (document as any).fonts as FontFaceSet | undefined;
  if (!fonts || typeof fonts.load !== 'function') {
    CRITICAL_FONTS.forEach(onItemDone);
    return Promise.resolve();
  }
  return Promise.all(
    CRITICAL_FONTS.map(family =>
      fonts.load(`400 10px "${family}"`)
        .then(onItemDone)
        .catch(() => { console.warn(`Failed to load font: ${family}`); onItemDone(); })
    )
  ).then(() => {});
}

/**
 * 预载音频到浏览器缓存（点击"开始游戏"时无需再等待下载）。
 * iOS Safari 无手势时可能不触发 canplay，故每项带 8 秒超时兜底，绝不阻塞载入进度。
 */
function preloadAudio(urls: string[], onItemDone: () => void): Promise<void> {
  return new Promise<void>(resolve => {
    if (urls.length === 0) {
      resolve();
      return;
    }
    let done = 0;
    const finish = () => {
      done++;
      onItemDone();
      if (done === urls.length) resolve();
    };
    urls.forEach(url => {
      const audio = new Audio();
      audio.preload = 'auto';
      audio.src = url;
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        finish();
      };
      audio.addEventListener('canplay', settle, { once: true });
      audio.addEventListener('error', () => {
        console.error(`Failed to load audio: ${url}`);
        settle();
      }, { once: true });
      // iOS 无手势时 canplay 可能不触发，超时兜底
      window.setTimeout(settle, 8000);
    });
  });
}

/**
 * 预载关键资源并更新载入进度，完成后隐藏载入层。
 * - 自带 12 秒超时兜底：弱网/字体卡住也一定 resolve，绝不永久阻塞
 * - 幂等：重复调用只执行一次
 */
/** 是否为 iOS 设备（含 iPadOS 13+ "请求桌面网站" 伪装成 Mac 的情况） */
function isIOSDevice(): boolean {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

export function preloadAll(): Promise<void> {
  if (_finished) return Promise.resolve();

  // iOS 低功耗模式：标记后 CSS 会禁用云/船等装饰动画，
  // 避免多动画层叠加导致 iOS Safari 合成器崩溃（预加载救不了渲染层数量）
  if (isIOSDevice()) {
    document.body.classList.add('is-ios');
  }

  const failSafe = window.setTimeout(() => {
    _finished = true;
    hideLoadingOverlay();
  }, 12000);

  return Promise.all([
    preloadImages(CRITICAL_IMAGES, updateLoadingProgress),
    preloadFonts(updateLoadingProgress),
    preloadAudio(CRITICAL_AUDIO, updateLoadingProgress),
  ]).then(() => {
    window.clearTimeout(failSafe);
    _finished = true;
    console.log('All critical assets preloaded successfully!');
    hideLoadingOverlay();
  });
}
