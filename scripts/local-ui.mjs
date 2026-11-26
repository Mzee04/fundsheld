import assert from "node:assert/strict";
import { setTimeout as pause } from "node:timers/promises";
import { createServer } from "vite";
import { parseHTML } from "linkedom";
import { createServer as createHttpServer } from "node:http";
import { once } from "node:events";
import hre from "hardhat";
import { BrowserProvider, id, parseEther, toQuantity, zeroPadValue } from "ethers";

assert.equal(hre.network.name, "hardhat");
const rpc = new BrowserProvider(hre.network.provider, undefined, { cacheTimeout: -1 });
const owner = "0x0000000000000000000000000000000000001001";
const reader = "0x0000000000000000000000000000000000001002";
let visitId = 0;
let clipboard;
let clipboardBlocked = false;
const stored = new Map();
Object.defineProperty(globalThis, "navigator", {
  value: { clipboard: { writeText: async value => {
    if (clipboardBlocked) throw Error("Clipboard unavailable");
    clipboard = value;
  } } },
  configurable: true,
});
const testExplorer = "https://explorer.example";
const manifest = {
  chainId: 31337,
  token: "0x0000000000000000000000000000000000002001",
  vault: "0x0000000000000000000000000000000000002002",
  decimals: 6,
  symbol: "mQUSDC",
  deploymentBlock: 0,
};

const emptyAddress = "0x0000000000000000000000000000000000002003";
const otherToken = "0x0000000000000000000000000000000000002004";
const scoped = id => `/proof/${id}?chain=31337&vault=${manifest.vault}`;
const build = await hre.artifacts.getBuildInfo("contracts/FundsHeldVault.sol:FundsHeldVault");
const vaultCode = build.output.contracts["contracts/FundsHeldVault.sol"].FundsHeldVault.evm.deployedBytecode;
const tokenWord = zeroPadValue(manifest.token, 32).slice(2);
let runtime = vaultCode.object;
for (const { start, length } of Object.values(vaultCode.immutableReferences).flat()) {
  assert.equal(length * 2, tokenWord.length);
  runtime = runtime.slice(0, start * 2) + tokenWord + runtime.slice((start + length) * 2);
}
const mock = await hre.artifacts.readArtifact("MockQUSDC");
await rpc.send("hardhat_setCode", [manifest.token, mock.deployedBytecode]);
await rpc.send("hardhat_setCode", [manifest.vault, `0x${runtime}`]);
await rpc.send("hardhat_setCode", [otherToken, mock.deployedBytecode]);
// Initialize ReentrancyGuard's status slot as its constructor would.
await rpc.send("hardhat_setStorageAt", [manifest.vault, "0x0", zeroPadValue("0x01", 32)]);

assert.equal((await rpc.getNetwork()).chainId, 31337n);
for (const address of [owner, reader]) {
  await rpc.send("hardhat_impersonateAccount", [address]);
  await rpc.send("hardhat_setBalance", [address, toQuantity(parseEther("10"))]);
}

const rpcServer = createHttpServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const { id, method, params } = JSON.parse(Buffer.concat(chunks));
  const payload = { jsonrpc: "2.0", id };
  try {
    payload.result = await hre.network.provider.send(method, params);
  } catch (error) {
    payload.error = { code: error.code ?? -32000, message: error.message, data: error.data };
  }
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
});
rpcServer.listen(0, "127.0.0.1");
await once(rpcServer, "listening");

const server = await createServer({
  server: { host: "127.0.0.1", port: 5173, watch: null, hmr: false },
  plugins: [{
    name: "local-explorer-fixture",
    enforce: "pre",
    transform(source, id) {
      if (id.includes("/web/app.js?")) {
        const fixtures = id.includes("unconfigured-fixture") ? {}
          : id.includes("novault-fixture") ? { "./deployments/31337.json": { ...manifest, vault: emptyAddress } }
          : id.includes("wrongtoken-fixture") ? { "./deployments/31337.json": { ...manifest, token: otherToken } }
          : { "./deployments/31337.json": manifest };
        source = source.replace('import.meta.glob("./deployments/*.json", { eager: true, import: "default" })',
          JSON.stringify(fixtures)).replace("import.meta.env.VITE_CHAIN_ID", "31337");
        if (id.includes("mainnet-fixture")) {
          source = source.replace("../network.json", "../network.json?mainnet-fixture");
        }
        return source;
      }
      if (!id.split("?")[0].endsWith("/network.json")) return;
      const networks = JSON.parse(source);
      networks.local.explorer = testExplorer;
      networks.local.rpc = `http://127.0.0.1:${rpcServer.address().port}`;
      if (id.includes("mainnet-fixture")) {
        // Render the mainnet UI against the unsigned local chain, never a public RPC.
        networks.mainnet = { ...networks.local, name: "QIE Mainnet fixture" };
      }
      return JSON.stringify(networks);
    },
  }],
});
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const read = async path => {
    const response = await fetch(new URL(path, origin));
    assert.equal(response.status, 200);
    return response.text();
  };

  await visit("/", null, async doc => {
    await until(() => doc.body.textContent.includes("Deploy the contracts"));
    assert.equal(doc.querySelector('meta[name="description"]').content, "Create and verify on-chain reserved funds on QIE.");
  }, { fixture: "unconfigured" });

  let expiry, linkWithNote;
  await visit("/", owner, async doc => {
    await click(doc, "#connect", () => doc.querySelector('[data-action="mint"]'));
    await click(doc, '[data-action="mint"]', () => doc.body.textContent.includes("1000.0 mQUSDC"));
    await submit(doc, "deposit", { amount: "500" }, () => doc.querySelector(".balances strong").textContent === "500.0 mQUSDC");
    const block = await rpc.send("eth_getBlockByNumber", ["latest", false]);
    expiry = Number(BigInt(block.timestamp)) + 600;
    const localDate = new Date(expiry * 1000);
    const fieldValue = new Date(localDate.getTime() - localDate.getTimezoneOffset() * 60_000)
      .toISOString().slice(0, 19);
    await submit(doc, "issue", { reader: owner, amount: "1", expiry: fieldValue, note: "" },
      () => doc.querySelector("#message").textContent.includes("other than your own"));
    const tooFar = new Date(localDate.getTime() + 367 * 86400 * 1000)
      .toISOString().slice(0, 19);
    await submit(doc, "issue", { reader, amount: "1", expiry: tooFar, note: "" },
      () => doc.querySelector("#message").textContent.includes("within 366 days"));
    await submit(doc, "issue", { reader, amount: "300", expiry: fieldValue, note: "Local test note & # /" },
      () => doc.querySelector(`a[href="${scoped(1)}"]`));
    const confirmation = doc.querySelector("#message");
    assert.equal(confirmation.hidden, false);
    assert.equal(doc.querySelector("#confirmed-proof").hidden, false);
    assert.equal(doc.querySelector("#message-text").textContent, "Transaction confirmed.");
    const shown = doc.querySelector("#confirmed-proof-link");
    assert.equal(shown.textContent, shown.getAttribute("href"));
    const shared = new URL(shown.getAttribute("href"));
    assert.equal(shared.pathname, "/proof/1");
    assert.equal(shared.searchParams.get("chain"), "31337");
    assert.equal(shared.searchParams.get("vault"), manifest.vault);
    const fragment = new URLSearchParams(shared.hash.slice(1));
    assert.equal(fragment.get("n"), "Local test note & # /");
    assert.match(fragment.get("s"), /^0x[0-9a-f]{64}$/);
    clipboardBlocked = true;
    await click(doc, "#copy-confirmed-proof", () => doc.querySelector("#message-text").textContent.startsWith("Could not copy"));
    assert.equal(doc.querySelector("#confirmed-proof").hidden, false);
    assert.equal(shown.textContent, shown.getAttribute("href"));
    clipboardBlocked = false;
    await click(doc, "#copy-confirmed-proof", () => clipboard === shown.getAttribute("href"));
    assert.equal(doc.querySelector("#message-text").textContent, "Proof link copied.");
    assert.equal(shown.getAttribute("href"), clipboard);
    linkWithNote = clipboard;
    await click(doc, '[data-action="copy"][data-id="1"]', () => clipboard?.endsWith(scoped(1)));
    assert.equal(new URL(clipboard).hash, "");
    await click(doc, '[data-action="copy-note"][data-id="1"]', () => clipboard.includes("#n="));
    assert.equal(clipboard, linkWithNote);
    await submit(doc, "issue", { reader, amount: "100", expiry: fieldValue, note: "" },
      () => doc.querySelector(`a[href="${scoped(2)}"]`));
    assert.equal(doc.querySelector("#confirmed-proof").hidden, true);
    assert.equal(doc.querySelector("#confirmed-proof-link").textContent, "");
    await submit(doc, "withdraw", { amount: "101" }, () => !doc.querySelector("#message").hidden &&
      doc.querySelector("#message").textContent.includes("enough free funds"));
    await submit(doc, "withdraw", { amount: "100" },
      () => doc.querySelector(".balances strong").textContent === "400.0 mQUSDC");
    await click(doc, '[data-action="revoke"][data-id="2"]', () => doc.querySelector(".status.revoked"));
    assert.equal(doc.querySelector('[data-action="copy-note"][data-id="2"]'), null);
    await submit(doc, "issue", { reader, amount: "50", expiry: fieldValue, note: "" },
      () => doc.querySelector(`a[href="${scoped(3)}"]`));
  });

  await visit(linkWithNote, null, async doc => {
    await until(() => doc.querySelector(".status.pending"));
    assert.equal(doc.querySelector(".status").textContent, "Pending — owner can still cancel");
    assert.doesNotMatch(doc.body.textContent, /guarantee/i);
    assert.match(doc.body.textContent, /The reader cannot claim or withdraw them/);
    assert.equal(doc.querySelector(".note-text").textContent, "Local test note & # /");
    assert.match(doc.body.textContent, /matches the on-chain hash/);
    assert.match(doc.querySelector(".read-stamp").textContent, /^Read from FundsHeld Local at block \d+\.$/);
    assert.match(doc.body.textContent, /chain 31337/);
    const [issued] = await rpc.getLogs({ address: manifest.vault, fromBlock: manifest.deploymentBlock,
      topics: [id("EarmarkIssued(uint256,address,address,uint256,uint64,bytes32)"), zeroPadValue("0x01", 32)] });
    await until(() => doc.querySelector(`a[href="${testExplorer}/tx/${issued.transactionHash}"]`));
    assert.ok(doc.querySelector(`a[href="${testExplorer}/address/${manifest.vault}"]`));
    assert.equal(stored.get(`fundsheld:31337:${manifest.vault}:issued:1`), issued.transactionHash);
    assert.equal(doc.querySelector(".value").textContent, "300.0 mQUSDC");
    assert.ok(doc.querySelector("dl").textContent.includes(reader));
    assert.equal(doc.querySelector('[data-action="acknowledge"]'), null);
  });
  await visit("/proof/1", reader, async doc => {
    await until(() => doc.querySelector(".status.pending"));
    await click(doc, "#connect", () => doc.querySelector('[data-action="acknowledge"]'));
    await click(doc, '[data-action="acknowledge"]', () => doc.querySelector(".status.locked"));
    assert.match(doc.querySelector(".status").textContent, /^Locked for the named reader until /);
  });
  const tampered = new URL(linkWithNote);
  const fields = new URLSearchParams(tampered.hash.slice(1));
  fields.set("n", "Different note");
  tampered.hash = fields.toString();
  await visit(tampered.href, null, async doc => {
    await until(() => doc.querySelector(".status.locked"));
    assert.match(doc.body.textContent, /Note does not match/);
    assert.equal(doc.querySelector(".note-text"), null);
    assert.doesNotMatch(doc.body.textContent, /Different note/);
  });
  await visit("/proof/2", null, doc => until(() => doc.querySelector(".status.revoked")));
  await visit("/proof/1", null, async doc => {
    await until(() => doc.querySelector(".status.locked"));
    assert.match(doc.body.textContent, /A note was committed/);
  });
  await visit("/proof/1?chain=1990&vault=" + manifest.vault, null,
    doc => until(() => doc.querySelector("h1")?.textContent === "Proof is for another vault"));
  await visit(`/proof/1?chain=31337&vault=${emptyAddress}`, null,
    doc => until(() => doc.querySelector("h1")?.textContent === "Proof is for another vault"));
  await visit("/proof/1", null, doc => until(() => doc.body.textContent.includes("No vault contract was found")),
    { fixture: "novault" });
  await visit("/proof/1", null, doc => until(() => doc.body.textContent.includes("uses a different token")),
    { fixture: "wrongtoken" });
  await visit("/proof/999", null, doc => until(() => doc.querySelector("h1")?.textContent === "Proof not found"));
  await visit(scoped(3), reader, async doc => {
    await until(() => doc.querySelector(".status.pending"));
    await click(doc, "#connect", () => doc.querySelector('[data-action="release"]'));
    await click(doc, '[data-action="release"]', () => doc.querySelector(".status.released"));
    assert.equal(doc.querySelector(".status").textContent, "Released early by the reader");
    assert.equal(doc.querySelector('[data-action="release"]'), null);
  });
  await rpc.send("evm_setNextBlockTimestamp", [expiry]);
  await rpc.send("evm_mine", []);
  await visit("/proof/1", null, async doc => {
    await until(() => doc.querySelector(".status.expired"));
    assert.equal(doc.querySelector(".value").textContent, "0.0 mQUSDC");
  });

  await visit("/", owner, async doc => {
    await click(doc, "#connect", () => doc.querySelector(`a[href="${scoped(3)}"]`));
    const vaultAbi = (await hre.artifacts.readArtifact("FundsHeldVault")).abi;
    const { Contract, JsonRpcSigner } = await import("ethers");
    const ownerSigner = new JsonRpcSigner(rpc, owner);
    await (await new Contract(manifest.vault, vaultAbi, ownerSigner).withdraw(1_000_000n)).wait();
    await click(doc, '[data-action="refresh"]', () => doc.querySelector(".balances strong").textContent === "399.0 mQUSDC");
    assert.match(doc.body.textContent, /Expired/);
    assert.equal(doc.querySelector('[data-action="revoke"][data-id="3"]'), null);
    assert.ok(doc.querySelector('[data-action="copy-note"][data-id="1"]'));
  });

  await visit("/", owner, async doc => {
    await click(doc, "#connect", () => doc.querySelector(".balances"));
    assert.equal(doc.querySelector('[data-action="mint"]'), null);
    assert.doesNotMatch(doc.body.textContent, /test tokens/);
    assert.equal(doc.querySelector(".balances strong").textContent, "399.0 mQUSDC");
  }, { fixture: "mainnet" });

  const { createNameAdapter } = await server.ssrLoadModule("/web/names.js");
  assert.equal(await createNameAdapter(1983).resolve(reader), reader);
  await assert.rejects(() => createNameAdapter(1983).resolve("reader.qie"), /unavailable/);
  assert.equal(await createNameAdapter(1990, async () => reader).resolve("reader.qie"), reader);

  console.log("Local UI integration passed: mint, approve, deposit, issue, protected withdrawal, revoke, all proof statuses, confirmation link and Copy, note sharing and tamper detection, issuing transaction and vault links, scoped proof links and wrong-vault links, deployment checks (missing vault, wrong token), shared note display, read block stamp, dashboard refresh, honest held wording, reader early release, expiry, mainnet mint visibility, plain issue errors, missing proof and name adapter.");

  async function visit(path, walletAddress, scenario, { fixture = "local" } = {}) {
    const { window } = parseHTML(await read(path));
    let connected = false;
    const provider = walletAddress ? {
      request: async ({ method, params = [] }) => {
        if (method === "eth_requestAccounts") {
          connected = true;
          return [walletAddress];
        }
        if (method === "eth_accounts") return connected ? [walletAddress] : [];
        assert.notEqual(method, "eth_sendRawTransaction");
        if (method === "eth_sendTransaction") assert.ok(params[0].to, "Fixture cannot deploy contracts");
        return rpc.send(method, params);
      },
    } : undefined;
    const intervals = [];
    const interval = globalThis.setInterval;
    Object.assign(globalThis, {
      window: { ethereum: provider, localStorage: {
        getItem: key => stored.get(key) ?? null,
        setItem: (key, value) => stored.set(key, value),
      } },
      document: window.document,
      location: new URL(path, origin),
      FormData: class {
        constructor(form) { this.form = form; }
        get(name) { return this.form.querySelector(`[name="${name}"]`).value; }
      },
      setInterval: (callback, delay, ...args) => {
        const timer = interval(callback, delay, ...args);
        if (delay === 12000) intervals.push(timer);
        return timer;
      },
    });
    try {
      await server.ssrLoadModule(`/web/app.js?visit=${++visitId}&${fixture}-fixture`);
      await scenario(window.document);
    } finally {
      for (const timer of intervals) clearInterval(timer);
      globalThis.setInterval = interval;
    }
  }
} finally {
  rpc.destroy();
  await server.close();
  await new Promise(resolve => rpcServer.close(resolve));
}

async function until(test) {
  for (let attempt = 0; attempt < 160; attempt++) {
    if (test()) return;
    await pause(100);
  }
  throw new Error(`UI condition timed out: ${test}. Status: ${document.querySelector("#message").textContent}`);
}

async function click(doc, selector, done) {
  await until(() => doc.querySelector(selector) && !doc.querySelector(selector).disabled);
  doc.querySelector(selector).click();
  await until(done);
}

async function submit(doc, action, values, done) {
  const selector = `form[data-action="${action}"]`;
  await until(() => doc.querySelector(selector) && !doc.querySelector(selector).querySelector("button").disabled);
  const form = doc.querySelector(selector);
  for (const [name, value] of Object.entries(values)) form.querySelector(`[name="${name}"]`).value = value;
  form.dispatchEvent(new doc.defaultView.Event("submit", { bubbles: true, cancelable: true }));
  await until(done);
}
