const assert = require("node:assert/strict");
const hre = require("hardhat");
const { ethers } = require("ethers");

const unit = value => BigInt(value) * 1_000_000n;
const ownerAddress = "0x0000000000000000000000000000000000001001";
const readerAddress = "0x0000000000000000000000000000000000001002";
const otherAddress = "0x0000000000000000000000000000000000001003";
function assertEvent(contract, receipt, name, args) {
  const event = receipt.logs.map(log => contract.interface.parseLog(log)).find(log => log?.name === name);
  assert.ok(event, name);
  assert.deepEqual(Array.from(event.args), args);
}
const send = async transaction => (await transaction).wait();
const rejects = (call, name) => assert.rejects(call, error => {
  assert.match(String(error), new RegExp(name));
  return true;
});

describe("FundsHeldVault", function () {
  this.timeout(90_000);
  let provider, owner, reader, other, token, vault, vaultAddress, tokenAddress;

  async function deploy(name, args = []) {
    const { abi, bytecode } = await hre.artifacts.readArtifact(name);
    return new ethers.ContractFactory(abi, bytecode, owner).deploy(...args);
  }

  async function now() {
    return BigInt((await provider.send("eth_getBlockByNumber", ["latest", false])).timestamp);
  }

  async function advance(time) {
    await provider.send("evm_setNextBlockTimestamp", [Number(time)]);
    await provider.send("evm_mine", []);
  }

  async function issue(amount, expiry, recipient = readerAddress, memoHash = ethers.ZeroHash, issuer = owner) {
    const receipt = await send(vault.connect(issuer).issueEarmark(recipient, amount, expiry, memoHash));
    const event = receipt.logs.map(log => vault.interface.parseLog(log)).find(log => log?.name === "EarmarkIssued");
    assert.ok(event);
    assertEvent(vault, receipt, "EarmarkIssued", [event.args.id, await issuer.getAddress(), recipient, amount, expiry, memoHash]);
    return event.args.id;
  }

  beforeEach(async function () {
    await hre.network.provider.send("hardhat_reset");
    provider = new ethers.BrowserProvider(hre.network.provider, undefined, { cacheTimeout: -1, pollingInterval: 20 });
    for (const address of [ownerAddress, readerAddress, otherAddress]) {
      await provider.send("hardhat_impersonateAccount", [address]);
      await provider.send("hardhat_setBalance", [address, ethers.toQuantity(ethers.parseEther("100"))]);
    }
    owner = new ethers.JsonRpcSigner(provider, ownerAddress);
    reader = new ethers.JsonRpcSigner(provider, readerAddress);
    other = new ethers.JsonRpcSigner(provider, otherAddress);
    token = await deploy("MockQUSDC");
    await token.waitForDeployment();
    tokenAddress = await token.getAddress();
    vault = await deploy("FundsHeldVault", [tokenAddress]);
    await vault.waitForDeployment();
    vaultAddress = await vault.getAddress();
    await send(token.mint(ownerAddress, unit(1000)));
    await send(token.approve(vaultAddress, ethers.MaxUint256));
    assertEvent(vault, await send(vault.deposit(tokenAddress, unit(100))), "Deposited", [ownerAddress, tokenAddress, unit(100)]);
  });

  it("rejects over-earmarking across different readers and rejects withdrawing reserved funds", async function () {
    const expiry = await now() + 100n;
    await issue(unit(75), expiry);
    await rejects(vault.issueEarmark.staticCall(otherAddress, unit(26), expiry, ethers.ZeroHash), "InsufficientFreeBalance");
    await rejects(vault.withdraw.staticCall(unit(26)), "InsufficientFreeBalance");
    assertEvent(vault, await send(vault.withdraw(unit(25))), "Withdrawn", [ownerAddress, tokenAddress, unit(25)]);
    assert.equal(await vault.freeBalance(ownerAddress), 0n);
    assert.equal(await token.balanceOf(vaultAddress), unit(75));
  });

  it("frees funds at the exact expiry and keeps the public certificate", async function () {
    const expiry = await now() + 20n;
    const memoHash = ethers.id("Test memo");
    const id = await issue(unit(75), expiry, readerAddress, memoHash);
    await issue(unit(25), expiry, otherAddress);
    assert.deepEqual(Array.from(await vault.verify(id)), [ownerAddress, readerAddress, unit(75), expiry,
      memoHash, false, false, true, 0n, unit(100), unit(100)]);
    await advance(expiry);
    assert.equal((await vault.verify(id)).active, false);
    assert.equal((await vault.verify(id)).status, 2n);
    assert.equal((await vault.verify(id)).ownerReservedBalance, 0n);
    assert.equal(await vault.freeBalance(ownerAddress), unit(100));
    await send(vault.withdraw(unit(100)));
    assert.equal((await vault.verify(id)).ownerLockedBalance, 0n);
    assert.equal(await vault.earmarkIdAt(ownerAddress, 0n), id);
  });

  it("lets only the named reader acknowledge an active earmark once", async function () {
    const expiry = await now() + 20n;
    const id = await issue(unit(30), expiry);
    await rejects(vault.connect(other).acknowledge.staticCall(id), "Unauthorized");
    await rejects(vault.acknowledge.staticCall(id), "Unauthorized");
    assertEvent(vault, await send(vault.connect(reader).acknowledge(id)), "EarmarkAcknowledged", [id, readerAddress]);
    const proof = await vault.verify(id);
    assert.equal(proof.acknowledged, true);
    assert.equal(proof.active, true);
    assert.equal(proof.status, 1n);
    await rejects(vault.connect(reader).acknowledge.staticCall(id), "AlreadyAcknowledged");
    const expired = await issue(unit(10), expiry);
    await advance(expiry);
    await rejects(vault.connect(reader).acknowledge.staticCall(expired), "InactiveEarmark");
  });

  it("lets only the owner revoke an active pending earmark; revoke-first defeats acknowledgment", async function () {
    const expiry = await now() + 30n;
    const revocable = await issue(unit(30), expiry);
    await rejects(vault.connect(other).revokeEarmark.staticCall(revocable), "Unauthorized");
    assertEvent(vault, await send(vault.revokeEarmark(revocable)), "EarmarkRevoked", [revocable, ownerAddress, readerAddress, unit(30)]);
    const revoked = await vault.verify(revocable);
    assert.equal(revoked.revoked, true);
    assert.equal(revoked.active, false);
    assert.equal(revoked.status, 3n);
    assert.equal(await vault.freeBalance(ownerAddress), unit(100));
    await rejects(vault.connect(reader).acknowledge.staticCall(revocable), "InactiveEarmark");
    await rejects(vault.revokeEarmark.staticCall(revocable), "AlreadyRevoked");
    const accepted = await issue(unit(90), expiry);
    const pending = await issue(unit(10), expiry);
    await send(vault.connect(reader).acknowledge(accepted));
    await rejects(vault.revokeEarmark.staticCall(accepted), "AlreadyAcknowledged");
    await advance(expiry);
    await rejects(vault.revokeEarmark.staticCall(accepted), "InactiveEarmark");
    await rejects(vault.revokeEarmark.staticCall(pending), "InactiveEarmark");
    assert.equal((await vault.verify(accepted)).revoked, false);
    assert.equal((await vault.verify(revocable)).status, 3n);
  });

  it("rejects invalid inputs and separates owner balances", async function () {
    assert.equal(await token.decimals(), 6n);
    const expiry = await now() + 20n;
    await rejects(vault.deposit.staticCall(readerAddress, 1), "InvalidToken");
    await rejects(vault.deposit.staticCall(tokenAddress, 0), "InvalidAmount");
    await rejects(vault.withdraw.staticCall(0), "InvalidAmount");
    await rejects(vault.issueEarmark.staticCall(ethers.ZeroAddress, 1, expiry, ethers.ZeroHash), "InvalidReader");
    await rejects(vault.issueEarmark.staticCall(readerAddress, 0, expiry, ethers.ZeroHash), "InvalidAmount");
    await rejects(vault.issueEarmark.staticCall(readerAddress, 1, await now(), ethers.ZeroHash), "InvalidExpiry");
    await rejects(vault.verify(999), "UnknownEarmark");
    await rejects(vault.connect(other).withdraw.staticCall(1), "InsufficientFreeBalance");
    await rejects(vault.connect(other).issueEarmark.staticCall(readerAddress, 1, expiry, ethers.ZeroHash), "InsufficientFreeBalance");
  });

  it("bounds active scans and reuses slots while preserving historical IDs", async function () {
    const expiry = await now() + 1000n;
    for (let index = 0; index < 64; index++) await issue(unit(1), expiry);
    await rejects(vault.issueEarmark.staticCall(readerAddress, 1, expiry, ethers.ZeroHash), "TooManyActiveEarmarks");
    await send(vault.revokeEarmark(1n));
    assert.equal(await issue(unit(1), expiry), 65n);
    await advance(expiry);
    assert.equal(await issue(unit(1), expiry + 100n), 66n);
    assert.equal(await vault.earmarkCount(ownerAddress), 66n);
    assert.equal((await vault.earmarks(1n)).revoked, true);
    assert.equal((await vault.verify(64n)).active, false);
    assert.equal(await vault.freeBalance(ownerAddress), unit(99));
  });

  it("blocks reentrant mutation during both deposit and withdrawal callbacks", async function () {
    const callback = await deploy("CallbackToken");
    await callback.waitForDeployment();
    const asset = await callback.getAddress();
    const target = await deploy("FundsHeldVault", [asset]);
    await target.waitForDeployment();
    const address = await target.getAddress();
    const guardError = ethers.id("ReentrancyGuardReentrantCall()").slice(0, 10);
    await send(callback.mint(ownerAddress, 100n));
    await send(callback.approve(address, 100n));
    await send(callback.arm(address, target.interface.encodeFunctionData("withdraw", [1n])));
    await send(target.deposit(asset, 100n));
    assert.equal(await callback.attempted(), true);
    assert.equal(await callback.callbackSucceeded(), false);
    assert.equal(await callback.callbackError(), guardError);
    await send(callback.arm(address, target.interface.encodeFunctionData("deposit", [asset, 1n])));
    await send(target.withdraw(30n));
    assert.equal(await callback.attempted(), true);
    assert.equal(await callback.callbackSucceeded(), false);
    assert.equal(await callback.callbackError(), guardError);
    assert.equal(await target.lockedBalance(ownerAddress), 70n);
    assert.equal(await callback.balanceOf(address), 70n);
  });

  it("enforces reader, uint128 and 366-day boundaries", async function () {
    const timestamp = await now();
    const duration = 366n * 86400n;
    const max = (1n << 128n) - 1n;
    assert.equal(await vault.MAX_DURATION(), duration);
    for (const invalidReader of [ownerAddress, vaultAddress]) {
      await rejects(vault.issueEarmark.staticCall(invalidReader, 1, timestamp + 60n, ethers.ZeroHash), "InvalidReader");
    }
    await rejects(vault.issueEarmark.staticCall(readerAddress, 1, timestamp + duration + 1n, ethers.ZeroHash), "InvalidExpiry");
    await vault.issueEarmark.staticCall(readerAddress, 1, timestamp + duration, ethers.ZeroHash);
    await rejects(vault.issueEarmark.staticCall(readerAddress, max + 1n, timestamp + 60n, ethers.ZeroHash), "InvalidAmount");
    await send(token.mint(ownerAddress, max));
    await send(vault.deposit(tokenAddress, max));
    const id = await issue(max, await now() + 60n);
    assert.equal((await vault.verify(id)).amount, max);
  });

  it("packs owner, expiry and both flags into the first earmark storage slot", async function () {
    const expiry = await now() + 90n;
    const memoHash = ethers.id("Layout");
    const id = await issue(30n, expiry, readerAddress, memoHash);
    // Slot 2 is the earmarks mapping, after the guard and lockedBalance.
    const base = BigInt(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [id, 2])));
    const storageWord = async offset => BigInt(await provider.send("eth_getStorageAt",
      [vaultAddress, ethers.toQuantity(base + offset), "latest"]));
    const pending = BigInt(ownerAddress) | (expiry << 160n);
    assert.equal(await storageWord(0n), pending);
    assert.equal(await storageWord(1n), BigInt(readerAddress));
    assert.equal(await storageWord(2n), 30n);
    assert.equal(await storageWord(3n), BigInt(memoHash));
    await send(vault.connect(reader).acknowledge(id));
    assert.equal(await storageWord(0n), pending | (1n << 224n));
    const revokedId = await issue(20n, expiry);
    const revokedBase = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [revokedId, 2]));
    await send(vault.revokeEarmark(revokedId));
    const revokedWord = await provider.send("eth_getStorageAt", [vaultAddress, revokedBase, "latest"]);
    assert.equal(BigInt(revokedWord), pending | (1n << 232n));
  });

  it("rejects fee-on-transfer deposits and checks vault-side withdrawal delta only", async function () {
    const feeToken = await deploy("FeeToken");
    await feeToken.waitForDeployment();
    const asset = await feeToken.getAddress();
    const target = await deploy("FundsHeldVault", [asset]);
    await target.waitForDeployment();
    const address = await target.getAddress();
    await send(feeToken.mint(ownerAddress, 100n));
    await send(feeToken.approve(address, 100n));
    await send(target.deposit(asset, 50n));
    await send(feeToken.enableFee());
    await rejects(target.deposit.staticCall(asset, 20n), "UnexpectedTokenTransfer");
    assert.equal(await target.lockedBalance(ownerAddress), 50n);
    assert.equal(await feeToken.balanceOf(address), 50n);
    await send(target.withdraw(20n));
    assert.equal(await target.lockedBalance(ownerAddress), 30n);
    assert.equal(await feeToken.balanceOf(address), 30n);
    assert.equal(await feeToken.balanceOf(ownerAddress), 69n);
  });

  for (const seed of Array.from({ length: 24 }, (_, index) => 11 + index * 19)) {
    it(`preserves multi-owner reservations across 48 randomized operations (seed ${seed})`, async function () {
      let state = seed;
      const random = modulus => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return (state >>> 8) % modulus;
      };
      const accounts = [[ownerAddress, owner], [otherAddress, other], [readerAddress, reader]];
      const owners = accounts.slice(0, 2).map(([address, signer], index) => ({
        address, signer, locked: index ? 0n : unit(100), reserved: 0n, marks: [],
      }));
      await send(token.mint(otherAddress, unit(1000)));
      await send(token.connect(other).approve(vaultAddress, ethers.MaxUint256));
      for (let index = 0; index < 48; index++) {
        const user = owners[random(owners.length)];
        const action = random(6);
        const amount = unit(random(40) + 1);
        const timestamp = await now();
        const mark = user.marks.length ? user.marks[random(user.marks.length)] : null;
        if (action === 0) {
          await send(vault.connect(user.signer).deposit(tokenAddress, amount));
          user.locked += amount;
        } else if (action === 1 && amount <= user.locked - user.reserved) {
          await send(vault.connect(user.signer).withdraw(amount));
          user.locked -= amount;
        } else if (action === 2 && amount <= user.locked - user.reserved) {
          const expiry = timestamp + BigInt(random(48) + 5);
          const recipients = accounts.filter(([address]) => address !== user.address);
          const [recipient, signer] = recipients[random(recipients.length)];
          const id = await issue(amount, expiry, recipient, ethers.ZeroHash, user.signer);
          user.marks.push({ id, signer, recipient, expiry, amount, revoked: false, accepted: false });
        } else if (action === 3 && mark && !mark.revoked && !mark.accepted && mark.expiry > timestamp + 1n) {
          await send(vault.connect(user.signer).revokeEarmark(mark.id));
          mark.revoked = true;
        } else if (action === 4 && mark && !mark.revoked && !mark.accepted && mark.expiry > timestamp + 1n) {
          await send(vault.connect(mark.signer).acknowledge(mark.id));
          mark.accepted = true;
        } else {
          await advance(timestamp + BigInt(random(12) + 1));
        }
        const after = await now();
        for (const position of owners) {
          const active = current => !current.revoked && current.expiry > after;
          position.reserved = position.marks.filter(active).reduce((sum, current) => sum + current.amount, 0n);
          assert.ok(position.reserved <= position.locked);
          assert.equal(await vault.lockedBalance(position.address), position.locked);
          assert.equal(await vault.freeBalance(position.address), position.locked - position.reserved);
          for (const current of position.marks) {
            const proof = await vault.verify(current.id);
            assert.equal(proof.active, active(current));
            assert.equal(proof.reader, current.recipient);
            assert.equal(proof.status, current.revoked ? 3n : !active(current) ? 2n : current.accepted ? 1n : 0n);
            assert.equal(proof.ownerReservedBalance, position.reserved);
            assert.equal(proof.ownerLockedBalance, position.locked);
          }
        }
        assert.equal(await token.balanceOf(vaultAddress), owners[0].locked + owners[1].locked);
      }
    });
  }
});
