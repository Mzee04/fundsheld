const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { createServer } = require("node:http");
const { once } = require("node:events");
const { getAddress, ZeroHash } = require("ethers");
const { deploymentPlan } = require("../scripts/deploy-policy.cjs");
const networks = require("../network.json");
const hardhat = require("hardhat");

describe("Deployment and web configuration", function () {
  it("gates mainnet on exact opt-in and confirmation of 1990 and selects only existing QUSDC", async function () {
    const unexpected = () => assert.fail("Confirmation should not be read.");
    await assert.rejects(deploymentPlan("qieMainnet", undefined, unexpected), /FUNDSHELD_ALLOW_MAINNET/);
    await assert.rejects(deploymentPlan("qieMainnet", "YES", unexpected), /FUNDSHELD_ALLOW_MAINNET/);
    await assert.rejects(deploymentPlan("qieMainnet", "yes", async () => "1983"), /did not match/);
    await assert.rejects(deploymentPlan("qieMainnet", "yes", async () => "1990 "), /did not match/);
    const plan = await deploymentPlan("qieMainnet", "yes", async chainId => {
      assert.equal(chainId, 1990);
      return "1990";
    });
    assert.equal(getAddress(plan.existingToken), "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5");
    assert.equal(plan.chain.currency.symbol, "QIE");
    assert.equal(hardhat.config.networks.qieMainnet.chainId, 1990);
    assert.equal((await deploymentPlan("qieTestnet", "yes", unexpected)).existingToken, undefined);
    assert.equal((await deploymentPlan("localhost", "yes", unexpected)).existingToken, undefined);
    await assert.rejects(deploymentPlan("hardhat", "yes", unexpected), /Unsupported/);
  });

  it("switches chain selection and routes direct proof URLs on both hosts", async function () {
    const { selectChain } = await import("../web/network.mjs");
    assert.equal(selectChain(networks, undefined, true).chainId, 1990);
    assert.equal(selectChain(networks, undefined, false).chainId, 31337);
    assert.equal(selectChain(networks, "1983", true).chainId, 1983);
    assert.throws(() => selectChain(networks, "1", true), /Unsupported/);
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
    assert.deepEqual(vercel.rewrites, [{ source: "/proof/:id*", destination: "/index.html" }]);
    assert.equal(readFileSync("public/_redirects", "utf8").trim(), "/proof/* /index.html 200");
  });

  it("falls back to a working RPC when the primary connection fails", async function () {
    this.timeout(15000);
    let failed = 0, served = 0;
    const primary = createServer((request) => { failed++; request.socket.destroy(); });
    const secondary = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const { id, method } = JSON.parse(Buffer.concat(chunks));
      const result = { eth_chainId: "0x7c6", eth_blockNumber: "0x123" }[method];
      if (method === "eth_blockNumber") served++;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
    });
    for (const server of [primary, secondary]) {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
    }
    const address = server => `http://127.0.0.1:${server.address().port}`;
    const { createRpc } = await import("../web/network.mjs");
    const rpc = createRpc({ chainId: 1990, rpc: address(primary), fallbackRpcs: [address(secondary)] });
    try {
      assert.equal(await rpc.getBlockNumber(), 0x123);
      assert.ok(failed > 0);
      assert.ok(served > 0);
    } finally {
      await rpc.destroy();
      await Promise.all([primary, secondary].map(server => new Promise(resolve => server.close(resolve))));
    }
  });

  it("round-trips fragment characters and rejects wrong notes, salts, and uncommitted notes", async function () {
    const { noteHash, proofLink, noteVerdict } = await import("../web/notes.mjs");
    const salt = `0x${"12".repeat(32)}`;
    const note = { note: "Ada + & # = / 👋", salt };
    const committed = noteHash(note);
    const url = new URL(proofLink("https://example.com", 12, note));
    assert.equal(url.pathname, "/proof/12");
    assert.equal(url.search, "");
    assert.equal(noteVerdict(url.hash, committed), "Note matches");
    assert.equal(noteVerdict(url.hash, ZeroHash), "Note does not match");
    assert.equal(noteVerdict("#n=test&s=0x12", committed), "Note does not match");
    assert.equal(noteVerdict(new URL(proofLink(url.origin, 12)).hash, committed), "");
  });
});
