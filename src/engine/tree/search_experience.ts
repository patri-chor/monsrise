// ============================================================
// 搜索经验库（search experience bank）
//
// 目的：持久化搜索中发现的「结构上完全不可用」的候选修改，
//   避免爬山 / 自分支在后续轮回里反复构造、验证、评估同样的无效候选。
//
// 记录哪些"完全不可用"的操作：
//   - 跨回合重复怪（placeMonster 拒绝同队重复）
//   - 四费怪在 R4/R5 上场（费用曲线约束）
//   - 特殊/瞄准怪位置改动（位置由计算器决定，树坐标无效）
//   - 前后排越界（moveWithinZone 的 role 合法列约束）
//   - 单替换后整树非法（validateEvol 失败）
//
// 与评估缓存不同：这些「无效」是结构性、与种子/对手无关的，
// 因此可以安全地跨轮回持久化复用；而评估结果（胜率）依赖种子，不做持久化。
//
// key 格式（必须含阵型 id，避免不同阵型同名节点串扰；用英文编码，避免中文乱码）：
//   replace:{阵型id}:{nodeId}:{from}->{to}
//   move:{阵型id}:{nodeId}:{monsterId}->({x},{y})
// ============================================================

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ExperienceEntry {
  key: string;
  reason: string;
  foundAt: string;
}

export interface ExperienceFile {
  type: 'search_experience';
  entries: ExperienceEntry[];
}

const defaultPath = () => resolve('reports/search_experience.json');

export class ExperienceBank {
  private invalid = new Map<string, { reason: string; foundAt: string }>(); // key -> 详情
  private path: string;

  constructor(path?: string) {
    this.path = path ?? defaultPath();
  }

  /** 从磁盘加载经验库（不存在则空） */
  load(): void {
    this.invalid.clear();
    if (!existsSync(this.path)) return;
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as ExperienceFile;
      for (const e of raw.entries ?? []) {
        this.invalid.set(e.key, { reason: e.reason, foundAt: e.foundAt ?? '' });
      }
    } catch (e) {
      console.warn(`[经验库] 加载失败（忽略，从空开始）: ${(e as Error).message}`);
    }
  }

  /** 保存到磁盘 */
  save(): void {
    const entries: ExperienceEntry[] = [...this.invalid.entries()]
      .map(([key, v]) => ({ key, reason: v.reason, foundAt: v.foundAt }))
      .sort((a, b) => a.key.localeCompare(b.key));
    const file: ExperienceFile = { type: 'search_experience', entries };
    try {
      writeFileSync(this.path, JSON.stringify(file, null, 2));
    } catch (e) {
      console.warn(`[经验库] 保存失败: ${(e as Error).message}`);
    }
  }

  /** 该操作是否已知无效 */
  isKnownInvalid(key: string): boolean {
    return this.invalid.has(key);
  }

  /** 记录一个无效操作（不覆盖已有记录） */
  markInvalid(key: string, reason: string): void {
    if (!this.invalid.has(key)) {
      this.invalid.set(key, { reason, foundAt: new Date().toISOString() });
    }
  }

  /** 当前已记录的无效操作数 */
  get size(): number {
    return this.invalid.size;
  }

  /** 无效原因（调试用） */
  reasonOf(key: string): string | undefined {
    return this.invalid.get(key)?.reason;
  }
}

/** 单替换操作的 key（英文编码，formation 传英文 id） */
export function replaceKey(formationId: string, nodeId: string, from: number, to: number): string {
  return `replace:${formationId}:${nodeId}:${from}->${to}`;
}

/** 位置移动操作的 key（英文编码，formation 传英文 id） */
export function moveKey(formationId: string, nodeId: string, monsterId: number, x: number, y: number): string {
  return `move:${formationId}:${nodeId}:${monsterId}->(${x},${y})`;
}
