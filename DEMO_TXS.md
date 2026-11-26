# QIE Mainnet demo transactions

Vault: [0xd8e94A1f60F2DE2899297D5583b8C6Cd279d68d8](https://mainnet.qie.digital/address/0xd8e94A1f60F2DE2899297D5583b8C6Cd279d68d8)
Owner: `0xa43CfC81f43a48588C7D927FD5F4b0c7736AbD1c`  
Reader: `0xbE4353601B1401dA2A3dD51F37F2f4cD4A690A52`  

Receipts were checked on the primary QIE RPC. Receipt status is the raw RPC value.

| Step | Transaction hash | Block | Receipt status |
| --- | --- | ---: | --- |
| Deploy FundsHeldVault | [0x6514621f98560f16239bf4d6b89b20ac7b56fa51449cedff837df64963e24cca](https://mainnet.qie.digital/tx/0x6514621f98560f16239bf4d6b89b20ac7b56fa51449cedff837df64963e24cca) | 12175417 | 0x1 |
| Fund reader | [0x0b153d8193925da9bb1ad3779d4bc853dd35cc2c5aeb133101a94f97ef7f5ba3](https://mainnet.qie.digital/tx/0x0b153d8193925da9bb1ad3779d4bc853dd35cc2c5aeb133101a94f97ef7f5ba3) | 12175421 | 0x1 |
| Approve 5 QUSDC | [0xa6e632652eb8d493220c086bcfba199119f685a7b3f5604f29051253a4dfbfa2](https://mainnet.qie.digital/tx/0xa6e632652eb8d493220c086bcfba199119f685a7b3f5604f29051253a4dfbfa2) | 12175423 | 0x1 |
| Deposit 5 QUSDC | [0x94c62165a03dfe0892e0345ec5796181823f4f1cae74f8bb1dc7098226cf6894](https://mainnet.qie.digital/tx/0x94c62165a03dfe0892e0345ec5796181823f4f1cae74f8bb1dc7098226cf6894) | 12175425 | 0x1 |
| Issue 5 QUSDC proof | [0x967c61e16d4a3238c07ce26183dd2770bb75519243e105655ad467c20302c8d9](https://mainnet.qie.digital/tx/0x967c61e16d4a3238c07ce26183dd2770bb75519243e105655ad467c20302c8d9) | 12175427 | 0x1 |
| Reader acknowledges proof #1 | [0x186aba090c2925e69cfa768914c50eb408e54b07e90b17a72246936a64f02236](https://mainnet.qie.digital/tx/0x186aba090c2925e69cfa768914c50eb408e54b07e90b17a72246936a64f02236) | 12175429 | 0x1 |
| Approve 1 QUSDC | [0xbe37cf853a88f4e30fbf0c4a75da8a3c276e20bd5089f924b2c85dacaf42ad67](https://mainnet.qie.digital/tx/0xbe37cf853a88f4e30fbf0c4a75da8a3c276e20bd5089f924b2c85dacaf42ad67) | 12175431 | 0x1 |
| Deposit 1 QUSDC | [0x5c86ec4b273bc0a6f58008144838659c131e13b259cd50bd283bd716378668ff](https://mainnet.qie.digital/tx/0x5c86ec4b273bc0a6f58008144838659c131e13b259cd50bd283bd716378668ff) | 12175433 | 0x1 |
| Issue 1 QUSDC proof | [0x5c05a6e4950833dace8d4063039c0ca04fba1e097e8e1c543ed97f02ad7d1fa5](https://mainnet.qie.digital/tx/0x5c05a6e4950833dace8d4063039c0ca04fba1e097e8e1c543ed97f02ad7d1fa5) | 12175435 | 0x1 |
| Owner revokes proof #2 | [0xe331486edaae1f307d65c046a7ec9f04686df31f85fe8ac43bd5d3fff451f499](https://mainnet.qie.digital/tx/0xe331486edaae1f307d65c046a7ec9f04686df31f85fe8ac43bd5d3fff451f499) | 12175437 | 0x1 |

- `eth_getCode` returned non-empty vault bytecode and `token()` returned the configured mainnet QUSDC address.
- Second 5 QUSDC earmark for Landlord B via `eth_call` reverted with `InsufficientFreeBalance`.
- Proof #1 is Locked for the named reader for 5 QUSDC until 2026-12-02T23:15:33.000Z.
- Withdrawal of the locked 5 QUSDC via `eth_call` reverted with `InsufficientFreeBalance`.
- Proof #2 is Revoked. The 1 QUSDC became free in the vault.

## Final balances

| Address | QIE | QUSDC in wallet |
| --- | ---: | ---: |
| Owner | 0.377850288125 | 2.05516 |
| Reader | 0.0199625645 | 0.0 |

Vault: 6 QUSDC deposited for the owner, 5 reserved and 1 free at the end of the demo.
