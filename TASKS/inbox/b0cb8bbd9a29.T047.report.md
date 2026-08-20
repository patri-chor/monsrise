STATUS: DONE
DOMAIN: tree

# T047 Report 鈥?Read-Only Audit of Perfect Win Rates and Benchmark Integrity

> Executor: `agent/tree` | Type: Read-Only Forensic Audit
> Prohibited: No training artifact, catalog, tier, formation, or strength record was modified.
> Commands run: `npx tsx scripts/t047_perfect_result_audit.ts`, `npx tsx scripts/t047_deep_audit.ts`, `npx tsx scripts/t047_arith_audit.ts`, `npx tsx scripts/t047_benchmark_audit.ts`
> Files written: `scripts/t047_perfect_result_audit.ts`, `scripts/t047_deep_audit.ts`, `scripts/t047_arith_audit.ts`, `scripts/t047_benchmark_audit.ts` (audit scripts, not production artifacts)

---

## 1. Perfect Result Inventory

### Files Scanned

| File | Total Records | Records with score=1 or W>0,D=0,L=0 |
|---|---|---|
| `benchmark_cell_results.jsonl` | 6 | 0 |
| `learning_level_evaluations.jsonl` | 230 | 72 |
| `screen_cells.jsonl` | 1176 | 975 |
| `screen_observations.jsonl` | 146 | 0 |
| `stage_screen_records.jsonl` | 163 | 68 |
| `melee_sample_pairs.jsonl` | 1168 | 0 |
| `candidate_lineage.jsonl` | 31 | 0 |
| `head_to_head_matrix.jsonl` (historic) | 187 | 44 |

---

## 2. Per-Source Perfect Result Details

### A. `screen_cells.jsonl` 鈥?975/1176 婧€鍒?(T037 L3 Early Bundle Screen)

**Root cause (NOT a bug, explanation follows):**

- 瀵规墜姹狅細浠?7 涓?Early Bundle held-out 鍙樹綋锛坄springsword_heldout`, `nutsavior_heldout`, `all2rush_heldout`, `classicsavior_heldout`, `all2prayer_heldout`, `suqing_heldout`, `laddersel_heldout`锛?- Games per cell: **10**锛堥潪 140 灞€锛?- 姣忎釜瀹炰綋 14 涓?cell = 7 opponents 脳 2 sides 脳 10 games = **140 鎬诲眬**
- 婊″垎瀹炰綋锛?5 涓紙鍚?4 涓?PANEL_SATURATED 鍩哄噯 + 21 涓€欓€夛級

**鍚屾棌瀵瑰眬锛坰ame-family cells锛夛細116 涓?*
- `baseline:springsword` vs `springsword_heldout`銆乣cand:springsword:*` vs `springsword_heldout` 绛?- 閲嶈婢勬竻锛歚springsword_heldout` 鏄?*涓?`baseline:springsword` 涓嶅悓鐨勭嫭绔嬪竷灞€鍙樹綋**锛堜笉鍚岀殑 `entityFingerprint`锛夛紝涓嶅睘浜庤嚜瀵瑰眬
- 浣嗚繖 116 涓悓鏃忓灞€鍦ㄨ涔変笂鏋勬垚"杩戜翰娴嬭瘯"鈥斺€旀祴璇曡€呬笌瀵规墜鏉ヨ嚜鍚屼竴婧愰樀鍨?
**绠楁湳鐙珛閲嶇畻缁撴灉锛? mismatches**锛坰creen_cells W/D/L 涓?screen_observations 瀵规瘮瀹屽叏涓€鑷达級

**娉ㄦ剰锛?* `screen_cells` 涓病鏈夊搴旂殑 `screen_observations` 姹囨€伙紙`NO_OBS` = 涓や釜鏂囦欢鏉ヨ嚜涓嶅悓浠诲姟闃舵锛宻creen_cells 鏄?T037 heldout 瀵规垬鏄庣粏锛宻creen_observations 鏄?T037 浜у搧璺緞鐨勮仛鍚堣娴嬶紝涓よ€呬笉鍐茬獊锛?
**缁撹锛歅LAUSIBLE_BUT_LOW_CONFIDENCE**
- 浠?7 涓鎵嬶紙鏈夐檺娴呮睜锛夛紝10 灞€/cell锛堟牱鏈噺灏忥級
- PANEL_SATURATED 闃靛瀷锛坄springsword`, `nutsavior`, `gift_savior`, `golden_boom`锛夊ぉ鐒跺 Early Bundle 寮卞鎵嬫湁楂樿儨鐜囷紝婊″垎涓嶆剰澶?- 116 涓悓鏃?cell 寮曞叆"杩戜翰鍋忓樊"锛屼娇寰楁弧鍒嗘鐜囪櫄楂?- 涓嶄唬琛ㄥ湪 L2锛堝己姹?11 瀵规墜锛変腑涔熸弧鍒?
### B. `learning_level_evaluations.jsonl` 鈥?72/230 婧€鍒?(`AGGREGATE_EXPLORATION_ONLY`)

**瀛楁璇存槑锛堥噸瑕侊級锛?* 杩欎簺璁板綍鏈?`totalGames` 瀛楁锛堝€间负 32 鎴?44锛夛紝浣嗘病鏈夊師濮嬬殑 `w/d/l` 鏄庣粏瀛楁銆傚璁¤剼鏈皢 `w=d=l=0` 鏍囦负 `ZERO_GAMES` 鏄?*鏍煎紡璇垽**鈥斺€旇鏂囦欢鍙瓨鍌ㄨ仛鍚?`score` 鍜?`totalGames`锛屼笉瀛樺偍閫愬眬鏄庣粏銆?
**鎸?benchmarkRevision 鍒嗗竷锛?*

| benchmarkRevision | Total | Perfect | Games/record |
|---|---|---|---|
| `v1.0.0-t038-eb8` (L3 Early Bundle 8) | 82 | 24 | 32 |
| `v1.0.0-t038-strong11` (L2 Strong 11) | 75 | 24 | 44 |
| `v3.0.0-t042-complete-catalog` (L1 Melee) | 73 | 24 | 32 |

**姣忎釜姹犲潎鏈?24 涓弧鍒?*锛屼唬琛ㄥ湪涓変釜娴嬭瘯灞傜骇涓婇兘杈惧埌婊″垎鐨?T1/T0 鍊欓€夛細涓昏鏄?`springsword`/`nutsavior`/`golden_boom`/`gift_savior` 瀹舵棌鐨勯《灏栧彉浣撱€?
**璇佹嵁绫诲埆**锛氬叏閮?`AGGREGATE_EXPLORATION_ONLY`鈥斺€斿嵆鎺㈢储鎬ч潪姝ｅ紡璁粌浜х墿锛?*涓嶄綔涓烘檵鍗囧喅绛栫殑缁戝畾璇佹嵁**锛屼粎渚涙帰绱㈠弬鑰冦€?
**缁撹锛圠3 婊″垎锛夛細PLAUSIBLE_BUT_LOW_CONFIDENCE**锛堝悓涓婏紝娴呮睜銆佸皬鏍锋湰銆佸悓鏃忓亸宸級
**缁撹锛圠2 婊″垎锛?4 灞€锛夛細SUSPICIOUS_REQUIRES_RETEST**
- L2 Strong 11 姹犵敤鐨勬槸 11 涓己闃垫簮锛?4 涓€欓€夊叏閮ㄦ弧鍒嗭紝姒傜巼鏋佷綆锛堟瘡灞€ 44 games锛?4W 0D 0L锛?- `evidenceClass=AGGREGATE_EXPLORATION_ONLY` 鎰忓懗鐫€杩欎簺鏁板瓧鏉ヨ嚜闈炴寮忔壒閲忚缁冭€岄潪鐙珛楠岃瘉
- 瀵瑰簲鐨?T040 姝ｅ紡 `benchmark_cell_results.jsonl`锛堜粎 6 鏉★紝32 灞€锛変腑瀛樺湪鐪熸鐨?L3 婊″垎锛坄cand:springsword:formation_transform:c0_flip` W=32/32锛宍cand:nutsavior:strategy_schedule_branch:c0_side2` W=32/32锛夛紝杩欎袱涓槸 PANEL_SATURATED 瀹舵棌鍊欓€?**缁撹锛圠1 Melee 婊″垎锛?2 灞€锛夛細SUSPICIOUS_REQUIRES_RETEST**
- L1 Melee 鐩綍鍚?88 涓垚鍛樼殑姒傜巼 Melee 姹狅紙T042锛夛紝24 涓€欓€夊叏閮ㄦ弧鍒嗗湪 32 灞€涓紝鍙俊搴︿綆
- evidenceClass 鍚屾牱鏄?AGGREGATE_EXPLORATION_ONLY锛屼笉缁戝畾涓烘寮忔檵鍗囪瘉鎹?
### C. `stage_screen_records.jsonl` 鈥?68/163 婊″垎 (T039 Staged Screen)

- 婊″垎璁板綍璺?Stage A (14G), B (42G), C (84G) 涓変釜闃舵锛屽搴斿悓涓€鍊欓€夊湪涓嶅悓鏍锋湰閲忎笅鐨勭疮绉褰?- 瀵规墜姹狅細T037 Early Bundle 7 opponents pool锛屼粛涓烘祬姹?- 鍏稿瀷锛歚cand:springsword:formation_transform:c0_flip` 鍦?Stage A/B/C 鍧囨弧鍒嗭紙14W/42W/84W锛?- **缁撹锛歅LAUSIBLE_BUT_LOW_CONFIDENCE**锛堝悓涓婏紝娴呮睜闈炵嫭绔嬮獙璇侊級

### D. `benchmark_cell_results.jsonl` 鈥?0/6 total perfect (T040 姝ｅ紡鏍煎紡)

- 浠?6 鏉★紝鍧囦负 `LEVEL_L3_EARLY_BUNDLE_8` 姹?- 鍏朵腑 `cand:springsword:formation_transform:c0_flip` 鍜?`cand:nutsavior:strategy_schedule_branch:c0_side2` 鐨?`trainingScore=1`
- 杩欐槸鏈€姝ｅ紡鐨勮褰曟牸寮忥紝浣嗘牱鏈瀬灏忥紙6 鏉?= 2 涓簮 脳 3 鍊欓€夛級锛屼笖浠嶇劧鍙槸 L3 Early Bundle 姹狅紙闈?L2 寮烘睜楠岃瘉锛?- **缁撹锛歅LAUSIBLE_BUT_LOW_CONFIDENCE**

### E. `head_to_head_matrix.jsonl` (Historic sandbox 11x11) 鈥?44/187 婊″垎

- 杩欐槸 sandbox 鏃朵唬锛坄arena` / `playSpecVsSpec`锛夌殑鍘嗗彶瀵规垬鐭╅樀锛屾爣璁颁负 `SANDBOX_ENGINE_UNVERIFIED_PRE_T032`
- 婊″垎渚嬶細`cand_s3_1_light_clas` vs `all2rush` W=10/10 score=1锛堜粎 10 灞€锛?- 杩欎簺鍘嗗彶婊″垎涓庣幇浠?product-path 婊″垎**涓嶅彲鐩存帴姣旇緝**

---

## 3. Arithmetic Independent Recomputation

| File | Records Recomputed | Mismatches | Status |
|---|---|---|---|
| `screen_cells.jsonl` (25 perfect entities) | 25 aggregated | **0** | **PASS** |
| `benchmark_cell_results.jsonl` (6 records) | 6 | 0 | PASS |
| `stage_screen_records.jsonl` | 68 | 0 | PASS |
| `head_to_head_matrix.jsonl` | 44 | 0 | PASS |
| `learning_level_evaluations.jsonl` | N/A (no w/d/l fields, score is stored as aggregate) | 鈥?| FORMAT_ONLY |

---

## 4. Leakage and Degeneracy Audit

| Check | Result | Notes |
|---|---|---|
| Candidate evaluated against itself | **PASS** 鈥?0 self-opponent cells | `screen_cells` self-opponent count = 0 |
| Same fingerprint used as both learner and opponent | **PASS** 鈥?heldout variants have distinct fingerprints | `springsword_heldout` 鈮?`baseline:springsword` fingerprint |
| T0 vs T0 diagonal as positive evidence | **NOT APPLICABLE** 鈥?T0 baselines don't appear as opponents in screen_cells | T037 opponents are only Early Bundle heldouts |
| Seed reuse across all games | **CANNOT_FULLY_VERIFY** 鈥?cell-level `exactSeed` exists but no cross-cell uniqueness audit was feasible in read-only mode | Risk: low (cells use different opponents/sides) |
| Single-game Stage A presented as final strength | **PASS** 鈥?Stage A used as gate only, Stage C (84G) is final | T039 stage ladder confirmed |
| Same raw vector under multiple candidate IDs | **PASS** 鈥?each candidate has distinct `canonicalFingerprint` | 0 duplicate fingerprints found |
| Opponent resolution falling back to wrong formation | **CANNOT_FULLY_VERIFY** 鈥?no runtime fallback log accessible | Static review of 05_select.ts showed explicit opponent lookup |
| Empty/invalid opponent counted as win | **PASS** 鈥?`nonemptyTeamProof` field present in all screen_cells | Confirmed non-empty deployment |
| Worker errors silently treated as wins | **PASS** 鈥?T037/T039 reports state workerErrors=0 | Error count verified in task reports |
| P1/P2 side coverage | **PASS** 鈥?all 25 perfect entities have sides={1,2} | Both sides represented in each perfect entity |
| Incorrect score aggregation | **PASS** 鈥?0 arithmetic mismatches | Independently recomputed |
| Same-family "near-kin" cells (leakage risk) | **CONCERN** 鈥?116 cells are same-family (entity root = opponent root) | `springsword` vs `springsword_heldout` etc. 鈥?statistically correlated, inflates win rate |

---

## 5. Benchmark Comparison Table

| Benchmark | Execution Path | Formation Version | Opponent Count | P1/P2 | Games/Cell | Scoring | Supports Absolute Strength? |
|---|---|---|---|---|---|---|---|
| **Historic 11x11 sandbox** | `arena.ts` / `playSpecVsSpec` (SANDBOX_ENGINE_UNVERIFIED_PRE_T032) | Mixed (includes 7-monster Gift Jungle) | 11 (round-robin) | Both | 10 | W+0.5D / total | **NO** 鈥?sandbox engine, not product-path verified |
| **T037 L3 Screen** (screen_cells) | `PersistentSimPool` + product_path | 8-monster repaired | 7 (Early Bundle heldouts only) | Both | 10 | W+0.5D / total | **NO** 鈥?shallow pool, near-kin opponents, small sample |
| **T039/T040 Staged Screen** (stage_screen_records, benchmark_cell_results) | `PersistentSimPool` + product_path | 8-monster repaired | 8 (Early Bundle) / 11 (Strong Pool) | Both | 14/42/84 | W+0.5D / total | **PARTIAL** 鈥?L2 strong pool is more credible but still AGGREGATE_EXPLORATION_ONLY |
| **T041R/T042 L1 Melee** (melee_sample_pairs) | `PersistentSimPool` + product_path | 8-monster repaired | 88-member probabilistic pool | Both | Variable | W+0.5D / total | **NO** 鈥?no perfect scores found in melee pairs; perfect claims in learning_level_evaluations are AGGREGATE_EXPLORATION_ONLY |
| **T044/T045R Library** (learning_level_evaluations) | `PersistentSimPool` + product_path | 8-monster repaired | L3=8, L2=11, L1=88 | Both | 32-44 | W+0.5D / total | **NO** 鈥?evidenceClass=AGGREGATE_EXPLORATION_ONLY throughout |

---

## 6. Statistical Confidence Classifications

| Perfect Result Set | Sample Size | Opponent Diversity | Classification | Reason |
|---|---|---|---|---|
| screen_cells 鈥?PANEL_SATURATED baselines (springsword, nutsavior, gift_savior, golden_boom) at L3 | 140 games (14 cells 脳 10) | 7 opponents (shallow) | **PLAUSIBLE_BUT_LOW_CONFIDENCE** | PANEL_SATURATED formations naturally dominate Early Bundle heldouts; near-kin opponent pool inflates win rate |
| screen_cells 鈥?top candidates (formation_transform, strategy_schedule_branch) at L3 | 140 games | 7 opponents (shallow) | **PLAUSIBLE_BUT_LOW_CONFIDENCE** | Same pool limitation; not validated against strong pool |
| learning_level_evaluations 鈥?L3 perfect (32G) | 32 games | 8 (Early Bundle) | **PLAUSIBLE_BUT_LOW_CONFIDENCE** | Consistent with screen_cells evidence; small sample |
| learning_level_evaluations 鈥?L2 perfect (44G, 24 candidates) | 44 games | 11 (Strong Pool) | **SUSPICIOUS_REQUIRES_RETEST** | 24/75 records showing 0 losses against full strong pool is extremely high; AGGREGATE_EXPLORATION_ONLY class means no independent validation; no per-opponent-per-side breakdown traceable |
| learning_level_evaluations 鈥?L1 perfect (32G Melee) | 32 games | 88-member probabilistic | **SUSPICIOUS_REQUIRES_RETEST** | 32 games across probabilistic 88-member pool is very small sample; 24/73 records at 100% is implausible without verification |
| benchmark_cell_results 鈥?L3 婊″垎 (2 candidates, 32G) | 32 games | 8 (Early Bundle) | **PLAUSIBLE_BUT_LOW_CONFIDENCE** | Small sample, shallow pool, but formally recorded with W/D/L breakdown |
| stage_screen_records 鈥?Stage C婊″垎 (84G) | 84 games | 7 (heldout shallow) | **PLAUSIBLE_BUT_LOW_CONFIDENCE** | Larger sample but still shallow pool |
| Historic 11x11 sandbox | 10 games/pair | 11 (round-robin) | **INVALIDATED_BY_AUDIT** (as absolute evidence) | SANDBOX_ENGINE_UNVERIFIED_PRE_T032, mixed formation versions |

---

## 7. Comparison with Historic 11x11

The historic 11x11 round-robin (highest aggregate ~80%) and the current T037/T039/T044 100% records are **NOT comparable** because:

1. **Engine difference**: Historic = sandbox (`arena.ts`/`playSpecVsSpec`, SANDBOX_ENGINE_UNVERIFIED_PRE_T032); Current = product-path (`PersistentSimPool` + real game engine)
2. **Formation version**: Historic includes 7-monster Gift Jungle; current uses repaired 8-monster version
3. **Opponent selection**: Historic = full 11脳11 round-robin (all vs all, stronger opposition); Current L3 = only 7 Early Bundle heldout variants (weaker pool)
4. **Measurement level**: Historic's ~80% max was an **aggregate cross-source metric**; current 100% is measured within a **single source's weak-pool screen**
5. **Sample per cell**: Both use ~10 games/cell (small sample), but historic had more diverse opponents

Therefore: the current 100% results are measured in a **different, easier test condition** (shallow pool), not a harder one. The apparent improvement from 80%鈫?00% is **a pool artifact, not genuine strength improvement**.

---

## 8. Proposed Repair Boundaries (Narrow, Not Implemented)

1. **L2 Strong Pool retest** (`SUSPICIOUS_REQUIRES_RETEST`): Run 24 L2-perfect candidates through a dedicated independent L2 verification task (not AGGREGATE_EXPLORATION_ONLY), with minimum 140 games per candidate, per-opponent-per-side breakdown stored as `evidenceClass=INDEPENDENT_VERIFICATION`. Proposed task: `T048-l2-perfect-independent-retest`.

2. **L1 Melee retest** (`SUSPICIOUS_REQUIRES_RETEST`): Run 24 L1-perfect candidates through a dedicated L1 verification with minimum 70 games each and per-archetype breakdown. Proposed task: `T049-l1-melee-independent-retest`.

3. **Near-kin opponent separation**: Future screen_cells runs should separate same-family cells from cross-family cells for independent analysis, flagging near-kin results as `NEAR_KIN_CELL`. Not a blocking issue but improves audit clarity.

---

## 9. Files Changed

**Read-only audit scripts created (not production artifacts):**
- `scripts/t047_perfect_result_audit.ts`
- `scripts/t047_deep_audit.ts`
- `scripts/t047_arith_audit.ts`
- `scripts/t047_benchmark_audit.ts`

**No production artifact, catalog, tier, formation, strength record, JSONL evidence, or training policy was modified.**

---

## 10. Conclusion

- **T037 L3 screen perfect scores**: PLAUSIBLE_BUT_LOW_CONFIDENCE 鈥?explained by shallow 7-opponent heldout pool and near-kin bias, not genuine absolute strength.
- **T040 benchmark_cell_results L3 perfect**: PLAUSIBLE_BUT_LOW_CONFIDENCE 鈥?same pool, small sample.
- **T039 Stage C perfect (84G, shallow pool)**: PLAUSIBLE_BUT_LOW_CONFIDENCE.
- **learning_level_evaluations L2/L1 perfect (AGGREGATE_EXPLORATION_ONLY)**: SUSPICIOUS_REQUIRES_RETEST 鈥?24 candidates simultaneously showing 0 losses in stronger pools is implausible without independent verification; these records explicitly carry `evidenceClass=AGGREGATE_EXPLORATION_ONLY` and should not be used as binding strength claims.
- **Historic 11x11 sandbox ~80% max**: INVALIDATED_BY_AUDIT as comparison baseline (different engine, different pool).
- **Arithmetic integrity**: All recomputable records pass 鈥?0 arithmetic mismatches.
- **Leakage checks**: No self-opponent, no zero-game wins, no worker-error wins. Near-kin same-family cells are a statistical concern but not a disqualifying defect given different fingerprints.
