const assert = require("node:assert/strict");
const { network, artifacts } = require("hardhat");
const { BrowserProvider, JsonRpcSigner, ContractFactory, ZeroHash } = require("ethers");

describe("Issue gas", function () {
  it("reports the first and 64th successful issues (starting from 0 and 63 active)", async function () {
    const owner = "0x0000000000000000000000000000000000001001";
    const reader = "0x0000000000000000000000000000000000001002";
    const rpc = new BrowserProvider(network.provider, undefined, { cacheTimeout: -1 });
    await rpc.send("hardhat_impersonateAccount", [owner]);
    await rpc.send("hardhat_setBalance", [owner, "0x56bc75e2d63100000"]);
    const signer = new JsonRpcSigner(rpc, owner);
    async function deploy(name, ...args) {
      const { abi, bytecode } = await artifacts.readArtifact(name);
      return (await new ContractFactory(abi, bytecode, signer).deploy(...args)).waitForDeployment();
    }
    const token = await deploy("MockQUSDC");
    const tokenAddress = await token.getAddress();
    const vault = await deploy("FundsHeldVault", tokenAddress);
    await (await token.mint(owner, 64)).wait();
    await (await token.approve(await vault.getAddress(), 64)).wait();
    await (await vault.deposit(tokenAddress, 64)).wait();
    const { timestamp } = await rpc.send("eth_getBlockByNumber", ["latest", false]);
    const expiry = BigInt(timestamp) + 3600n;
    let first, sixtyFourth;
    for (let count = 1; count <= 64; count++) {
      const receipt = await (await vault.issueEarmark(reader, 1, expiry, ZeroHash)).wait();
      if (count === 1) first = receipt.gasUsed;
      if (count === 64) sixtyFourth = receipt.gasUsed;
    }
    assert.equal(await vault.freeBalance(owner), 0n);
    assert.equal(await vault.earmarkCount(owner), 64n);
    console.log(`    Issue #1: ${first} gas; issue #64: ${sixtyFourth} gas`);
    rpc.destroy();
  });
});
