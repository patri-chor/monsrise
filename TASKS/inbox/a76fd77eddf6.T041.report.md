STATUS: DONE
DOMAIN: tree

# T041 Report 鈥?Stage Episode Integrity and Probabilistic Archetype Melee

## Run Commands

```bash
# 杩愯瀹屾暣 T041 闃舵璁粌銆丼tage-1 閽堝鎬?Episode 闂ㄧ涓庢鐜囧寲 Melee 閲囨牱
npx vite-node src/engine/tree/product_training/run_cycle.ts

# 楠岃瘉 Stage-1 Episode 闂ㄧ銆佹鐜囧寲閲囨牱閰嶉銆佹祦娲炬不鐞嗛殧绂讳笌鍙杈圭晫锛? 澶ч」妫€鏌ワ級
npx vite-node scripts/tree_product_training/check_cycle.ts
```

## Rejected T040 Evidence Separation & Stage-1 Episode Integrity

- **T040 缂洪櫡淇**锛?  - 淇浜?T040 涓己灏?Stage-1 鑱氱劍璋冧紭鐩存帴杩涘叆 Melee 鐨勯棶棰樸€?  - 淇浜嗙姸鎬佽穬杩佽皳璇嶄腑鈥滄暟鍊兼瘮杈冧笌鎻忚堪鏂囨湰鐭涚浘鈥濈殑闂锛堟墍鏈夌悊鐢卞潎鐢辩湡瀹炴暟鍊间弗鏍煎姩鎬佺敓鎴愶級銆?  - 搴熼櫎鍥哄畾 16 鎴愬憳閬嶅巻锛屾浛鎹负涓ゅ眰姒傜巼鍖?Archetype 閲囨牱妯″瀷銆?- **Strict Stage-1 Episode Gate**:
  - 鍊欓€夎繘鍏?`MELEE` 鍓嶏紝蹇呴』瀹屾垚鑷冲皯 3 娆″疄闄呴拡瀵瑰己闃靛急椤圭殑浼樺寲灏濊瘯锛堟瘡娆″潎杩愯 11 涓鎵?脳 P1/P2 = 44 灞€瀵瑰眬锛夈€?  - 鏈疆鍏变骇鐢?**57 鏉＄湡瀹?Stage-1 Episode 璁板綍**锛堝瓨鍌ㄤ簬 `stage1_episode_ledger.jsonl`锛夛紝姣忔潯鍖呭惈 `triggeredDiagnosis`锛堟渶寮卞鎵嬩笌渚ч潰锛夈€乣strongPoolVectorRef` 涓?`attemptOutcome`銆?
## Archetype Governance Configuration (No Historical Snapshots)

- **Root T1 Archetypes** (`melee_archetype_config.json`):
  - 涓ユ牸鍖呭惈 11 涓綋鍓嶅喕缁撳己闃典綔涓烘牴娴佹淳锛坄springsword`, `nutsavior`, `all2rush`, `classicsavior`, `all2prayer`, `suqing`, `laddersel`, `spade_multi`, `gift_savior`, `golden_boom`, `gift_jungle`锛夈€?  - **閬靛惊鐢ㄦ埛瑕佹眰锛氱粷瀵规湭灏嗗巻鍙插揩鐓э紙`HISTORICAL_SNAPSHOT`锛変綔涓烘祦娲炬垚鍛樻垨鏉＄洰鍔犲叆**銆?  - 姣忎釜鎴愬憳鍧囧叿鏈夊悎娉曠殑 `primaryArchetype = rootSourceId` 涓?`lineageProof`銆傝嫢缂哄皯閰嶇疆鐩存帴 fail-closed 鎶涘嚭 `MELEE_ARCHETYPE_CONFIG_REQUIRED`銆?
## Probabilistic Melee Sampling & Frozen Weights

- **Manifest** (`melee_sampling_manifest.json`):
  - `meleeRevision`: `v1.0.0-t041-lineage` (`hash: bba461a6d713c7bc`)
  - `topLevelArchetypeProbability`: 1/11 (9.09% 绛夋鐜囧潎鍖€鍒嗗竷)
  - `minimumPairsPerArchetype`: 1 pair (淇濆簳瑕嗙洊鍏ㄩ儴 11 涓祦娲?
  - `samplePairBudget`: 16 pairs (32 games per candidate)
- **Pair Sampling Records** (`melee_sample_pairs.jsonl`):
  - 鍏卞璁?**304 缁勬垚瀵归噰鏍疯褰?*锛堣鐩?19 涓繘鍏?Melee 鐨勫€欓€夛級銆?  - 姣忔閲囨牱鍧囨垚瀵硅繍琛?P1 涓?P2 瀵瑰眬锛屾弧瓒崇‘瀹氭€х瀛愪笌閰嶉銆?
## Melee Return Path Proof

- 鍦?Melee 閲囨牱瀵瑰眬涓毚闇插急椤圭殑鍊欓€夛紝瑙﹀彂 `MELEE_DIAGNOSE_RETURN_STAGE_1`銆?- **绮惧噯杩斿洖 `STAGE_1_STRONG_EPISODE` 閽堝鎬ц瘖鏂皟浼橈紝缁濅笉鐩存帴閫€鍥?`STAGE_3_EARLY_BUNDLE`**銆?
## Catalog Summary & Experimental Frontiers

| Source ID | Classification | Controllable Ratio | Spatial Budget | Baseline | Best Relative | Experimental Frontier? |
|---|---|---|---|---|---|---|
| `springsword` | PANEL_SATURATED | 0.750 | 2 | 1.000 | +0.000 | No |
| `nutsavior` | PANEL_SATURATED | 0.625 | 2 | 1.000 | -0.023 | No |
| `all2rush` | PANEL_UNDERPERFORMER | 0.250 | 0 | 0.500 | +0.125 | No |
| `classicsavior` | PANEL_MID | 0.375 | 1 | 0.714 | **+0.149** | **YES** |
| `all2prayer` | PANEL_MID | 0.625 | 2 | 0.786 | -0.036 | No |
| `suqing` | PANEL_MID | 0.500 | 2 | 0.893 | **+0.107** | **YES** |
| `laddersel` | PANEL_MID | 0.125 | 0 | 0.857 | -0.039 | No |
| `spade_multi` | PANEL_MID | 0.750 | 2 | 0.786 | **+0.032** | **YES** |
| `gift_savior` | PANEL_SATURATED | 0.750 | 2 | 1.000 | -0.125 | No |
| `golden_boom` | PANEL_SATURATED | 0.750 | 2 | 1.000 | +0.000 | **YES** |
| `gift_jungle` | PANEL_MID | 0.875 | 3 | 0.857 | **+0.097** | **YES** |

## Telemetry & No-Apply Confirmation

- **Telemetry**: `cpuAvg: 78.0%, p95: 86.0%, configuredWorkers: 64`銆?- **Catalog Hash**: `dcf172fc96b2cfe7`銆?- **No-Apply Confirmation**: 浜х墿涓ユ牸鏍囨敞 `NO_APPLY_NO_DEPLOY_NO_PUBLISH_NO_TIER_CHANGE`锛屼粎浣滀负鑱氬悎瀹為獙鐩綍銆?
