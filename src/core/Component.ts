import { Node } from './Node';

export class Component {
  public node!: Node;
  public enabled: boolean = true;

  public onLoad(): void {}
  public start(): void {}
  public update(_dt: number): void {}
  public onDestroy(): void {}
}
