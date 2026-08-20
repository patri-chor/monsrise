STATUS: DONE
DOMAIN: tree

# T046 Report 鈥?Web L1 Melee Challenge and Player Battle History

## Run Commands

```bash
# 楠岃瘉鎺堟潈 80%/85% 闂ㄧ銆乀0 瑙掕壊闅旂銆乄eb 瀵煎嚭銆佸 T1 鏀寔涓庡彧璇昏竟鐣岋紙11 澶ч」妫€鏌ュ叏閮ㄩ€氳繃锛?npx vite-node scripts/tree_product_training/check_cycle.ts

# 楠岃瘉鍓嶇 Vite 鏋勫缓锛堝寘鍚?L1MeleeChallengeManager銆丩1ChallengeHistoryUI 涓?TeamEditorUI/BattleUI 闆嗘垚锛?npx vite build
```

## Authorized Training Policy & T0 Role Preservation

- **淇濈暀鎺堟潈闂ㄧ闃堝€?*锛?  - `T3 -> T2`: L3 score >= 80% (`0.800`)
  - `T2 -> T1`: L2 score >= 85% (`0.850`)
  - `T1 -> T2 (闄嶇骇)`: L2 score < 80% (`0.800`)
  - `[80%, 85%)`: 杩熸粸甯︼紝缁存寔褰撳墠姊槦銆?  - **瀹屽叏绉婚櫎 Top-1-per-root 閰嶉闄愬埗**锛氬嚒鏄揪鍒?85% 鐨勫悎瑙勫彉浣撳潎鍙檵鍗?T1銆?- **淇濈暀 T0 瑙掕壊淇**锛?  - `learningPermissions`: `[]`
  - `benchmarkRoles`: `['L2_FROZEN_T0_ANCHOR']`
  - `opponentCatalogRoles`: `['L1_ROOT_LINEAGE_MEMBER']`
  - `l1LearnerStatus`: `NOT_APPLICABLE`
  - `l1Score`: `null`锛宍l2AttemptsCount`: `null`

## Web-Consumable L1 Challenge Export

- **Web 璧勪骇璺緞**: `public/data/l1_melee_challenge_catalog.json`
- **Schema & Revision**: `T046_WEB_L1_CHALLENGE_CATALOG_V1` | `v3.0.0-t042-complete-catalog`
- **Manifest Hash**: `274c40ee7c243665`
- **鍐呭鏋勬垚**:
  - `totalArchetypes`: **11**锛堝潎绛夋娊鏍锋潈閲?`1/11`锛?  - `totalMembers`: **88**锛堣鐩?11 ROOT + 70 GENERATED + 7 EARLY_HELDOUT锛?  - 鍖呭惈瀹屾暣闃靛 (`team`) 涓庡喅绛栨爲 (`evol`/`tree`) 缁撴瀯锛屽彲渚涘墠绔洿鎺ュ疄渚嬪寲鎵ц銆?
## Web VS AI Entry & Battle Integration

- **浜烘満瀵规垬瀵规墜閫夋嫨鏇挎崲**:
  - 鐐瑰嚮銆愪汉鏈哄鎴樸€戯紙`#lobbyAiModeBtn`锛夋椂锛屽紓姝ュ姞杞?鏍￠獙 L1 鐩綍锛堝甫 `localStorage` 缂撳瓨 fallback锛夛紱
  - 鍧囧寑閫夋嫨鏍规祦娲撅紝鍐嶄緷鎹?`smoothedWeight` 杞洏璧岄€夊嚭瀵规墜蹇収锛?  - 鎸傝浇鑷?`gameEngine.teams[1]` 骞朵繚鐣欑帺瀹舵墜鍔ㄩ€夊崱/甯冮樀浣撻獙锛?  - 瀵规垬鍑嗗涓庡紑鎴樻椂鍦ㄩ《閮?HUD 娓叉煋瀵规墜鏍囩锛歚銆怢1鎸戞垬銆戞硥姘村墤 鍙樹綋 (ROOT) | 娴佹淳: 娉夋按鍓?| FP: 19922046`锛?  - AI 鏀剧疆浣跨敤 `treeStrategyFor(opponent.evol)` 杩涜澹版槑寮忔爲绛栫暐甯冮樀銆?
## Player Battle History & Physical Storage Isolation

- **瀛樺偍 Key**: `localStorage['monsrise.l1ChallengeHistory.v1']`锛堜笂闄?200 鏉★級
- **鐗╃悊闅旂璇佹槑**:
  - 鐜╁瀵规垬缁撴灉浠呭啓鍏ュ鎴风娴忚鍣ㄦ湰鍦板瓨鍌紝缁濅笉鍥炲啓浠讳綍 `product_training` JSONL锛屼笉褰卞搷 L1 鏉冮噸锛屼笉鏀瑰彉姊槦銆?- **UI 闈㈡澘**:
  - 澶у巺鎻愪緵銆愬鎴樿褰曘€戯紙`#lobbyChallengeHistoryBtn`锛夛紝鐐瑰嚮寮瑰嚭澶嶅彜鍍忕礌椋庢垬鎶ラ潰鏉匡紱
  - 灞曠ず鎬诲満娆°€佽儨/璐?骞冲眬鏁般€佹€讳綋鑳滅巼銆佹寜鏍规祦娲剧粺璁℃垬缁╀笌鏈€杩?20 鍦哄灞€璇︽儏锛?  - 鎻愪緵銆愭竻绌鸿褰曘€戝畨鍏ㄦ帶鍒躲€?
## Library Counts & Multi-T1 Proof

- **Formation Strength Library Counts** (`formation_strength_library.json`):
  - `T0Count`: **11**
  - `T0L1OpponentMemberCount`: **11**
  - `T0L1LearnerCount`: **0**
  - `T1Count`: **58**锛堣鐩?10 涓牴娴佹淳鐨勫悎鏍煎彉浣擄紝澶氭牴娴佹淳鏀寔澶氫釜 T1锛?  - `T1L1StableCount`: **35**
  - `T1L1DiagnoseRequiredCount`: **23**
  - `T1L1EligibleCount`: **58**
  - `T2Count`: **5**
  - `T3Count`: **19**

## Summary Table

| Formation ID | Root T0 | Current Tier | Benchmark / Opponent Role | L1 Learner Status | L3 Score | L2 Score | L1 Score |
|---|---|---|---|---|---|---|---|
| `t0:springsword` | `springsword` | **T0** | `L2_FROZEN_T0_ANCHOR` / `L1_OPPONENT` | **NOT_APPLICABLE** | 1.000 | 1.000 | **-** |
| `t0:nutsavior` | `nutsavior` | **T0** | `L2_FROZEN_T0_ANCHOR` / `L1_OPPONENT` | **NOT_APPLICABLE** | 1.000 | 1.000 | **-** |
| `t0:all2rush` | `all2rush` | **T0** | `L2_FROZEN_T0_ANCHOR` / `L1_OPPONENT` | **NOT_APPLICABLE** | 1.000 | 0.500 | **-** |
| `cand:springsword:formation_transform:0` | `springsword` | **T1** | LEARNER | **L1_STABLE** | 0.929 | 0.929 | **0.929** |
| `cand:nutsavior:spatial_local:0` | `nutsavior` | **T1** | LEARNER | **L1_STABLE** | 1.000 | 1.000 | **1.000** |
| `cand:springsword:spatial_local:0` | `springsword` | **T2** | LEARNER | **L1_NOT_PERMITTED** | 0.821 | 0.821 | **-** |
| `cand:all2rush:spatial_local:0` | `all2rush` | **T3** | LEARNER | **L1_NOT_PERMITTED** | 0.429 | **-** | **-** |

## Telemetry & No-Apply Confirmation

- **Telemetry**: `cpuAvg: 78.0%, p95: 86.0%, configuredWorkers: 64`銆?- **No-Apply Confirmation**: 浜х墿涓ユ牸鏍囨敞 `NO_APPLY_NO_DEPLOY_NO_PUBLISH_NO_TIER_CHANGE`锛屼粎浣滀负鑱氬悎瀹為獙鐩綍銆?
