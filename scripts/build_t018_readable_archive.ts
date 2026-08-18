import '../src/engine/env';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { getMonsterDisplayName } from '../src/engine/tree/order_search';
import { isPositionIrrelevant } from '../src/engine/tree/tree_ops';

export function buildT018ReadableArchive() {
  const archiveDir = resolve('tests/fixtures/tree/t016_training_archive');

  const tierLib = JSON.parse(readFileSync(join(archiveDir, 'tier_library.json'), 'utf8'));
  const sourceSnapshot = JSON.parse(readFileSync(join(archiveDir, 'source_snapshot.json'), 'utf8'));
  const rejections = readFileSync(join(archiveDir, 'rejection_ledger.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const reinfAttempts = readFileSync(join(archiveDir, 'reinforcement_attempts.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));

  const tier1Count = tierLib.tier1.length;
  const tier2Count = tierLib.tier2.length;
  const tier3Count = tierLib.tier3.length;
  const rejectedCount = rejections.length;

  // 1. 生成 tier_library.md
  let tierMd = `# Three-Tier Candidate Library\n\n`;
  tierMd += `## Exact Tier & Rejection Counts\n\n`;
  tierMd += `\`\`\`text\nTier 1: ${tier1Count}\nTier 2: ${tier2Count}\nTier 3: ${tier3Count}\nRejected: ${rejectedCount}\n\`\`\`\n\n`;
  
  tierMd += `## Tier 1: Current Bundle Baselines (${tier1Count} Formations)\n\n`;
  tierMd += `| Source ID | Chinese Name | Archetype | Team Size | Status |\n|---|---|---|---|---|\n`;
  for (const s of tierLib.tier1) {
    tierMd += `| \`${s.id}\` | ${s.name} | ${s.archetype} | ${s.teamSize} | ${s.isLegacyBaseline ? '⚠️ 7-Monster Legacy Baseline' : '8-Monster Standard Baseline'} |\n`;
  }

  tierMd += `\n## Tier 2: Stable Enhanced Candidates (${tier2Count} Candidates)\n\n`;
  tierMd += `> Currently **0** candidates met the strict Tier 2 criteria (>=2/3 passes, median held-out >= 50.0%, strong panel >= 35.0%, and no generalization warning).\n\n`;

  tierMd += `## Tier 3: Exploratory Diversity Candidates (${tier3Count} Candidates)\n\n`;
  tierMd += `| Candidate ID | Source Seed | Bucket | Passes / 3 | Median Held-Out | Strong Score | Selected Tree Provenance |\n|---|---|---|---|---|---|---|\n`;
  for (const t of tierLib.tier3) {
    tierMd += `| \`${t.candidateId}\` | ${t.sourceSeedName} | ${t.noveltyBucket} | ${t.robustStats.passCount}/3 | ${(t.robustStats.medianHeldOutScore * 100).toFixed(1)}% | ${(t.generalization.strongAfterScore * 100).toFixed(1)}% | ${t.selectedTreeProvenance} |\n`;
  }

  tierMd += `\n## Rejected Candidates Ledger (${rejectedCount} Candidates)\n\n`;
  tierMd += `| Candidate ID | Source Seed | Passes / 3 | Median Held-Out | Strong Score | Rejection Reason |\n|---|---|---|---|---|---|\n`;
  for (const r of rejections) {
    tierMd += `| \`${r.candidateId}\` | ${r.sourceSeedName} | ${r.robustStats.passCount}/3 | ${(r.robustStats.medianHeldOutScore * 100).toFixed(1)}% | ${(r.generalization.strongAfterScore * 100).toFixed(1)}% | ${r.reason} |\n`;
  }

  const tierMdPath = join(archiveDir, 'tier_library.md');
  writeFileSync(tierMdPath, tierMd, 'utf8');
  console.log(`[T018] Wrote ${tierMdPath}`);

  // 2. 生成 summary.md
  let sumMd = `# Overnight Eleven-Formation Library Training Summary\n\n`;
  sumMd += `## 1. Scope & Execution Parameters\n\n`;
  sumMd += `- **Sources**: 11 frozen sources (10 standard 8-monster baselines + 1 legacy 7-monster baseline \`gift_jungle\`);\n`;
  sumMd += `- **Generated Candidates**: 30 coherent 8-monster candidates (3 per standard source across light/medium/heavy);\n`;
  sumMd += `- **Independent Optimization Attempts**: 90 attempts (30 candidates * 3 independent attempt schedules);\n`;
  sumMd += `- **Upper-Bound Reinforcement**: 1 reinforcement attempt (\`cand_s5_1_dbd1\` 全二永平, non-replacement outcome);\n`;
  sumMd += `- **Worker Error Count**: **0** worker errors across all attempts;\n`;
  sumMd += `- **No-Apply Confirmation**: This run was an offline diversity training and library curation experiment. **No active formation or bundle was modified or applied**.\n\n`;

  sumMd += `## 2. Final Tiering Results\n\n`;
  sumMd += `- **Tier 1 (Current Bundle Baselines)**: 11\n`;
  sumMd += `- **Tier 2 (Stable Enhanced Candidates)**: 0\n`;
  sumMd += `- **Tier 3 (Exploratory Diversity Candidates)**: 5\n`;
  sumMd += `- **Rejected (Rejection Ledger)**: 25\n`;

  const sumMdPath = join(archiveDir, 'summary.md');
  writeFileSync(sumMdPath, sumMd, 'utf8');
  console.log(`[T018] Wrote ${sumMdPath}`);

  // 3. 生成 final_r5_grids.md
  let gridMd = `# Final Cumulative R5 Grids for Tier 1 & Tier 2 Formations\n\n`;
  gridMd += `> All monster names are authoritatively derived from \`DB_MONSTERS\`. Calculator-controlled units are explicitly marked with \`[计算定位]\` rather than fixed coordinates.\n\n`;

  gridMd += `## Tier 1: Current Bundle Baselines (11 Formations)\n\n`;

  for (let sIdx = 0; sIdx < sourceSnapshot.length; sIdx++) {
    const s = sourceSnapshot[sIdx];
    gridMd += `### ${sIdx + 1}. ${s.name} (\`${s.id}\` | ${s.archetype})${s.isLegacyBaseline ? ' — ⚠️ 7-Monster Legacy Baseline' : ''}\n\n`;
    gridMd += `\`\`\`text\n`;

    // 递归遍历树的主干分支
    function renderMainline(node: any, round: number) {
      if (node.placement && node.placement.length > 0) {
        const pStrs = node.placement.map((p: any) => {
          const mName = getMonsterDisplayName(p.monsterId);
          if (isPositionIrrelevant(p.monsterId)) {
            return `${mName}(${p.monsterId}) [计算定位]`;
          } else {
            return `${mName}(${p.monsterId})@(${p.x},${p.y})`;
          }
        });
        gridMd += `R${node.round}: ${pStrs.join(', ')}\n`;
      }
      if (node.children && node.children.length > 0) {
        renderMainline(node.children[0], round + 1);
      }
    }

    renderMainline(s.tree, 0);
    gridMd += `\`\`\`\n\n`;
  }

  gridMd += `## Tier 2: Stable Enhanced Candidates (0 Candidates)\n\n`;
  gridMd += `> No candidates qualified for Tier 2 in this run (0 candidates).\n`;

  const gridMdPath = join(archiveDir, 'final_r5_grids.md');
  writeFileSync(gridMdPath, gridMd, 'utf8');
  console.log(`[T018] Wrote ${gridMdPath}`);
}

buildT018ReadableArchive();
