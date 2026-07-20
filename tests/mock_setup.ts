const store: Record<string, string> = {};
globalThis.localStorage = {
  getItem: (key: string) => store[key] || null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { for (const k in store) delete store[k]; },
  length: 0,
  key: (_index: number) => null,
} as any;
(global as any).localStorage = globalThis.localStorage;

globalThis.Image = class {
  src = '';
  onload: any = null;
} as any;
(global as any).Image = globalThis.Image;
