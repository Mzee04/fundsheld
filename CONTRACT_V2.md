# Contract v2 (branch `contract-v2`, not deployed)

This branch holds the contract-level fixes from code review. **It is not deployed, not merged into `main`, and no transaction has been signed for it.** The live mainnet vault `0xd8e94A1f60F2DE2899297D5583b8C6Cd279d68d8` runs the `main` contract.

## Changes

- **Reader early release.** `releaseEarmark(id)` lets the named reader give up an active hold, pending or locked. The funds return to the owner's free balance at once. `verify` reports a new `released` flag and status `4` (Released). Emits `EarmarkReleased`.
- **Owner-side withdrawal check.** `withdraw` now checks both the vault's balance drop and the owner's balance rise. A token that delivers less than the amount reverts with `UnexpectedTokenTransfer`.
- **Pruning stale earmarks.** `issueEarmark` removes expired, revoked and released entries from the owner's active list in the same pass that sums active amounts. `pruneEarmarks(owner)` lets anyone compact a list; `activeEarmarkSlots(owner)` reports its length. Emits `EarmarksPruned`.
- **Web app.** Shows the Released status and a **Release early** button for the connected reader. The startup check refuses to read a vault that lacks the v2 interface, so this build cannot misread the live v1 vault.

## Tests

`npm test` — 43 passing, including new release and pruning tests and the stricter withdrawal check. `npm run test:ui` passes, including a reader early release. Issue gas measured by `test/gas.cjs`: 211,951 for the first issue and 612,928 for the 64th (v1: 211,378 and 605,173).

## To ship it (needs the owner's go)

1. Deploy a new vault with `FUNDSHELD_ALLOW_MAINNET=yes npm run deploy:mainnet`, verify the source, and update `web/deployments/1990.json`.
2. Re-run the demo transactions against the new vault. Proof links for the v1 vault stay valid only on a v1 build.
