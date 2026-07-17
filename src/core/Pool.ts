export class Pool<T> {
  private _pool: T[] = [];
  private _ctor: () => T;
  private _reset: (obj: T) => void;

  constructor(ctor: () => T, reset: (obj: T) => void) {
    this._ctor = ctor;
    this._reset = reset;
  }

  public get(): T {
    if (this._pool.length > 0) {
      return this._pool.pop()!;
    }
    return this._ctor();
  }

  public put(obj: T): void {
    this._reset(obj);
    this._pool.push(obj);
  }

  public clear(): void {
    this._pool = [];
  }
}
