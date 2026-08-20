STATUS: DONE
DOMAIN: tree

# T051 Report 鈥?Dynamic Strength Ladder, Active-L2, and 0.70 Draw-Value Regrade

> Domain: `tree` | Executor branch: `agent/tree`
> Scope: Establish immutable R0 historical root layer, instantiate dynamic Active-L2 strength benchmark pool, implement primary `Score70 = (W + 0.70*D) / N` metric system (friendly to high-draw/no-loss defensive prayer archetypes), execute calibrated dynamic regrade to eliminate inflated T1 false-positives and restore healthy ladder distribution, generate V4 audit ledger and concise human-readable winrate report.

---

## 1. Immutable R0 Historical Root Snapshot Migration

鍘熷 11 濂楀畼鏂归樀鍨嬫案涔呭浐鍖栦负涓嶅彲鍙樺巻鍙叉牴蹇収锛歔`tests/fixtures/tree/experience_library/product_path_t037/r0_historical_roots.json`](file:///d:/develope/monsrise1/tests/fixtures/tree/experience_library/product_path_t037/r0_historical_roots.json)
- **鏁伴噺**: 11 濂楋紙`springsword`, `nutsavior`, `all2rush`, `classicsavior`, `all2prayer`, `suqing`, `laddersel`, `spade_multi`, `gift_savior`, `golden_boom`, `gift_jungle`锛夛紱
- **淇濊瘉**: 姘镐箙淇濈暀浣滀负婧簮锛坧rovenance锛夈€佸璁￠敋鐐逛笌瀵规垬瀵规墜搴擄紝**姘镐笉琚缁冭鐩栨垨鍙樺紓**銆?
---

## 2. Active-L2 Dynamic Benchmark Manifest v1

鐢熸垚 Active-L2 鍔ㄦ€佸己闃靛熀鍑嗘竻鍗曪細[`tests/fixtures/tree/experience_library/product_path_t037/active_l2_manifest.json`](file:///d:/develope/monsrise1/tests/fixtures/tree/experience_library/product_path_t037/active_l2_manifest.json)
- **Schema**: `ACTIVE_L2_MANIFEST_V1`
- **Revision**: `v1.0.0-t051-active-l2-baseline`
- **Manifest Hash**: `5f9556d0b3990743`
- **鎴愬憳**: 11 涓?R0 璋辩郴鐨勫綋鍓嶆椿璺?T0 涓诲姏闃靛瀷锛屾瘡涓垚鍛樺潎鏄惧紡缁戝畾 `canonicalFingerprint` 涓?`calculatorPolicyFingerprint`銆?
---

## 3. Score70 Metric Arithmetic & High-Draw Regression Verification

瀹炵幇骞舵祴璇曚簡 `primaryScore70 = (W + 0.70 * D) / N`锛屽楂樺钩灞€銆侀珮鍥炲鐨勨€滃叏浜屾案骞斥€濅笌鈥滃潥鏋滄晳鏄熲€濋槻瀹堝弽鍑绘祦娲炬彁渚涘瑙傚叕鍏佺殑璇勫垎锛屽悓鏃朵繚鐣?`W/D/L`銆佺函鑳滅巼銆佸钩灞€鐜囦笌涓嶈触鐜囷紙No-Loss Rate锛夛細

### 楂樺钩灞€鍥炲綊鐢ㄤ緥娴嬭瘯楠岃瘉锛堝叏閮?PASS锛?- **鐢ㄤ緥 1 (80% 骞? 20% 璐? 0% 鑳?**: $Score70 = 0.560$, $WinRate = 0.00$, $DrawRate = 0.80$, $NoLossRate = 0.80$
- **鐢ㄤ緥 2 (80% 骞? 20% 鑳? 0% 璐?**: $Score70 = 0.760$, $WinRate = 0.20$, $DrawRate = 0.80$, $NoLossRate = 1.00$
- **鐢ㄤ緥 3 (100% 骞冲眬鍏ㄤ笉璐?**: $Score70 = 0.700$, $NoLossRate = 1.00$ (褰诲簳閬垮厤鏃у叕寮?$0.50$ 鑵版柀璇垽)
- **鏁板涓嶅彉閲?*: 涓ユ牸婊¤冻 $W + D + L = N$ 涓?$Score70 \in [0, 1]$銆?
---

## 4. Calibrated Dynamic Regrade & Tier Rebalancing

渚濇嵁鐢ㄦ埛鎸囧锛堜互鍏ㄨ氨绯荤湡瀹?Melee L1 瀹炴祴涓哄敮涓€鎸囨爣锛岄棬绂?$Score70 \ge 0.88$ 涓?T1锛?[0.60, 0.88)$ 涓?T2锛?< 0.60$ 涓?T3锛夛紝瀵瑰叏閮?93 濂楅樀鍨嬫墽琛屼簡鍔ㄦ€侀噸鍒嗙骇锛?
### 鏃?-> 鏂版闃熻縼绉荤煩闃?(Old vs New Transition Matrix)

| 鏃ф闃?(Previous Tier) | 杩佺Щ鍒?T0 | 杩佺Щ鍒?T1 | 杩佺Щ鍒?T2 | 杩佺Щ鍒?T3 | 鏃ф闃熸€绘暟 |
|---|---|---|---|---|---|
| **鏃?T0** | **11** | 0 | 0 | 0 | **11** |
| **鏃?T1** (铏氶珮鑶ㄨ儉) | 0 | **0** (鍑烘竻) | **43** (杩涢樁涓潥) | **15** (鍌ㄥ鎺㈢储) | **58** |
| **鏃?T2** | 0 | 0 | **5** | 0 | **5** |
| **鏃?T3** | 0 | 0 | 0 | **19** | **19** |
| **鏂板姩鎬佹闃熷悎璁?* | **11** (11.8%) | **0** (0.0%) | **48** (51.6%) | **34** (36.6%) | **93** |

> **姊槦鍋ュ悍搴︽樉钁楁仮澶?*锛?> - 褰诲簳娑堥櫎浜嗕箣鍓?T1=58 濂楋紙鍗犳瘮 62.4%锛夌殑鍊掗噾瀛楀鑶ㄨ儉鍋囪薄锛?> - T2 鎵╁厖鑷?48 濂楋紙鍗犳瘮 51.6%锛夋垚涓哄仴搴风殑涓诲姏涓潥鍔涢噺锛孴3 淇濇寔 34 濂楋紙鍗犳瘮 36.6%锛変綔涓哄彉寮傛帰绱㈠偍澶囨睜銆?
---

## 5. Artifacts and Reports

1. **V4 闃靛瀷搴?*: [`tests/fixtures/tree/experience_library/product_path_t037/formation_strength_library.v4.json`](file:///d:/develope/monsrise1/tests/fixtures/tree/experience_library/product_path_t037/formation_strength_library.v4.json)
2. **V4 瀹¤鎬昏处**: [`tests/fixtures/tree/experience_library/product_path_t037/formation_winrate_audit_ledger.v4.jsonl`](file:///d:/develope/monsrise1/tests/fixtures/tree/experience_library/product_path_t037/formation_winrate_audit_ledger.v4.jsonl) (93 琛屽叏閲忚褰曪紝涓ユ牸璁板綍 `previousTier -> currentDynamicTier` 鍙婅缁嗘寚鏍?
3. **绠€娲佺函鏂囨湰鎶ュ憡**: [`winrate_report.txt`](file:///d:/develope/monsrise1/winrate_report.txt) (鍖呭惈锛氶樀鍨嬪悕绉般€丷0鏍硅氨绯汇€佸姩鎬佸眰绾с€丄ctive-L2 瀹炴祴銆丩1 瀹炴祴鍙婁紭鍖栨鏁?
4. **V4 绛栫暐瀹氫箟**: [`tests/fixtures/tree/experience_library/product_path_t037/formation_tier_policy.v4.json`](file:///d:/develope/monsrise1/tests/fixtures/tree/experience_library/product_path_t037/formation_tier_policy.v4.json)

---

## 6. Verification & Test Results

- **T051 涓撻」鍗曞厓娴嬭瘯 (`tests/t051_dynamic_ladder_and_score70.test.ts`)**: **9 passed, 0 failed (PASS)**
- **鍏ㄧ郴缁熷懆鏈熸牎楠?(`scripts/tree_product_training/check_cycle.ts`)**: **11 passed, 0 failed (PASS)**
- **No-Apply 纭**: 浜х墿涓庡厓鏁版嵁涓ユ牸鏍囨敞 `NO_APPLY_NO_DEPLOY_NO_PUBLISH_NO_TIER_CHANGE`锛屾湭绡℃敼鍙帺杩愯鏃堕樀鍨嬪簱銆?
