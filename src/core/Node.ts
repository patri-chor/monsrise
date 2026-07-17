import { Component } from './Component';

export class Node {
  public name: string;
  public parent: Node | null = null;
  public children: Node[] = [];
  public components: Component[] = [];
  
  public x: number = 0;
  public y: number = 0;
  public scaleX: number = 1;
  public scaleY: number = 1;
  public rotation: number = 0; // in degrees
  public active: boolean = true;
  
  private _isDestroyed: boolean = false;
  private _started: boolean = false;

  constructor(name: string = 'New Node') {
    this.name = name;
  }

  public get isDestroyed(): boolean {
    return this._isDestroyed;
  }

  // Position helpers
  public get position(): { x: number; y: number } {
    return { x: this.x, y: this.y };
  }

  public set position(val: { x: number; y: number }) {
    this.x = val.x;
    this.y = val.y;
  }

  // World position calculation
  public get worldPosition(): { x: number; y: number } {
    if (this.parent) {
      const pWorld = this.parent.worldPosition;
      return {
        x: pWorld.x + this.x * this.parent.scaleX,
        y: pWorld.y + this.y * this.parent.scaleY
      };
    }
    return { x: this.x, y: this.y };
  }

  // Child management
  public addChild(child: Node): void {
    if (child.parent) {
      child.parent.removeChild(child);
    }
    child.parent = this;
    this.children.push(child);
  }

  public removeChild(child: Node): void {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parent = null;
    }
  }

  // Component management
  public addComponent<T extends Component>(componentClass: new () => T): T {
    const comp = new componentClass();
    comp.node = this;
    this.components.push(comp);
    comp.onLoad();
    return comp;
  }

  public getComponent<T extends Component>(componentClass: new () => T): T | null {
    for (const comp of this.components) {
      if (comp instanceof componentClass) {
        return comp as T;
      }
    }
    return null;
  }

  public getComponents<T extends Component>(componentClass: new () => T): T[] {
    return this.components.filter(comp => comp instanceof componentClass) as T[];
  }

  // Update loop
  public updateNode(dt: number): void {
    if (!this.active || this._isDestroyed) return;

    // Call start on components if not yet started
    if (!this._started) {
      for (const comp of this.components) {
        if (comp.enabled) {
          comp.start();
        }
      }
      this._started = true;
    }

    // Update components
    for (const comp of this.components) {
      if (comp.enabled) {
        comp.update(dt);
      }
    }

    // Update children
    // Slice to avoid issues if children are added/removed during update
    const currentChildren = this.children.slice();
    for (const child of currentChildren) {
      child.updateNode(dt);
    }
  }

  // Destroy node and all its children/components
  public destroy(): void {
    if (this._isDestroyed) return;
    this._isDestroyed = true;
    this.active = false;

    // Destroy children
    for (const child of this.children) {
      child.destroy();
    }
    this.children = [];

    // Destroy components
    for (const comp of this.components) {
      comp.onDestroy();
    }
    this.components = [];

    // Remove from parent
    if (this.parent) {
      this.parent.removeChild(this);
    }
  }
}
