import '../src/engine/env';
import { resolve } from 'node:path';
import { runProductPathFormalScreen } from '../src/engine/tree/product_path_screen';
import { PersistentSimPool } from '../src/engine/tree/persistent_pool';

const smoke = process.env.T032_SMOKE === '1';
const outputDir = resolve(smoke ? 'reports/t032-product-path-smoke' : 'reports/t032-product-path-formal');
const pool = new PersistentSimPool({ enableCpuMonitor: false });

runProductPathFormalScreen({ smoke, outputDir, pool })
  .then(result => {
    console.log(JSON.stringify({
      protocol: 'PRODUCT_PATH_FORMAL_SCREEN_T032_V1',
      smoke,
      manifestHash: result.manifestHash,
      fidelityPassed: result.fidelity.passed,
      fidelityCoverage: result.fidelity.coverageMatrixSummary,
      baselines: result.baselines.length,
      completedCandidates: result.completedCandidates,
      skippedCandidates: result.skippedCandidates,
      outputDir: result.outputDir,
      frontierPath: result.frontierPath,
    }, null, 2));
  })
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.destroy());
