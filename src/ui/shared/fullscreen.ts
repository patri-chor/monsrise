// ============================================
//  全屏工具 — 从 main.ts 抽出独立模块，
//  切断 main ↔ TeamEditorUI 的循环导入（TDZ 隐患）
// ============================================

/** 是否为 iOS 设备（含 iPadOS 13+ "请求桌面网站" 伪装成 Mac 的情况） */
export function isIOSDevice(): boolean {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ 桌面模式 UA 为 Macintosh，但支持多点触控
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

/** 请求全屏（需用户手势触发），隐藏浏览器 UI 和状态栏。iOS 不支持，静默跳过 */
export function requestFullscreen(): void {
  if (isIOSDevice()) return;
  try {
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    if (el.requestFullscreen) {
      el.requestFullscreen().catch(() => {});
    } else if (el.webkitRequestFullscreen) {
      el.webkitRequestFullscreen();
    }
  } catch (e) {
    console.warn('requestFullscreen failed:', e);
  }
}
