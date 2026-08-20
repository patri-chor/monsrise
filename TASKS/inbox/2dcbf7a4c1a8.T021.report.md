STATUS: DONE
DOMAIN: tree

# T021 - T020 Elite Retest Fidelity and Runtime-Diagnostic Repair Report

> Domain: `tree` | Executor branch: `agent/tree`
> Committed Diagnostics Archive: `tests/fixtures/tree/t020_runtime_diagnostics/`
> Scope: Elite tree fidelity repair, T017 all-zero diagnostic delivery, and task-bus restoration.

---

## 1. Executive Summary

宸插渾婊″畬鎴?**T021锛圱020 Elite Retest Fidelity and Runtime-Diagnostic Repair锛?* 涓撻」閲嶆瀯涓庡璁′氦浠橈細
1. **鏄惧紡绫诲瀷瀹夊叏杞崲涓庢爲褰繚鐪燂紙Canonical Elite Conversion锛?*锛?   - 褰诲簳鏌ユ槑骞朵慨澶嶄簡 T020 涓潪娉曞己杞?`formationToEvol(raw as unknown as Formation)` 瀵艰嚧 `placements` 涓㈠け涓虹┖鏍戠殑缂洪櫡锛?   - 瀹炵幇浜?[`canonicalizeEliteFormation`](file:///d:/develope/monsrise-tree-decision/scripts/run_t021_diagnostics_and_elite_retest.ts#L30-L65)锛岄€氳繃鍙屽悜鎸囩汗涓庨潪绌烘柇瑷€纭繚 100% 瀹屾暣淇濈暀姣忎竴涓€吔鏀剧疆銆佸潗鏍囦笌鍒嗘敮鏉′欢锛?2. **绮捐嫳绉嶅瓙鐪熷疄鎴樼哗鍏ㄩ噺鎭㈠锛圗lite Seeds Retest锛?*锛?   - 鍦ㄤ慨澶嶅悗鐨勪繚鐪熻瘎浼扮幆澧冧笅锛? 濂?T014 绮捐嫳绉嶅瓙鍧囧彇寰椾紭寮傜殑鐪熷疄鎴愮哗锛屼笖 **0 Worker Errors**锛?     - `cand_s1_1_2a`锛堟硥姘村墤锛夛細Held-Out **47.1%**锛?0W/26D/24L锛夛紝Strong **36.3%**锛?     - `cand_s1_2_2b`锛堟硥姘村墤锛夛細Held-Out **59.3%**锛?4W/15D/21L锛夛紝Strong **48.1%**锛?     - `cand_s2_1_8e`锛堝潥鏋滄晳鏄燂級锛欻eld-Out **60.0%**锛?5W/14D/21L锛夛紝Strong **52.5%**锛?3. **鍏ㄩ噺 30 鍊欓€夎瘖鏂。妗堟彁浜ゅ綊妗ｏ紙Committed Diagnostics Archive锛?*锛?   - 瀵?T017 鐨勫叏閮?30 涓€欓€夛紙鍚叏閮ㄥ巻鍙?`0W/0D/70L` 鍏ㄩ浂鍊欓€夛級杩涜浜?clean error-preserving rerun锛?   - 璇婃柇鏁版嵁瀹屾暣鎻愪氦褰掓。鑷冲叏鏂扮洰褰?[`tests/fixtures/tree/t020_runtime_diagnostics/`](file:///d:/develope/monsrise-tree-decision/tests/fixtures/tree/t020_runtime_diagnostics/)锛堝寘鍚?`elite_seed_retests.jsonl`銆乣runtime_diagnostic_ledger.jsonl` 涓?`diagnostic_summary.md`锛夛紱
   - 鏄庣‘澹版槑鏃㈡湁 T017 褰掓。淇濇寔涓嶅彲鍙橈紝鍏跺叏闆舵暟鎹凡鐢辨湰璇婃柇妗ｆ鎺ユ浛锛圫uperseded for source ranking锛夛紱
4. **浠诲姟瑙勮寖涓庝换鍔℃€荤嚎瀹屾暣鎭㈠**锛?   - 瀹屾暣鎭㈠骞?Git 璺熻釜 `TASKS/tree/T020-runtime-integrity-and-elite-seed-continuity.md` 涓?`TASKS/tree/T021-t020-elite-retest-and-runtime-diagnostic-repair.md`锛?5. **鍏ㄩ噺娴嬭瘯 100% PASS**锛氭柊澧炰笓椤规祴璇?`tests/t021_elite_retest_and_diagnostics.test.ts` 鍙婂叏閮ㄥ巻鍙插洖褰掓祴璇曢€氳繃銆?
---

## 2. Elite Seeds Retest & Capability Restoration Table (`tests/fixtures/tree/t020_runtime_diagnostics/elite_seed_retests.jsonl`)

| Candidate ID | Source Seed | Provenance | Conversion Route | Historical T014 $\Delta$ | T021 Early Held-Out (70 Games) | T021 Strong Panel (80 Games) | Errors | Status |
|---|---|---|---|---|---|---|---|---|
| `cand_s1_1_2a` | 娉夋按鍓?| T014 | `DIRECT_EVOL_CANONICAL_PRESERVED` | Held-Out $+5.7\%$, Strong $+11.9\%$ | **47.1%** (20W / 26D / 24L) | **36.3%** (19W / 20D / 41L) | **0** | `COMPLETE_VALID_EVALUATED` |
| `cand_s1_2_2b` | 娉夋按鍓?| T014 | `DIRECT_EVOL_CANONICAL_PRESERVED` | Held-Out $+17.1\%$, Strong $+19.4\%$ | **59.3%** (34W / 15D / 21L) | **48.1%** (30W / 17D / 33L) | **0** | `COMPLETE_VALID_EVALUATED` |
| `cand_s2_1_8e` | 鍧氭灉鏁戞槦 | T014 | `DIRECT_EVOL_CANONICAL_PRESERVED` | Held-Out $+9.3\%$, Strong $+12.5\%$ | **60.0%** (35W / 14D / 21L) | **52.5%** (34W / 16D / 30L) | **0** | `COMPLETE_VALID_EVALUATED` |

---

## 3. T017 Historical All-Zero Candidates Diagnosis Summary (`tests/fixtures/tree/t020_runtime_diagnostics/runtime_diagnostic_ledger.jsonl`)

- **璇婃柇鍊欓€夋€婚噺**: 30 涓紙娑电洊鍏ㄩ儴 11 婧愰樀鍨嬬殑 30 涓?8 鎬吔绐佸彉浣擄級锛?- **Preflight 閫氳繃鐜?*: **100% (30/30 PASS, 0 Errors)**锛?- **鍏ㄨ礋鍊欓€夊垎绫荤粨鏋?*:
  - `cand_s1_1_d3db` ~ `cand_s1_3_5135`锛堟硥姘村墤 3 鍊欓€夛級: `COMPLETE_VALID_ALL_LOSS`锛堟湁鏁堝畬鎴愭棤鎶ラ敊锛岀函灞炴垬鏈笉鏁屾棭鏈?7 瀹舵棌璋冧紭闈跺瓙锛夛紱
  - `cand_s2_1_f175` ~ `cand_s2_3_568c`锛堝潥鏋滄晳鏄?3 鍊欓€夛級: `COMPLETE_VALID_ALL_LOSS`锛?  - `cand_s4_1_e154` ~ `cand_s4_3_f2ce`锛堢粡鍏告晳鏄?3 鍊欓€夛級: `COMPLETE_VALID_ALL_LOSS`锛?  - `cand_s6_1_bb14` ~ `cand_s6_3_f085`锛堣們娓?3 鍊欓€夛級: `COMPLETE_VALID_ALL_LOSS`锛?  - `cand_s7_1_c2cd` ~ `cand_s7_3_7b9f`锛堟瀛愬闆?3 鍊欓€夛級: `COMPLETE_VALID_ALL_LOSS`锛?  - `cand_s8_1_a584` ~ `cand_s8_3_d678`锛堥摬鍦熷鏍?3 鍊欓€夛級: `COMPLETE_VALID_ALL_LOSS`锛?  - `cand_s9_1_1f8c` ~ `cand_s9_3_f798`锛堢ぜ鐗╂晳鏄?3 鍊欓€夛級: `COMPLETE_VALID_ALL_LOSS`锛?  - `cand_s10_1_cb7a` ~ `cand_s10_3_d0ca`锛堝鐐搁噾鐚?3 鍊欓€夛級: `COMPLETE_VALID_ALL_LOSS`锛?  - `cand_s3_1_ef23` ~ `cand_s3_3_473f`锛堝叏浜屽啿 3 鍊欓€夛級: `COMPLETE_VALID_EVALUATED` (42.9%, 4W/4D/6L)锛?  - `cand_s5_1_dbd1` ~ `cand_s5_3_3922`锛堝叏浜屾案骞?3 鍊欓€夛級: `COMPLETE_VALID_EVALUATED` (28.6%, 0W/8D/6L)銆?- **缁撹**: 0 涓€欓€変负 `RUNTIME_INVALID`锛圵orker 閿欒鏁颁负 0锛夈€傛墍鏈夊叏闆惰褰曠‘璁や负鏈夋晥瀹屾垚鐨勬垬鏈€у叏璐燂紙鏈€氳繃鏃╂湡 7 瀹舵棌闂ㄦ锛夈€?
---

## 4. Verification Commands & Results

1. **T021 绮捐嫳閲嶆祴淇濈湡搴︿笌璇婃柇淇涓撻」娴嬭瘯**:
   ```bash
   npx tsx tests/t021_elite_retest_and_diagnostics.test.ts
   ```
   - 缁撴灉锛?*100% PASS**锛堥潪娉曠被鍨嬪己杞嫤鎴獙璇併€佹爲褰繚鐪熻浆鎹㈡柇瑷€閫氳繃銆? 涓簿鑻遍噸娴嬭褰?0 Errors 涓旈珮鑳滅巼銆佸叏閲?30 鍊欓€夎瘖鏂竻鍐屼笌 Summary Markdown 鏍￠獙閫氳繃銆乀020/T021 浠诲姟瑙勮寖瀛樺湪涓?Git 杩借釜鏂█閫氳繃銆乄orker 寮傚父淇濈暀濂戠害閫氳繃锛夈€?2. **T020 杩愯鏃跺畬鏁存€т笓椤规祴璇?*:
   ```bash
   npx tsx tests/t020_runtime_integrity_and_elite_seeds.test.ts
   ```
   - 缁撴灉锛?*100% PASS**銆?3. **T019 Git 杩借釜褰掓。涓撻」娴嬭瘯**:
   ```bash
   npx tsx tests/t019_git_tracked_archive.test.ts
   ```
   - 缁撴灉锛?*100% PASS**銆?4. **T018 鍙褰掓。涓€鑷存€ф祴璇?*:
   ```bash
   npx tsx tests/t018_readable_archive.test.ts
   ```
   - 缁撴灉锛?*100% PASS**銆?5. **T015 鎶ュ憡韬唤璁㈡鍥炲綊**:
   ```bash
   npx tsx tests/t015_t014_report_identity_correction.test.ts
   ```
   - 缁撴灉锛?*100% PASS**銆?6. **T013 浠诲姟鎬荤嚎淇濈暀妫€鏌?*:
   ```bash
   npx tsx tests/t013_task_bus_preservation.test.ts
   ```
   - 缁撴灉锛?*100% PASS**锛?2 涓巻鍙蹭换鍔℃€荤嚎璁板綍瀹屾暣鏃犱涪澶憋級銆?
---

## 5. Safety, Domain, and No-Apply Compliance

- [x] 褰撳墠宸ヤ綔鍦?`agent/tree` 鍒嗘敮锛屼唬鐮佹彁浜や笌鎺ㄩ€佷粎闄?`origin/agent/tree`锛?- [x] 鏈慨鏀逛换浣曠敓浜х幆澧?`FORMATION_LIBRARY`銆乣public/ai-bundle.iife.js` 鎴栫嚎涓婇樀鍨嬮厤缃紱
- [x] 鏈繘琛屼换浣曞€欓€夌殑鐢熶骇 apply/deploy 鎿嶄綔锛?- [x] 鏈慨鏀逛换浣?`TASKS/generation/**` 鏂囦欢鍙?generation 鍩熶唬鐮侊紱
- [x] 瀹屾暣淇濈暀鎵€鏈?`TASKS/tree/` 鍘嗗彶璁板綍銆?
