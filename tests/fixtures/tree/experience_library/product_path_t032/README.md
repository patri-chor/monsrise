# T032 Product-Path Evidence Recovery

This directory is an append-only, byte-for-byte recovery of the pre-existing local output from
`reports/t032-product-path-formal/` performed by T034. It is deliberately separate from the historic sandbox
assets in the parent directory:

- Historic protocol: `SANDBOX_ENGINE_UNVERIFIED_PRE_T032`.
- Recovered protocol: `PRODUCT_PATH_FORMAL_SCREEN_T032_V1`.
- Recovery status: `PARTIAL_RAW_AGGREGATES_ONLY`.
- Promotion status: `NOT_TIER_2`; no apply/deploy/promotion is implied.

## Recovered immutable files

| File | Source SHA-256 | Recovered SHA-256 | Bytes |
|---|---|---|---:|
| `manifest.json` | `e347411215f31b91f26733a9c8543bb6daee50597edd1811a4a7b46156b7ebc9` | `e347411215f31b91f26733a9c8543bb6daee50597edd1811a4a7b46156b7ebc9` | 794 |
| `observations.jsonl` | `61758ea5ac7ce90eee225ecd6d45d1e04a2029fc80710ae954fc9286621bdd3a` | `61758ea5ac7ce90eee225ecd6d45d1e04a2029fc80710ae954fc9286621bdd3a` | 32165 |
| `cursor.json` | `ffde9717d6f07b6d519e97bb197382126893588a3fcb92ed94b4bbb6b286985a` | `ffde9717d6f07b6d519e97bb197382126893588a3fcb92ed94b4bbb6b286985a` | 2064 |
| `product_path_frontiers.json` | `6699ac985961e0124846fd04fbe1e314e11c3228ddfe31e361f228529e549914` | `6699ac985961e0124846fd04fbe1e314e11c3228ddfe31e361f228529e549914` | 4578 |

`audit.json` is a T034 read-only derivative, not a recovered T032 source file.

## Important Evidence Limits

The recovered T032 candidate records are aggregate W/D/L rows. They contain no raw product baseline records, no
individual four-cost trace ledger, no per-family/per-side/per-seed cell results, no candidate content fingerprint, and
no candidate/opponent placement trace. Consequently the 17 aggregate 140/0/0 rows remain
`SUSPICIOUS_UNTIL_AUDITED`; they are not adoption-quality strength evidence.

No simulation was run for this recovery.
