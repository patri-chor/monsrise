STATUS: DONE
DOMAIN: tree

# T044R Report 鈥?T0 Anchor Role and L1 Status Repair

## Run Commands

```bash
# 楠岃瘉 T0 瑙掕壊淇銆丩1 鐘舵€侀殧绂汇€侀噾瀛楀闂ㄧ涓庡彧璇昏竟鐣岋紙11 澶ч」妫€鏌ュ叏閮ㄩ€氳繃锛?npx vite-node scripts/tree_product_training/check_cycle.ts
```

## Role Separation & T0 Status Repair

- **T0 璇箟淇**锛?  - `learningPermissions`: `[]`锛圱0 浣滀负鍩哄噯涓庡鎵嬫簮锛屼笉浣滀负瀛﹀憳琚帓绋嬭皟搴﹀涔狅級銆?  - `benchmarkRoles`: `['L2_FROZEN_T0_ANCHOR']`锛堝敮涓€鐨?L2 鍐荤粨鍩哄噯閿氱偣锛夈€?  - `opponentCatalogRoles`: `['L1_ROOT_LINEAGE_MEMBER']`锛堜綔涓鸿鎶芥牱瀵瑰眬鐨勫鎵嬫垚鍛橈級銆?  - `l1LearnerStatus`: `NOT_APPLICABLE`锛堢粷涓嶅叿鏈?L1_STABLE / L1_ELIGIBLE 绛夊涔犺€呯姸鎬侊級銆?  - `l1Score`: `null`锛宍l2AttemptsCount`: `null`銆?- **T1 瀛︿範鑰呰涔?*锛?  - 鍞竴鍏佽鍏峰 L1 瀛︿範鑰呯姸鎬侊紙`L1_STABLE` | `L1_DIAGNOSE_REQUIRED` | `L1_ELIGIBLE`锛夈€?- **T2/T3 瀛︿範鑰呰涔?*锛?  - `l1LearnerStatus`: `L1_NOT_PERMITTED`銆?
## Role Table (Before vs. After)

| Tier | Before (T044) | After (T044R Repair) | Benchmark Role | Opponent Role | L1 Learner Status |
|---|---|---|---|---|---|
| **T0** | `l1Status: L1_STABLE`, `l1Score: 1.0` | `l1LearnerStatus: NOT_APPLICABLE`, `l1Score: null` | `L2_FROZEN_T0_ANCHOR` | `L1_ROOT_LINEAGE_MEMBER` | **NOT_APPLICABLE** |
| **T1** | `l1Status: L1_STABLE/DIAG` | `l1LearnerStatus: L1_STABLE/DIAG` | None | None | **L1_STABLE / L1_DIAG** |
| **T2** | `l1Status: NOT_YET_EVAL` | `l1LearnerStatus: L1_NOT_PERMITTED` | None | None | **L1_NOT_PERMITTED** |
| **T3** | `l1Status: NOT_YET_EVAL` | `l1LearnerStatus: L1_NOT_PERMITTED` | None | None | **L1_NOT_PERMITTED** |

## Disjoint Counts Audit

- **Formation Strength Library Counts** (`formation_strength_library.json`):
  - `T0Count`: **11**
  - `T0L1OpponentMemberCount`: **11**锛?00% 鍏峰 L1 瀵规墜鐩綍璧勬牸锛?  - `T0L1LearnerCount`: **0**锛堜弗鏍兼潨缁?T0 娣峰叆瀛︿範鑰呴槦鍒楋級
  - `T1Count`: **10**锛堝悇娴佹淳椤跺皷绮捐嫳锛?  - `T1L1StableCount`: **8**
  - `T1L1DiagnoseRequiredCount`: **2**
  - `T1L1EligibleCount`: **10**
  - `T2Count`: **96**锛堜富鍔涗腑鍧氬眰锛?  - `T3Count`: **29**锛堢害 **21.5%** 鏃╂湡鎺㈢储瀛靛寲灞傦級

## Permission & Opponent Pool Isolation Proof

- **T0 Trainee Dispatch Isolation**:
  - 璋冨害寮曟搸涓ユ牸鍩轰簬 `learningPermissions` 娲惧彂浠诲姟锛孴0 鐨勬潈闄愪负绌哄垪琛?`[]`锛岀粷涓嶄綔涓哄鍛樺弬涓庤缁冭瘎娴嬨€?- **Opponent Catalog Availability**:
  - T0 渚濈劧琚繚鐣欏湪 L2 寮烘睜涓?L1 娴佹淳鐩綍涓紝浣滀负楂樺己搴﹀鎵嬮敋鐐广€?
## Summary Table

| Formation ID | Root T0 | Tier | Benchmark / Opponent Role | L1 Learner Status | L3 Score | L2 Score | L1 Score |
|---|---|---|---|---|---|---|---|
| `t0:springsword` | `springsword` | **T0** | `L2_FROZEN_T0_ANCHOR` / `L1_OPPONENT` | **NOT_APPLICABLE** | 1.000 | 1.000 | **-** |
| `t0:nutsavior` | `nutsavior` | **T0** | `L2_FROZEN_T0_ANCHOR` / `L1_OPPONENT` | **NOT_APPLICABLE** | 1.000 | 1.000 | **-** |
| `t0:all2rush` | `all2rush` | **T0** | `L2_FROZEN_T0_ANCHOR` / `L1_OPPONENT` | **NOT_APPLICABLE** | 1.000 | 0.500 | **-** |
| `cand:springsword:formation_transform:c0_flip` | `springsword` | **T1** | LEARNER | **L1_STABLE** | **1.000** | **1.000** | **1.000** |
| `cand:nutsavior:spatial_local:0` | `nutsavior` | **T1** | LEARNER | **L1_STABLE** | **1.000** | **1.000** | **1.000** |
| `cand:springsword:spatial_local:0` | `springsword` | **T2** | LEARNER | **L1_NOT_PERMITTED** | 0.821 | 0.821 | **-** |
| `cand:all2rush:strategy_schedule_branch:c0_side2` | `all2rush` | **T3** | LEARNER | **L1_NOT_PERMITTED** | 0.500 | **-** | **-** |

## Telemetry & No-Apply Confirmation

- **Telemetry**: `cpuAvg: 78.0%, p95: 86.0%, configuredWorkers: 64`銆?- **No-Apply Confirmation**: 浜х墿涓ユ牸鏍囨敞 `NO_APPLY_NO_DEPLOY_NO_PUBLISH_NO_TIER_CHANGE`锛屼粎浣滀负鑱氬悎瀹為獙鐩綍銆?
