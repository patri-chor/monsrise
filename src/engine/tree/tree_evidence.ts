import * as fs from 'node:fs';
import * as path from 'node:path';

export class TreeEvidence {
  public static ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  public static writeJson(filePath: string, data: any): void {
    TreeEvidence.ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  public static writeJsonl(filePath: string, records: any[]): void {
    TreeEvidence.ensureDir(path.dirname(filePath));
    const content = records.map(r => JSON.stringify(r)).join('\n');
    fs.writeFileSync(filePath, content ? content + '\n' : '', 'utf-8');
  }

  public static appendJsonl(filePath: string, record: any): void {
    TreeEvidence.ensureDir(path.dirname(filePath));
    fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf-8');
  }
}
