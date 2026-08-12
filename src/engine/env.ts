// ============================================================
// Node 无头环境桩 — 服务器训练不需要浏览器 API
// 必须在任何 game 模块之前 import（副作用安装，同 tests/mock_setup）
// ============================================================

const envStore: Record<string, string> = {};

function installLocalStorage(): void {
  if ((globalThis as any).localStorage) return;
  (globalThis as any).localStorage = {
    getItem: (key: string) => envStore[key] ?? null,
    setItem: (key: string, value: string) => { envStore[key] = value; },
    removeItem: (key: string) => { delete envStore[key]; },
    clear: () => { for (const k in envStore) delete envStore[k]; },
    key: () => null,
    length: 0,
  };
}

function installImage(): void {
  if ((globalThis as any).Image) return;
  (globalThis as any).Image = class {
    src = '';
    onload: any = null;
  };
}

function installWindow(): void {
  // 部分战斗代码直接引用全局 window（如 (window as any).vfx?.xx）
  // 在 Node 中把 window 指回 globalThis，配合可选链安全降级为 no-op
  if (!(globalThis as any).window) {
    (globalThis as any).window = globalThis;
  }
}

installLocalStorage();
installImage();
installWindow();
