export type Language = 'zh' | 'en';

class LanguageManager {
  private static _instance: LanguageManager | null = null;
  public static get instance(): LanguageManager {
    if (!LanguageManager._instance) {
      LanguageManager._instance = new LanguageManager();
    }
    return LanguageManager._instance;
  }

  private _currentLanguage: Language = 'zh';

  private constructor() {
    const saved = localStorage.getItem('monsrise_lang');
    if (saved === 'zh' || saved === 'en') {
      this._currentLanguage = saved;
    }
  }

  public get currentLanguage(): Language {
    return this._currentLanguage;
  }

  public setLanguage(lang: Language): void {
    if (this._currentLanguage !== lang) {
      this._currentLanguage = lang;
      localStorage.setItem('monsrise_lang', lang);
    }
  }
}

export const languageManager = LanguageManager.instance;

export function t(zh: string, en: string): string {
  return languageManager.currentLanguage === 'zh' ? zh : en;
}
