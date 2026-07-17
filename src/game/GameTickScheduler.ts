export interface ScheduledTask {
  id: string;
  callback: () => void;
  delay: number;     // Remaining delay (in seconds)
  interval: number;  // Interval duration (in seconds, 0 if one-shot)
  elapsed: number;   // Accumulated elapsed time for interval checks
}

export class GameTickScheduler {
  private _tasks: Map<string, ScheduledTask> = new Map();
  private _taskIdCounter: number = 0;

  public schedule(callback: () => void, delaySeconds: number, key?: string): string {
    const id = key || `task_${this._taskIdCounter++}`;
    this._tasks.set(id, {
      id,
      callback,
      delay: delaySeconds,
      interval: 0,
      elapsed: 0
    });
    return id;
  }

  public scheduleInterval(callback: () => void, intervalSeconds: number, key?: string): string {
    const id = key || `task_${this._taskIdCounter++}`;
    this._tasks.set(id, {
      id,
      callback,
      delay: intervalSeconds,
      interval: intervalSeconds,
      elapsed: 0
    });
    return id;
  }

  public unschedule(id: string): void {
    this._tasks.delete(id);
  }

  public has(id: string): boolean {
    return this._tasks.has(id);
  }

  public clear(): void {
    this._tasks.clear();
    this._taskIdCounter = 0;
  }

  public update(dt: number): void {
    const tasksToProcess = Array.from(this._tasks.values());
    for (const task of tasksToProcess) {
      if (!this._tasks.has(task.id)) continue;

      if (task.interval > 0) {
        task.elapsed += dt;
        while (task.elapsed >= task.interval) {
          task.elapsed -= task.interval;
          task.callback();
          if (!this._tasks.has(task.id)) break;
        }
      } else {
        task.delay -= dt;
        if (task.delay <= 0) {
          this._tasks.delete(task.id);
          task.callback();
        }
      }
    }
  }
}
