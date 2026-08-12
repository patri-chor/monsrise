/**
 * 音乐管理器 — 大厅 / 战斗音乐的后台预载与自动切换
 * - 曲目后台预载，不阻塞游戏启动与载入进度条（含 14.7MB 的 Hymn）
 * - 大厅开场曲固定为 HymnToTheSea：预载完成后立即播放（iOS 需手势解锁），播完后进入随机循环
 * - iOS 自动播放限制：首次播放必须由用户手势触发（点"开始游戏"按钮时 unlock）
 * - 支持音量步进控制（0 / 20% / ... / 100%），供右上角声音按钮调用
 */

/** 大厅音乐：第 1 首为开场曲（Hymn），其余随机循环 */
const LOBBY_SONGS = [
  'HymnToTheSea.mp3',
  'M500002ifrG84P76Ly.mp3',
  'Cuchulainn.mp3',
];

/** 战斗音乐（循环播放） */
const BATTLE_SONGS = [
  'SpiritOfTheWild.mp3',
];

/** 战斗相关状态：进入即切换到战斗音乐 */
const BATTLE_STATES = ['PREPARATION_LEFT', 'PREPARATION_RIGHT', 'BATTLE', 'REPLAY'];

type MusicZone = 'lobby' | 'battle' | 'none';

class MusicManager {
  private static readonly VOLUME_KEY = 'monsterRise_volume';

  private _tracks: { zone: MusicZone; audio: HTMLAudioElement }[] = [];
  private _current: HTMLAudioElement | null = null;
  private _zone: MusicZone = 'none';
  private _unlocked = false;
  private _lobbyFirstDone = false; // 开场曲（Hymn）是否已播放过，之后大厅走随机
  private _volume = 1;

  /** 后台预载所有曲目（幂等，不阻塞游戏启动）。
   *  仅 Hymn 全量预载；其余曲目只取元数据、播放时才流式下载，
   *  避免 iOS Safari 同时下载/解码 30MB+ 音频导致内存崩溃。 */
  public preload(): void {
    this._restoreVolume();
    if (this._tracks.length > 0) return;
    const make = (zone: MusicZone, name: string, loop: boolean, level: 'auto' | 'metadata') => {
      const audio = new Audio();
      audio.preload = level;
      audio.loop = loop;
      audio.volume = this._volume;
      audio.src = `music/${name}`;
      // 大厅曲播完自动切下一首（随机）；开场曲 Hymn 播完后同样进入随机循环
      if (zone === 'lobby') {
        audio.addEventListener('ended', () => {
          if (this._zone !== 'lobby') return;
          this._startTrack(this._pickLobbyIndex());
        });
      }
      this._tracks.push({ zone, audio });
    };
    // 开场曲 Hymn 全量预载；其他大厅曲与战斗曲仅元数据（播放时才下载）
    LOBBY_SONGS.forEach((n, i) => make('lobby', n, false, i === 0 ? 'auto' : 'metadata'));
    BATTLE_SONGS.forEach(n => make('battle', n, true, 'metadata'));

    // 开场曲（Hymn = _tracks[0]）加载完成后立即尝试播放：
    // 桌面浏览器直接开始；iOS 无手势时 play() 被拒，回滚后等 unlock 重试
    // 注意：若 Hymn 已被 loader 预载（浏览器缓存命中），readyState 可能已就绪、事件不会再触发，需主动检查
    const hymn = this._tracks[0].audio;
    const tryPlayHymn = () => {
      if (this._current) return;
      this._startTrack(0);
    };
    if (hymn.readyState >= 2) {
      tryPlayHymn();
    } else {
      hymn.addEventListener('loadeddata', tryPlayHymn);
    }
  }

  /** 用户首次手势（点"开始游戏"）时调用，解锁 iOS 自动播放限制 */
  public unlock(): void {
    if (this._unlocked) return;
    this._unlocked = true;
    // 桌面可能已在播 Hymn；未在播则从开场曲开始
    if (this._current) return;
    if (isIOSDevice()) {
      // iOS：点击手势后稍作缓冲再播放（避开贴图上屏那一帧），
      // 真机确认崩溃源于队伍面板动画，音乐本身无碍，故只需很小的延迟
      window.setTimeout(() => {
        if (this._unlocked && !this._current) this._startTrack(this._pickLobbyIndex());
      }, 900);
    } else {
      this._startTrack(this._pickLobbyIndex());
    }
  }

  public playLobby(): void {
    if (!this._unlocked || this._zone === 'lobby') return;
    this._startTrack(this._pickLobbyIndex());
  }

  public playBattle(): void {
    if (!this._unlocked || this._zone === 'battle') return;
    this._startTrack(this._tracks.findIndex(t => t.zone === 'battle'));
  }

  public stop(): void {
    if (this._current) {
      this._current.pause();
      this._current.currentTime = 0;
    }
    this._current = null;
    this._zone = 'none';
  }

  /** 设置全局音量（0-1），应用到所有曲目（含切歌后），并持久化到 localStorage */
  public setVolume(v: number): void {
    this._volume = Math.max(0, Math.min(1, v));
    this._tracks.forEach(t => { t.audio.volume = this._volume; });
    try {
      localStorage.setItem(MusicManager.VOLUME_KEY, String(this._volume));
    } catch {
      // 隐私模式等场景下 localStorage 不可用，忽略
    }
  }

  public getVolume(): number {
    return this._volume;
  }

  /** 从 localStorage 恢复上次保存的音量设置 */
  private _restoreVolume(): void {
    try {
      const raw = localStorage.getItem(MusicManager.VOLUME_KEY);
      if (raw !== null) {
        const v = Number(raw);
        if (!Number.isNaN(v)) {
          this._volume = Math.max(0, Math.min(1, v));
        }
      }
    } catch {
      // 忽略存储不可用
    }
  }

  /** 根据游戏状态自动切换音乐（幂等：同区域不重复切换） */
  public syncWithState(state: string): void {
    if (!this._unlocked || state === 'OPENING') return;
    if (BATTLE_STATES.includes(state)) this.playBattle();
    else this.playLobby();
  }

  /** 选择下一首大厅曲：开场曲未播放过时固定 Hymn；之后随机（排除当前曲） */
  private _pickLobbyIndex(): number {
    if (!this._lobbyFirstDone) {
      this._lobbyFirstDone = true;
      return 0;
    }
    const curIdx = this._current ? this._tracks.findIndex(t => t.audio === this._current) : -1;
    const options = this._tracks
      .map((t, i) => ({ t, i }))
      .filter(x => x.t.zone === 'lobby' && x.i !== curIdx);
    return options[Math.floor(Math.random() * options.length)].i;
  }

  private _startTrack(index: number): void {
    if (index < 0 || index >= this._tracks.length) return;
    const { zone, audio } = this._tracks[index];
    if (this._current && this._current !== audio) {
      this._current.pause();
      this._current.currentTime = 0;
    }
    this._current = audio;
    this._zone = zone;
    const p = audio.play();
    if (p) p.catch(() => {
      // iOS 自动播放被拒或音频未就绪：回滚状态，等待下次触发
      this._current = null;
      this._zone = 'none';
    });
  }
}

/** 是否为 iOS 设备（含 iPadOS 13+ "请求桌面网站" 伪装成 Mac 的情况） */
function isIOSDevice(): boolean {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ 桌面模式 UA 为 Macintosh，但支持多点触控
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

/** 全局单例音乐管理器 */
export const music = new MusicManager();
