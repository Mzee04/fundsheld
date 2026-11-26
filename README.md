Prove you have the money to one person at a time, never to two at once.

Ada deposits 5,000 QUSDC and gives Landlord A a proof link earmarking all 5,000. While the earmark is pending, Ada can revoke it. Landlord A acknowledges the proof, which keeps the full 5,000 held in the vault for them until expiry. Landlord A cannot claim or withdraw the money; it only shows that Ada cannot spend it or promise it to anyone else before expiry. Ada then tries to earmark the same funds for Landlord B, and FundsHeld refuses because her free balance is zero.

- Live URL — TBD
- Mainnet vault (verified): [0xd8e94A1f60F2DE2899297D5583b8C6Cd279d68d8](https://mainnet.qie.digital/address/0xd8e94A1f60F2DE2899297D5583b8C6Cd279d68d8) on QIE Mainnet (chain 1990). Demo transactions: [DEMO_TXS.md](DEMO_TXS.md)
- Mainnet QUSDC — [0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5](https://mainnet.qie.digital/address/0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5)
- Demo video — TBD
- Team — TBD

## How it works

| Approach | What a reader can verify |
| --- | --- |
| Balance-based proof | An owner had a balance at a point in time. The same balance can appear in multiple reports. |
| Token locker | Funds are restricted under locker rules. Conventional lockers do not allocate slices to individual readers. |
| FundsHeld | A bounded slice of funds is set aside on-chain for one reader until expiry. The contract rejects overlapping use of those funds and withdrawals of them. The reader cannot claim them. |

- **Pending.** The slice counts against the owner's free balance. The owner can still cancel it.
- **Locked.** The named reader acknowledged before expiry. The owner cannot cancel or withdraw that slice until expiry. The reader cannot claim it either; at expiry it returns to the owner's free balance.
- **Expired.** The slice became free at its expiry block timestamp. No cleanup transaction is required.
- **Revoked.** The owner canceled a pending slice before expiry. It remains visible in the certificate history.

The owner keeps ownership and gets the funds back at expiry. The reader can verify and acknowledge the reservation, but FundsHeld is not escrow and never pays the reader. The public page reports the amount held for the reader, the reader, the expiry, the shared note when the link carries it, the block it was read at, and the vault and issuing transaction links on supported explorers.

## Architecture and limits

- `FundsHeldVault.sol` is a non-upgradeable, single-token vault with balances separated by owner. `verify(id)` returns the proof, status, owner locked balance, and total owner reserved balance in one read. Both token transfer directions check vault balance deltas. **Fee-on-transfer and rebasing tokens are unsupported.**
- Each owner can maintain **64 active earmarks**. An earmark can last at most **366 days** and can reserve up to `uint128.max` base units. The reader must be a nonzero address distinct from the owner and the vault.
- The reader, owner, amount, expiry, and history are public. Proof IDs are enumerable and scoped to a specific vault deployment. Proof links carry `?chain=<id>&vault=<address>`; the app refuses to show a link that names a different chain or vault. Older links without these fields still open against the configured vault, and the page always shows which network and vault it read.
- Optional notes are committed on-chain as a salted hash. **Copy link with note** adds the note and salt to the URL fragment. The proof page shows the note text only when it matches the on-chain hash. **Copy link without note** omits both. Anyone who receives a note link can read and forward the note. The owner app saves note data in that browser's local storage so it can recreate the link later.
- The Vite frontend reads deployment addresses and units from `web/deployments/<chainId>.json`. Before showing data it checks that the vault has code on the network and that its `token()` matches the configured token. Each read asks every configured QIE RPC for its chain ID and latest block, reads proofs at the lowest common block on every endpoint that answered, and shows an error if they disagree. The page shows the block number and how many endpoints agreed. The issuing transaction lookup is cached in the browser per chain, vault and proof. The owner dashboard refreshes balances every 12 seconds (skipped while you are typing) and has a **Refresh balances** button. The name adapter accepts wallet addresses and has a resolver hook for future `.qie` integration. Mainnet uses the configured QUSDC without a mint control. MockQUSDC is deployable only on testnet or the local Hardhat chain.
- QIE's wallet-facing developer settings list **QIE** with 18 decimals as the mainnet native currency. The chain-access documentation also uses the label QIEV3. [QIE developer wallet settings](https://www.qie.digital/developers) · [QIE chain-access docs](https://docs.qie.digital/getting-started-with-qie-blockchain/4.-access-mainnet-or-testnet)

## Known limitations

These are contract-level items from code review. They need a new vault deployment, so they are **not** in the live mainnet vault `0xd8e94A1f60F2DE2899297D5583b8C6Cd279d68d8`. An implementation with tests is kept on the unmerged `contract-v2` branch and has not been deployed.

- **No early release by the reader.** A reader who no longer needs the hold cannot release it before expiry. The owner waits for expiry.
- **Withdrawals check only the vault's balance change**, not the amount the owner's wallet receives. This is safe for standard ERC-20 tokens such as QUSDC; fee-on-transfer and rebasing tokens are unsupported.
- **Expired or revoked earmarks are not pruned from the owner's active list.** Their slots are reused by later issues, so the 64-slot limit still holds, but issue and balance reads loop over up to 64 entries.
- **Single token, no upgrades, no admin.** A new token or contract change means a new vault and new proof links.
- **Notes in links are readable by anyone with the link.** Share the link with note only with the reader.

## Continuous integration

GitHub Actions (`.github/workflows/ci.yml`) runs on every push to `main` and on pull requests: `npm ci`, contract compile, `npm test`, `npm run test:ui`, and `npm run build`.

## Local development

Use Node.js 24. From the project directory, install with the checked-in lockfile.

```sh
npm ci --no-audit --no-fund
npm test
npm run node
```

In a second terminal, run `npm run deploy:local` and `npm run dev`. Open http://127.0.0.1:5173. Local deployment and tests use Hardhat impersonation with no key-backed accounts. To connect an existing browser wallet for a manual run, add chain 31337 at http://127.0.0.1:8545, then fund only its public address on the local node. Replace `0xYOUR_ADDRESS` below.

```sh
curl -sS http://127.0.0.1:8545 -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"hardhat_setBalance","params":["0xYOUR_ADDRESS","0x8AC7230489E80000"],"id":1}'
```

`npm run test:ui` runs the app with a simulated wallet and DOM against an isolated Hardhat fixture. It requires no running node or deployment and advances only the fixture's block time.

## QIE deployment and hosting

Set `FUNDSHELD_KEYSTORE` to the path of an encrypted Ethereum JSON keystore and supply `FUNDSHELD_KEYSTORE_PASSWORD` through the local process environment. Never place credentials in a public deployment manifest. Fund the signer with gas on the target chain. Testnet gas comes from the [QIE faucet](https://www.qie.digital/faucet).

```sh
npm run deploy:testnet
VITE_CHAIN_ID=1983 npm run build
```

For mainnet, review the contract and wallet, then run the command below in an interactive terminal. Type `1990` when prompted. The script reads QUSDC decimals and symbol on-chain and deploys only the vault.

```sh
FUNDSHELD_ALLOW_MAINNET=yes npm run deploy:mainnet
npm run build
```

Production builds default to 1990. Use `VITE_CHAIN_ID=31337 npm run build` for a local build. Save the relevant public QIE deployment manifests and `package-lock.json` in version control. Publish `dist/` after deployment. Vercel reads `vercel.json`. Hosts that support `_redirects` receive that file in `dist/`. Both serve the app on a direct `/proof/<id>` request.

## Verify the mainnet vault source

1. Use the exact source, lockfile, and build settings from the deployment. Run `npm run compile` and then `node scripts/export-verification.cjs`. The script extracts the unmodified standard compiler input from Hardhat build info. It prints the exact compiler version and writes `artifacts/FundsHeldVault.standard-input.json`.
2. Open [QIE Mainnet Verify & publish contract](https://mainnet.qie.digital/contract-verification). Enter the vault address from `web/deployments/1990.json`. Select **MIT** and **Solidity (Standard JSON Input)**.
3. Select the reported compiler, `v0.8.28+commit.7893614a`. Upload the JSON from step 1. The input captures the Paris EVM target, optimizer enabled with 200 runs, and imported OpenZeppelin sources. If prompted for a contract name, enter `contracts/FundsHeldVault.sol:FundsHeldVault`.
4. Let the explorer autodetect constructor arguments if offered. If it requests manual arguments, enter the QUSDC address ABI-encoded as one 32-byte word, without the `0x` prefix. Generate it with `node -e 'const { AbiCoder } = require("ethers"); const { token } = require("./web/deployments/1990.json"); console.log(AbiCoder.defaultAbiCoder().encode(["address"], [token]).slice(2))'`.
5. Submit verification, then open the vault address page and check that its Contract tab shows verified source. Read `token()` and confirm it returns the QUSDC address above. Replace the mainnet vault placeholder with the verified explorer link.

See [TEST_RESULTS.md](TEST_RESULTS.md) for measured gas and verification coverage.
