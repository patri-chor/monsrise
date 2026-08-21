import '../src/engine/env';
import { runDynamicT0PilotCycle } from '../src/engine/tree/product_training/generation2/pool';

async function main() {
  console.log('[DynamicT0Pilot] Starting Dynamic T0 L1/L2 Pilot Cycle...');
  const report = await runDynamicT0PilotCycle();
  console.log(`[DynamicT0Pilot] Finished pilot run: ${report.runId}. Pilot formations: ${report.aggregate.totalPilotFormations}, Replaced: ${report.aggregate.replacedFormationsCount}, Retained: ${report.aggregate.retainedFormationsCount}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
