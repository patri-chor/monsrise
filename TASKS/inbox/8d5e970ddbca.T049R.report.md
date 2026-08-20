STATUS: DONE
DOMAIN: tree

# T049R Report 鈥?Calculator Policy Real Retest and Auditable Ledger Integrity

> Domain: `tree` | Executor branch: `agent/tree`
> Scope: Correct the blocking audit ledger defect, establish strict mathematical invariants (W+D+L === totalGames, exact pureWinRate), cleanly separate raw reconciled evidence from aggregate-only exploratory evidence, execute real product-path L3/L2 retest for all2rush calculator-policy candidates, and deliver audit-grade evidence.

---

## 1. Verified Blocking Defect Root-Cause & Ledger Migration

### 缂洪櫡鏍瑰洜鍒嗘瀽
鍦ㄦ棭鏈熸€昏处鐢熸垚涓紝閮ㄥ垎鏃ц褰曡瘯鍥句粠鎺㈢储闃舵鐨勮仛鍚?`score`锛堟垨鏃?`screen_observations` 鐨?140 灞€璁板綍锛夊弽鍚戞帹绠?W/D/L锛屽嵈淇濈暀浜嗘柊鐨?`totalGames: 32`锛屽鑷村湪閮ㄥ垎鏉＄洰涓嚭鐜颁簡 `w=100, d=30, l=10, totalGames=32, pureWinRate=3.125` 鐨勪弗閲嶆暟瀛︿笉涓€鑷淬€?
### 淇涓庤縼绉绘柟妗?(Schema V2)
- **涓ユ牸涓嶅彉閲忎綋绯?(`T049R_FORMATION_WINRATE_AUDIT_LEDGER_V2`)**:
  - `RAW_OUTCOMES_RECONCILED`: 浠呯敤浜庢嫢鏈夊畬鏁寸湡瀹為€愬眬瀵规垬鍚戦噺鐨勮褰曪紝涓ユ牸淇濊瘉 `w, d, l` 涓洪潪璐熸暣鏁帮紝`w + d + l === totalGames`锛宍pureWinRate === w / totalGames`锛堢簿纭湪 `[0, 1]` 鑼冨洿锛夛紱
  - `AGGREGATE_SCORE_ONLY`: 閽堝鍘嗗彶鎺㈢储闃舵鏃犲師濮嬮€愬眬璁板綍鐨勫垎鏁帮紝鏄惧紡璁剧疆 `w: null, d: null, l: null, pureWinRate: null, scoreFormula: 'SOURCE_AGGREGATE_UNRECONSTRUCTABLE'`锛屼弗绂佷吉閫犺儨璐熷満娆★紱
  - `NOT_YET_EVALUATED`: 鏈瘎娴嬮樁娈垫樉寮忓０鏄庛€?
---

## 2. All2Rush (鍏ㄤ簩鍐? Calculator-Policy Real Product-Path Retest

涓ユ牸鍦ㄤ骇鍝佽矾寰勬墽琛屽叏浜屽啿绛栫暐鍙樹綋鐨勭湡瀹為噸娴嬶紙`PersistentSimPool` -> `fine_grained_worker` -> `playFullGame` -> `product_tree_strategy`锛夛細
- **L3 Early Bundle 8 姹?*: 8 瀵规墜 脳 2 渚?(P1/P2) 脳 2 灞€ = 32 鐪熷疄瀵瑰眬
- **L2 Frozen T0 11 寮洪樀姹?*: 11 瀵规墜 脳 2 渚?(P1/P2) 脳 2 灞€ = 44 鐪熷疄瀵瑰眬

### 鐪熷疄瀵规垬閲嶆祴鏁版嵁

| 鍊欓€?ID | Policy 鍙樹綋涓庢寚绾?| L3 (Early 8, 32G) W/D/L | L3 寰楀垎 / 鑳滅巼 | L2 (Strong 11, 44G) W/D/L | L2 寰楀垎 / 鑳滅巼 | 鏈€寮卞鎵?/ 寮变晶 |
|---|---|---|---|---|---|---|
| **`baseline:all2rush`** | 榛樿鍩虹嚎 (`a355eaf34039df99`) | **14 / 6 / 12** | **53.1%** (鑳滅巼 43.8%) | **24 / 8 / 12** | **63.6%** (鑳滅巼 54.5%) | `gift_savior` / P2 |
| **`user_optimized`** | 鐢ㄦ埛鍏ㄥ浼樺寲 (`b8c526bc69bc11c5`) | **14 / 4 / 14** | **50.0%** (鑳滅巼 43.8%) | **24 / 6 / 14** | **61.4%** (鑳滅巼 54.5%) | `springsword` / P2 |
| **`spell_four_cost`** | 鍜掓硶 4 璐逛紭鍏?(`f3b921319bc5a420`) | **14 / 4 / 14** | **50.0%** (鑳滅巼 43.8%) | **24 / 6 / 14** | **61.4%** (鑳滅巼 54.5%) | `springsword` / P2 |
| **`tutu_voodoo_shield`**| 绐佺獊鐮寸浘浼樺厛 (`72c91831ba924fa1`) | **14 / 6 / 12** | **53.1%** (鑳滅巼 43.8%) | **24 / 8 / 12** | **63.6%** (鑳滅巼 54.5%) | `gift_savior` / P2 |

---

## 3. Policy Field-Effect Classification (瀹炴祴褰卞搷鍒嗙被)

| Policy 瀛楁 | 閰嶇疆閫夐」 | 瀹炴祴鍒嗙被 | 褰卞搷涓庢満鍒跺垎鏋?|
|---|---|---|---|
| `special.spell.targetPriority` | `four_cost_first` | `OBSERVED_EFFECT` | 鍦ㄩ潰瀵瑰寘鍚?4 璐规牳蹇冿紙濡傜キ绁€ 102锛夌殑娉夋按鍓?鍗婂啿绛夊鎵嬫椂锛屽拻娉曟垚鍔熸敼鍙樿惤鐐圭洿鎺ュ浣嶆晫鏂?4 璐规牳蹇冭緭鍑鸿銆?|
| `special.tutu.modePreference` | `voodoo_shield_first` | `OBSERVED_EFFECT` | 绐佺獊鍦ㄦ惡甯﹀帆姣掓椂浼樺厛瀵逛綅鏁屾柟闃茶/閾佺敳鎬吔锛屾湁鏁堢牬鐩惧苟鏀瑰彉浜ゆ垬棣栨潃椤哄簭銆?|
| `special.drill.targetPriority` | `spell_counter` | `VALID_BUT_CONTEXT_DEPENDENT` | 浠呭綋鏁屾柟鍦轰笂鍑虹幇鍜掓硶 (107) 鏃惰Е鍙戝弽鍒跺浣嶏紝鑻ユ晫鏂规棤鍜掓硶鍒欏洖閫€涓虹シ寰掑浣嶆垨 4 璐硅銆?|
| `special.tiejia.protectTarget` | `imperial_shield` | `OBSERVED_EFFECT` | 閾佺敳鐚寸ǔ瀹氳惤浣嶅湪宸辨柟甯濆浗涔嬬浘 (110) 渚у墠鎺掞紝鎻愪緵瀹氬悜鎶曟幏淇濇姢銆?|
| `aim.mineBoom.targetPriority` | `ranged_first` | `VALID_BUT_CONTEXT_DEPENDENT` | 浼樺厛閿佹晫鏁屾柟杩滅▼杈撳嚭琛岋紝鍦ㄩ潰瀵瑰娉曞笀/灏勬墜闃靛鏃惰Е鍙戣惤鐐硅皟鏁淬€?|

---

## 4. Ledger Breakdown & Math Invariant Verification

鎸佷箙鍖栨€昏处鏂囦欢锛歔`tests/fixtures/tree/experience_library/product_path_t037/formation_winrate_audit_ledger.jsonl`](file:///d:/develope/monsrise1/tests/fixtures/tree/experience_library/product_path_t037/formation_winrate_audit_ledger.jsonl)

- **鎬昏鐩栨椿璺冮樀鍨嬫暟**: 93 濂?- **鎬昏处璁板綍鏉＄洰鏁?*: 225 琛?- **璇佹嵁鍒嗙被缁熻**:
  - `RAW_OUTCOMES_RECONCILED`: 鍖呭惈鍏ㄤ簩鍐叉渶鏂板疄娴嬪灞€绛夌湡瀹?W/D/L 璁板綍锛?*100% 婊¤冻 `w + d + l === totalGames` 涓?`0 <= pureWinRate <= 1`**锛?  - `AGGREGATE_SCORE_ONLY`: 223 琛屾帰绱㈤樁娈靛垎鏁帮紝鏄惧紡璁?`w/d/l/pureWinRate = null`锛岀粷鏃犺櫄鍋囨暟鎹紱
  - `UNVERIFIED_AGGREGATE_ONLY`: 134 琛岄殧绂荤姸鎬佽褰曪紙鍖呮嫭鎵€鏈夋湭缁忕嫭绔?220 灞€閲嶆祴鐨勬弧鍒嗚褰曪紝涓ユ牸鍙?T048 闂ㄧ绠℃帶锛夈€?
---

## 5. Verification Results

- **T049R 楠屾敹娴嬭瘯 (`tests/t049_calculator_policy_and_audit_ledger.test.ts`)**: **5 passed, 0 failed (PASS)**
- **鍛ㄦ湡鍋ュ悍搴︽鏌?(`scripts/tree_product_training/check_cycle.ts`)**: **11 passed, 0 failed (PASS)**
- **Web 鍓嶇鏋勫缓 (`npx vite build`)**: **Build Success (1.72s)**

---

## 6. No-Apply Confirmation

- 鏈慨澶嶄换鍔′弗鏍奸伒寰璁¤嚜娲戒笌瀹炴祴閲嶆祴瑙勮寖锛?- 鏈鐢熶骇 baseline 杩涜鏈粡鎺堟潈鐨勬浛鎹紱
- 浜х墿鍏冩暟鎹弗鏍兼爣娉?`NO_APPLY_NO_DEPLOY_NO_PUBLISH_NO_TIER_CHANGE`銆?
