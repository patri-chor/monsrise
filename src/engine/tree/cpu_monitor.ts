// ============================================================
// CPU 负载监控与自适应动态节流器 (CPU Monitor & Adaptive Throttler)
//
// 目的：
//   - 动态采样系统 CPU 占用率，防止 100% 打死系统或 CPU 负载过低
//   - 维持系统在约 80% 的黄金负载区间，动态调节并发任务派发窗口 (In-flight Limit)
// ============================================================

import { cpus } from 'node:os';

export interface CpuUsageStats {
  idle: number;
  total: number;
  usageRatio: number; // 0.0 ~ 1.0 (例如 0.80 表示 80%)
}

export class CpuLoadMonitor {
  private lastStats: { idle: number; total: number } | null = null;
  private currentUsage: number = 0;
  private targetUsage: number;
  private sampleIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;

  constructor(targetUsage: number = 0.80, sampleIntervalMs: number = 200) {
    this.targetUsage = targetUsage;
    this.sampleIntervalMs = sampleIntervalMs;
    this.sample(); // 初始采样
  }

  /** 获取当前多核总 idle 与 total ticks */
  private getSnapshot(): { idle: number; total: number } {
    const cpuList = cpus();
    let idle = 0;
    let total = 0;
    for (const cpu of cpuList) {
      for (const type in cpu.times) {
        total += (cpu.times as any)[type];
      }
      idle += cpu.times.idle;
    }
    return { idle, total };
  }

  /** 执行一次即时采样并计算使用率 */
  public sample(): number {
    const snap = this.getSnapshot();
    if (!this.lastStats) {
      this.lastStats = snap;
      this.currentUsage = 0.5; // 初始假设 50%
      return this.currentUsage;
    }

    const idleDelta = snap.idle - this.lastStats.idle;
    const totalDelta = snap.total - this.lastStats.total;
    this.lastStats = snap;

    if (totalDelta <= 0) return this.currentUsage;

    const idleRatio = idleDelta / totalDelta;
    this.currentUsage = Math.max(0, Math.min(1, 1 - idleRatio));
    return this.currentUsage;
  }

  /** 开启后台定时轮询采样 */
  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.sample();
    }, this.sampleIntervalMs);
    // 避免阻止进程正常退出
    if (this.timer.unref) this.timer.unref();
  }

  /** 停止后台监控 */
  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 获取当前估算的 CPU 占用率 (0.0 ~ 1.0) */
  public getUsage(): number {
    return this.currentUsage;
  }

  /**
   * 自适应调节：根据当前 CPU 占用率调节并发任务上限 (In-flight Concurrency)
   * @param currentLimit 当前并发上限
   * @param minLimit 最小并发数 (例如 8)
   * @param maxLimit 最大并发数 (例如 64 或 128)
   */
  public adaptConcurrency(currentLimit: number, minLimit: number = 8, maxLimit: number = 64): number {
    const usage = this.sample();
    const error = this.targetUsage - usage; // >0 表示负载偏低需要增加，<0 表示负载偏高需要收缩

    let newLimit = currentLimit;
    if (error > 0.10) {
      // 负载明显偏低 (<70%)，积极扩容
      newLimit += Math.ceil(currentLimit * 0.25) || 2;
    } else if (error > 0.03) {
      // 负载略微偏低 (70%~77%)，平缓微调
      newLimit += 2;
    } else if (error < -0.10) {
      // 负载过高 (>90%)，快速收缩保护
      newLimit -= Math.ceil(currentLimit * 0.20) || 2;
    } else if (error < -0.05) {
      // 负载略高 (85%~90%)，微调收缩
      newLimit -= 2;
    }

    return Math.max(minLimit, Math.min(maxLimit, newLimit));
  }
}
