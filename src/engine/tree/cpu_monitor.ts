// ============================================================
// CPU 负载监控与自适应动态节流器 (CPU Monitor & Adaptive Throttler)
// ============================================================

import { cpus } from 'node:os';

export class CpuLoadMonitor {
  private lastStats: { idle: number; total: number } | null = null;
  private currentUsage: number = 0;
  private targetUsage: number;
  private sampleIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;

  constructor(targetUsage: number = 0.80, sampleIntervalMs: number = 200) {
    this.targetUsage = targetUsage;
    this.sampleIntervalMs = sampleIntervalMs;
    this.sample();
  }

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

  public sample(): number {
    const snap = this.getSnapshot();
    if (!this.lastStats) {
      this.lastStats = snap;
      this.currentUsage = 0.5;
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

  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.sample();
    }, this.sampleIntervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public getUsage(): number {
    return this.currentUsage;
  }

  public adaptConcurrency(currentLimit: number, minLimit: number = 8, maxLimit: number = 64): number {
    const usage = this.sample();
    const error = this.targetUsage - usage;

    let newLimit = currentLimit;
    if (error > 0.10) {
      newLimit += Math.ceil(currentLimit * 0.25) || 2;
    } else if (error > 0.03) {
      newLimit += 2;
    } else if (error < -0.10) {
      newLimit -= Math.ceil(currentLimit * 0.20) || 2;
    } else if (error < -0.05) {
      newLimit -= 2;
    }

    return Math.max(minLimit, Math.min(maxLimit, newLimit));
  }
}
