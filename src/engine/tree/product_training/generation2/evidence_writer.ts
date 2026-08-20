import { appendFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export class EvidenceWriter {
  private static outDir = resolve('reports/tree-cycle');

  private static ensureDir(): void {
    if (!existsSync(this.outDir)) {
      mkdirSync(this.outDir, { recursive: true });
    }
  }

  public static writeJson(filename: string, data: any): void {
    this.ensureDir();
    const filePath = resolve(this.outDir, filename);
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  public static writeJsonl(filename: string, records: any[]): void {
    this.ensureDir();
    const filePath = resolve(this.outDir, filename);
    const content = records.map(r => JSON.stringify(r)).join('\n') + (records.length > 0 ? '\n' : '');
    writeFileSync(filePath, content, 'utf8');
  }

  public static appendJsonl(filename: string, record: any): void {
    this.ensureDir();
    const filePath = resolve(this.outDir, filename);
    appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf8');
  }
}
