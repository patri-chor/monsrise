// ============================================================
// 训练器：从 collector 的 JSONL 学"候选动作 → 对局胜负"的非线性映射（随机森林）
// 标签 = 多局价值（胜 1 / 负 -1 / 平 0），特征含阵型树意图
// 纯 TS 无依赖：bootstrap + 特征子集 + CART 回归树，确定性种子
// 运行：npx vite-node --script src/engine/train/train.ts <数据路径> [树数] [模型输出路径]
// ============================================================

import fs from 'node:fs';
import path from 'node:path';

export interface RFTreeNode {
  f?: number;  // 分裂特征索引
  t?: number;  // 分裂阈值（<=t 左，>t 右）
  l?: RFTreeNode;
  r?: RFTreeNode;
  v?: number;  // 叶子值（样本均值）
}

export interface RFTree {
  root: RFTreeNode;
}

export interface TrainedModel {
  type: 'rf' | 'linear';
  featureNames: string[];
  // rf 字段
  trees?: RFTree[];
  treesCount?: number;
  maxDepth?: number;
  minSamples?: number;
  featureSubset?: number;
  // linear 字段（兼容旧模型）
  weights?: number[];
  mean?: number[];
  std?: number[];
  lambda?: number;
  // 通用
  sampleCount: number;
  mse: number;
  corr: number;
  trainedAt: string;
}

function mulberry32(seed: number): () => number {
  let t = seed + 0x6D2B79F5;
  return () => {
    t += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Sample {
  f: number[];
  y: number;
}

function meanY(s: Sample[]): number {
  let sum = 0;
  for (const x of s) sum += x.y;
  return sum / s.length;
}

function varY(s: Sample[]): number {
  if (s.length < 2) return 0;
  const m = meanY(s);
  let sum = 0;
  for (const x of s) sum += (x.y - m) ** 2;
  return sum / s.length;
}

/** CART 回归树：在 feats 特征子集上找最小化方差的分裂 */
function buildTree(
  samples: Sample[],
  feats: number[],
  maxDepth: number,
  minSamples: number,
  rng: () => number,
): RFTreeNode {
  if (maxDepth <= 0 || samples.length < minSamples) return { v: meanY(samples) };
  const totalVar = varY(samples);
  if (totalVar < 1e-8) return { v: meanY(samples) };

  let bestGain = 1e-9;
  let bestF = -1;
  let bestT = 0;
  for (const f of feats) {
    // 候选阈值：样本在特征 f 上的 25/50/75 分位
    const vals = samples.map(s => s.f[f]).sort((a, b) => a - b);
    if (vals.length < 2) continue;
    for (const q of [2, 3, 4]) {
      const t = vals[Math.min(vals.length - 1, Math.floor((vals.length * q) / 4))];
      let lSum = 0, lCount = 0, rSum = 0, rCount = 0;
      let lSumSq = 0, rSumSq = 0;
      for (const s of samples) {
        if (s.f[f] <= t) {
          lCount++;
          lSum += s.y;
          lSumSq += s.y * s.y;
        } else {
          rCount++;
          rSum += s.y;
          rSumSq += s.y * s.y;
        }
      }
      if (lCount === 0 || rCount === 0) continue;
      const lVar = lCount === 0 ? 0 : lSumSq / lCount - (lSum / lCount) ** 2;
      const rVar = rCount === 0 ? 0 : rSumSq / rCount - (rSum / rCount) ** 2;
      const gain = totalVar - (lCount * lVar + rCount * rVar) / samples.length;
      if (gain > bestGain) {
        bestGain = gain;
        bestF = f;
        bestT = t;
      }
    }
  }
  if (bestF < 0) return { v: meanY(samples) };

  const left: Sample[] = [];
  const right: Sample[] = [];
  for (const s of samples) (s.f[bestF] <= bestT ? left : right).push(s);
  if (left.length === 0 || right.length === 0) return { v: meanY(samples) };

  return {
    f: bestF,
    t: bestT,
    l: buildTree(left, feats, maxDepth - 1, minSamples, rng),
    r: buildTree(right, feats, maxDepth - 1, minSamples, rng),
  };
}

function trainRF(samples: Sample[], featureDim: number, treeCount: number, maxDepth: number, minSamples: number, featureSubset: number, seed: number): RFTree[] {
  const rng = mulberry32(seed);
  const trees: RFTree[] = [];
  const allFeats = Array.from({ length: featureDim }, (_, i) => i);
  for (let tIdx = 0; tIdx < treeCount; tIdx++) {
    // bootstrap 采样（有放回）
    const bag: Sample[] = [];
    for (let i = 0; i < samples.length; i++) bag.push(samples[Math.floor(rng() * samples.length)]);
    // 特征子集
    const feats = allFeats.slice().sort(() => rng() - 0.5).slice(0, Math.max(2, featureSubset));
    trees.push({ root: buildTree(bag, feats, maxDepth, minSamples, rng) });
  }
  return trees;
}

function predictTree(node: RFTreeNode, f: number[]): number {
  let n: RFTreeNode | undefined = node;
  while (n.f !== undefined && n.l && n.r) {
    n = f[n.f] <= n.t! ? n.l : n.r;
  }
  return n.v ?? 0;
}

export function predictRF(trees: RFTree[], f: number[]): number {
  let sum = 0;
  for (const t of trees) sum += predictTree(t.root, f);
  return sum / trees.length;
}

// ---------- 训练主流程 ----------

export function trainFromData(dataPath: string, treeCount: number): TrainedModel {
  const lines = fs.readFileSync(dataPath, 'utf8').split('\n').filter(Boolean);
  let featureNames: string[] = [];
  const samples: Sample[] = [];
  for (const line of lines) {
    const j = JSON.parse(line);
    if (j.type === 'meta') {
      featureNames = j.featureNames;
      continue;
    }
    samples.push({ f: j.features, y: j.label });
  }
  if (samples.length < 16) throw new Error('train: 样本不足（<16）');
  const dim = samples[0].f.length;

  const maxDepth = 8;
  const minSamples = 16;
  const featureSubset = Math.max(3, Math.floor(Math.sqrt(dim)) + 1);
  const seed = 42;
  const trees = trainRF(samples, dim, treeCount, maxDepth, minSamples, featureSubset, seed);

  // 评估：训练集 MSE + 皮尔逊相关
  let mse = 0;
  const preds = samples.map(s => predictRF(trees, s.f));
  const yMean = meanY(samples);
  let num = 0, d1 = 0, d2 = 0;
  for (let i = 0; i < samples.length; i++) {
    mse += (preds[i] - samples[i].y) ** 2;
    num += (preds[i] - yMean) * (samples[i].y - yMean);
    d1 += (preds[i] - yMean) ** 2;
    d2 += (samples[i].y - yMean) ** 2;
  }
  mse /= samples.length;
  const corr = Math.sqrt(d1 * d2) === 0 ? 0 : num / Math.sqrt(d1 * d2);

  return {
    type: 'rf',
    featureNames,
    trees,
    treesCount: treeCount,
    maxDepth,
    minSamples,
    featureSubset,
    sampleCount: samples.length,
    mse,
    corr,
    trainedAt: new Date().toISOString(),
  };
}

export function saveModel(model: TrainedModel, outPath: string): void {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(model), 'utf8');
}

// CLI 入口（仅 Node/vite-node 下运行；浏览器没有 process，需守卫，否则拖垮整个导入链）
if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('train.ts')) {
  const dataPath = process.argv[2] || 'reports/train_data.jsonl';
  const treeCount = Math.max(1, Number(process.argv[3]) || 200);
  const outPath = process.argv[4] || 'reports/model.json';
  const model = trainFromData(dataPath, treeCount);
  saveModel(model, outPath);
  console.log(`样本 ${model.sampleCount} | 树 ${model.treesCount} | MSE=${model.mse.toFixed(3)} | 相关系数=${model.corr.toFixed(4)}`);
  console.log(`模型已保存 → ${outPath}（${(fs.statSync(outPath).size / 1024).toFixed(0)}KB）`);
}
