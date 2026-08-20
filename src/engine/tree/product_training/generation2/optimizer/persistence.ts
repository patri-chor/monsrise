import * as fs from 'node:fs';
import * as path from 'node:path';

export class Persistence {
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

  public static appendJsonl(filePath: string, items: any[]): void {
    if (items.length === 0) return;
    const dir = path.dirname(filePath);
    this.ensureDir(dir);
    const content = items.map(i => JSON.stringify(i)).join('\n') + '\n';
    fs.appendFileSync(filePath, content, 'utf-8');
  }

  public static readJson<T>(filePath: string): T | null {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  }

  public static readJsonl<T>(filePath: string): T[] {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf-8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => JSON.parse(line) as T);
  }
}
