# Test results

## Passed locally

- `npm test` — 41 passing. Covered all five vault event payloads, exact expiry, the 366-day maximum, zero/owner/vault reader rejection, the uint128 amount boundary, packed storage slots and flags, fee-on-transfer deposit rejection, vault-side withdrawal accounting, reentrancy, revoke-first versus acknowledgment, expired revoke rejection, over-earmarking, owner isolation, slot reuse, and all four verification states and owner balances.
- The invariant tests ran 24 deterministic seeds with 48 steps each, for **1,152 steps** across two owners and multiple reader addresses. Every step compared active slices, state, balances, and total vault custody against a reference model.
- Setup tests covered exact mainnet opt-in and chain confirmation, QUSDC selection, chain selection defaults and overrides, hosting rewrites, RPC failover when the primary failed, note-fragment round trips and tampering, proof links bound to chain and vault, and RPC block selection and cross-endpoint disagreement. The CLI also rejected both a missing opt-in and an opted-in noninteractive invocation before accessing a signer.
- `npm run test:ui` — passed against an in-memory Hardhat fixture initialized from compiled runtime bytecode. No deployment command or signing was used by the UI suite. The simulated DOM, wallet, clipboard and explorer covered the confirmation message and full note URL, exact clipboard contents, recovery when clipboard access fails, confirmation without a note, note persistence and tamper detection, the Locked badge, setup and metadata copy, deposit, withdrawal guard, issuance, acknowledgment, revocation, expiry, both explorer links, missing proofs, mainnet mint visibility, scoped and wrong-vault proof links, startup checks for a missing vault and a wrong token, shared note text, the read block stamp, issuing transaction caching, dashboard balance refresh, and the held-funds wording.
- `npm run build` — passed. Solidity artifacts and the production frontend built successfully, including `_redirects`.

## Read-only mainnet check (web app RPC logic)

On 26 Nov 2026 the new read path ran against the live vault with no signing: both QIE mainnet RPC endpoints answered chain 1990, the vault had 5,299 bytes of code, `token()` matched QUSDC, and both endpoints agreed on proof #1 (Locked) and proof #2 (Revoked) at the same block.

## Issue gas before and after

The same `test/gas.cjs` measured transaction receipt gas on local Hardhat with Solidity 0.8.28, Paris, 200 optimizer runs, a fresh vault, one owner, and an empty memo. The first and 64th successful issues leave 1 and 64 active earmarks, respectively.

| Active after issue | Active before | Before | After | Saved |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 0 | 234,351 | 211,378 | 22,973 (9.8%) |
| 64 | 63 | 752,319 | 605,173 | 147,146 (19.6%) |

## Pending live checks and handoff

- Public testnet and mainnet transactions, actual mainnet QUSDC metadata reads by the deploy script, acceptance of a typed confirmation in a live deployment, source submission to the explorer, and a two-wallet run with a browser extension.
- The repo, commits and push, mainnet signing and deployment, publishing the deployment manifest, hosting, and recording the demo video are user-owned. No public-chain deploy or signing was performed in this update.
