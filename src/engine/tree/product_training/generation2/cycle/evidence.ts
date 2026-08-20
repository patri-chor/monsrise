import * as fs from 'node:fs';
import * as path from 'node:path';

export class CycleEvidence {
  public static ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  public static writeJson(filePath: string, data: any): void {
    const dir = path.dirname(filePath);
    this.ensureDir(dir);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  public static writeJsonl(filePath: string, items: any[]): void {
    const dir = path.dirname(filePath);
    this.ensureDir(dir);
    const content = items.map(i => JSON.stringify(i)).join('\n') + (items.length > 0 ? '\n' : '');
    fs.writeFileSync(filePath, content, 'utf-8');
  }
}
