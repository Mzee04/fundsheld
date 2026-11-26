import { BrowserProvider, Contract, formatUnits, getAddress, hexlify, parseUnits, toQuantity, ZeroAddress, ZeroHash } from "ethers";
import networks from "../network.json";
import vaultArtifact from "../artifacts/contracts/FundsHeldVault.sol/FundsHeldVault.json";
import tokenArtifact from "../artifacts/contracts/MockQUSDC.sol/MockQUSDC.json";
import { createNameAdapter } from "./names.js";
import { consistentBlock, createRpcSet, crossCheck, selectChain } from "./network.mjs";
import { linkScope, noteHash, proofLink, readNote } from "./notes.mjs";
import "./style.css";

const deployments = import.meta.glob("./deployments/*.json", { eager: true, import: "default" });
const chain = selectChain(networks, import.meta.env.VITE_CHAIN_ID, import.meta.env.PROD);
const deployment = deployments[`./deployments/${chain.chainId}.json`];
const configured = Boolean(deployment?.vault && deployment?.token && deployment.chainId === chain.chainId &&
  Number.isInteger(deployment.decimals) && deployment.decimals >= 0 && deployment.decimals <= 80 &&
  typeof deployment.symbol === "string" && deployment.symbol.trim() &&
  Number.isSafeInteger(deployment.deploymentBlock) && deployment.deploymentBlock >= 0);
const isMainnet = chain.chainId === networks.mainnet.chainId;
const names = createNameAdapter(chain.chainId);
const { rpc, providers } = createRpcSet(chain);
const wallet = window.qie ?? window.ethereum;
const vault = configured ? new Contract(deployment.vault, vaultArtifact.abi, rpc) : null;
const token = configured ? new Contract(deployment.token, tokenArtifact.abi, rpc) : null;
const notes = new Map();
const scope = configured ? { chainId: chain.chainId, vault: getAddress(deployment.vault) } : null;
let issuingTransaction;
let deploymentCheck;
let lastRead;
const content = document.querySelector("#content");
const connect = document.querySelector("#connect");
const message = document.querySelector("#message");
const messageText = document.querySelector("#message-text");
const confirmedProof = document.querySelector("#confirmed-proof");
const confirmedProofLink = document.querySelector("#confirmed-proof-link");
const path = location.pathname;
const proof = path.match(/^\/proof\/([1-9][0-9]{0,77})\/?$/);
const proofId = proof && BigInt(proof[1]) < 2n ** 256n ? proof[1] : null;
const isProofPath = path.startsWith("/proof");
const scopeVerdict = configured && proofId ? linkScope(location.search ?? "", scope) : "";
const pageSize = 10n;
const explorer = chain.explorer && configured ? `${chain.explorer}/address/${getAddress(deployment.vault)}` : "";
let account;
let pending = false;
let page = 0n;
let generation = 0;
let renderedHtml;
let issueLookup;

document.querySelector("#network").textContent = chain.name;
const shortAddress = address => `${address.slice(0, 6)}…${address.slice(-4)}`;
const escapeHtml = value => value.replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);
const units = amount => `${formatUnits(amount, deployment.decimals)} ${escapeHtml(deployment.symbol)}`;

const noteKey = id => `fundsheld:${chain.chainId}:${deployment.vault}:note:${id}`;
function getNote(id) {
  if (notes.has(String(id))) return notes.get(String(id));
  try { return JSON.parse(window.localStorage.getItem(noteKey(id))); }
  catch { return null; }
}
const txKey = id => `fundsheld:${chain.chainId}:${deployment.vault}:issued:${id}`;
function cachedIssuingTransaction(id) {
  try {
    const hash = window.localStorage.getItem(txKey(id));
    return /^0x[0-9a-f]{64}$/i.test(hash ?? "") ? hash : undefined;
  } catch { return undefined; }
}
function cacheIssuingTransaction(id, hash) {
  try { window.localStorage.setItem(txKey(id), hash); }
  catch { /* The lookup runs again on the next visit. */ }
}
const shareLink = (id, note) => proofLink(location.origin, id, note, scope);
function saveNote(id, note) {
  notes.set(String(id), note);
  try { window.localStorage.setItem(noteKey(id), JSON.stringify(note)); }
  catch { /* A private browser session can still share the note until reload. */ }
}
const date = expiry => expiry <= 8640000000000n ? new Date(Number(expiry) * 1000).toISOString().replace("T", " ").replace(".000Z", " UTC") : `Unix time ${expiry}`;
function alert(text, noteLink) {
  message.hidden = !text;
  messageText.textContent = text;
  confirmedProof.hidden = !noteLink;
  confirmedProofLink.textContent = noteLink ?? "";
  if (noteLink) confirmedProofLink.setAttribute("href", noteLink);
  else confirmedProofLink.removeAttribute("href");
}
function revertName(error) {
  if (error.revert?.name) return error.revert.name;
  const data = error.data ?? error.info?.error?.data;
  const hex = typeof data === "string" ? data : data?.data;
  try { return hex ? (vault?.interface.parseError(hex) ?? token?.interface.parseError(hex))?.name : undefined; }
  catch { return undefined; }
}

const errorMessages = {
  InvalidToken: "This vault accepts only its configured token.",
  InvalidAmount: "Enter a supported positive amount.",
  InvalidReader: "Choose a reader address other than your own or the vault.",
  InvalidExpiry: "Choose an expiry in the future and within 366 days.",
  InsufficientFreeBalance: "The vault does not have enough free funds for this action.",
  TooManyActiveEarmarks: "You can have up to 64 active earmarks.",
  UnknownEarmark: "This vault has no certificate with that ID.",
  Unauthorized: "This wallet cannot perform that action.",
  InactiveEarmark: "This earmark has expired or been revoked.",
  AlreadyAcknowledged: "The reader has already acknowledged this earmark.",
  AlreadyRevoked: "This earmark has already been revoked.",
  UnexpectedTokenTransfer: "The token transfer changed the vault balance by an unexpected amount.",
  SafeERC20FailedOperation: "The token rejected the transfer.",
  ERC20InsufficientBalance: "The wallet does not have enough tokens.",
  ERC20InsufficientAllowance: "Approve the vault's token allowance and try again.",
  ERC20InvalidSender: "The sending address is invalid.",
  ERC20InvalidReceiver: "The receiving address is invalid.",
  ERC20InvalidApprover: "The approving address is invalid.",
  ERC20InvalidSpender: "The spender address is invalid.",
  UnsupportedChain: "The mock token is unavailable on this network.",
  ReentrancyGuardReentrantCall: "The vault is already processing an action.",
  VaultMissing: "No vault contract was found at the configured address on this network.",
  TokenMismatch: "The vault on this network uses a different token than the app expects.",
  VaultVersion: "The vault at the configured address is an older version than this app build. Use the app build that matches it.",
  RpcConflict: "The RPC endpoints returned different data for the same block. Try again shortly.",
};
function errorText(error) {
  return errorMessages[error.code] ?? errorMessages[revertName(error)] ?? error.shortMessage ?? error.message ?? "Something went wrong.";
}
function statusBadge(mark) {
  const labels = ["Pending — owner can still cancel", `Locked for the named reader until ${date(mark.verified.expiry)}`, "Expired", "Revoked", "Released early by the reader"];
  if (!(mark.status in labels)) return '<span class="status expired">Unknown status</span>';
  return `<span class="status ${["pending", "locked", "expired", "revoked", "released"][mark.status]}">${labels[mark.status]}</span>`;
}

function codedError(code) {
  const error = Error(errorMessages[code]);
  error.code = code;
  return error;
}

// Before showing any chain data, confirm the configured vault exists on this network and holds the configured token.
async function checkDeployment(at) {
  const [vaultCode, tokenCode] = await Promise.all([
    rpc.getCode(deployment.vault, at.blockTag), rpc.getCode(deployment.token, at.blockTag),
  ]);
  if (vaultCode === "0x") throw codedError("VaultMissing");
  let vaultToken;
  try { vaultToken = await vault.token({ blockTag: at.blockTag }); }
  catch { throw codedError("VaultMissing"); }
  if (tokenCode === "0x" || getAddress(vaultToken) !== getAddress(deployment.token)) throw codedError("TokenMismatch");
  // This build speaks the v2 vault interface. Refuse to read an older vault with it.
  try { await vault.activeEarmarkSlots(ZeroAddress, { blockTag: at.blockTag }); }
  catch { throw codedError("VaultVersion"); }
}

async function snapshot() {
  const at = await consistentBlock(providers, chain.chainId);
  if (!deploymentCheck) deploymentCheck = checkDeployment(at).catch(error => { deploymentCheck = undefined; throw error; });
  await deploymentCheck;
  lastRead = { block: at.blockTag, checked: at.live.length, total: at.total };
  return at;
}

async function readMark(id, at) {
  const check = await crossCheck(at.live, provider => vault.connect(provider).verify(id, { blockTag: at.blockTag })
    .then(result => result.toObject()));
  if (check.conflict) throw codedError("RpcConflict");
  lastRead = { block: at.blockTag, checked: check.checked, total: at.total };
  const verified = check.value;
  return { id, verified, status: Number(verified.status) };
}

function readStamp() {
  if (!lastRead) return "";
  const sources = lastRead.total > 1
    ? ` · ${lastRead.checked} of ${lastRead.total} RPC endpoints ${lastRead.checked > 1 ? "agree" : "answered"}` : "";
  return `<p class="muted read-stamp">Read from ${escapeHtml(chain.name)} at block ${lastRead.block}${sources}.</p>`;
}

async function findIssuingTransaction(id, latest) {
  const cached = cachedIssuingTransaction(id);
  if (cached) return cached;
  const start = deployment.deploymentBlock;
  const filter = vault.filters.EarmarkIssued(id);
  for (let end = latest; end >= start; end -= 5000) {
    const events = await vault.queryFilter(filter, Math.max(start, end - 4999), end);
    if (events.length) {
      cacheIssuingTransaction(id, events[0].transactionHash);
      return events[0].transactionHash;
    }
  }
}

function noteRow(verified) {
  const { verdict, note } = readNote(location.hash, verified.memoHash);
  if (verdict === "Note matches") {
    return `<dt>Shared note</dt><dd><span class="note-text">${escapeHtml(note)}</span> <span class="muted">(matches the on-chain hash)</span></dd>`;
  }
  if (verdict) return `<dt>Shared note</dt><dd>Note does not match the on-chain hash. Do not trust this note.</dd>`;
  if (verified.memoHash !== ZeroHash) return "<dt>Shared note</dt><dd>A note was committed. Ask the owner for the link with the note to read it.</dd>";
  return "";
}

function showProof(mark) {
  const { verified, id } = mark;
  const canAcknowledge = verified.active && !verified.acknowledged && account === verified.reader;
  const heldValue = verified.active ? verified.amount : 0n;
  const heldLabel = !verified.active ? "Held for this reader now"
    : verified.acknowledged ? "Held for this reader until expiry" : "Set aside now (owner can still cancel)";
  return `
    <section class="intro"><p class="eyebrow">Public certificate</p><h1>Proof #${id}</h1>
    <p>Check who the funds are held for, how much, and until when.</p></section>
    <article class="panel proof">
      ${statusBadge(mark)}
      <p class="label">${heldLabel}</p>
      <p class="value">${units(heldValue)}</p>
      <dl>
        <dt>Certificate amount</dt><dd>${units(verified.amount)}</dd>
        <dt>Reader</dt><dd>${names.display(verified.reader)}</dd>
        <dt>Vault owner</dt><dd>${getAddress(verified.owner)}</dd>
        <dt>Expiry</dt><dd>${date(verified.expiry)}</dd>
        <dt>Reader acknowledgment</dt><dd>${verified.acknowledged ? "Acknowledged" : "Pending"}</dd>
        <dt>Owner’s total deposit in vault</dt><dd>${units(verified.ownerLockedBalance)}</dd>
        <dt>Owner’s total set aside for readers</dt><dd>${units(verified.ownerReservedBalance)}</dd>
        <dt>Network and vault</dt><dd>${escapeHtml(chain.name)} (chain ${chain.chainId}) · ${scope.vault}</dd>
        ${noteRow(verified)}
      </dl>
      <p class="honest">After the named reader acknowledges, these funds stay in the vault for that reader until expiry: the owner cannot withdraw or cancel them before then. The reader cannot claim or withdraw them. At expiry, or if the reader releases them early, they return to the owner’s free balance. Before acknowledgment, the owner can cancel at any time.</p>
      <div class="actions">
        ${canAcknowledge ? `<button data-action="acknowledge" data-id="${id}">Acknowledge</button>` : ""}
        ${verified.active && account === verified.reader ? `<button class="secondary" data-action="release" data-id="${id}">Release early</button>` : ""}
        ${explorer ? `<a href="${explorer}" target="_blank" rel="noopener noreferrer">View vault on explorer ↗</a>` : ""}
        ${issuingTransaction ? `<a href="${chain.explorer}/tx/${issuingTransaction}" target="_blank" rel="noopener noreferrer">View issuing transaction ↗</a>` : ""}
      </div>
      ${verified.active && !verified.acknowledged
        ? `<p class="muted">${canAcknowledge ? "Acknowledging stops the owner from cancelling this earmark before expiry. It does not let you withdraw the funds."
          : account ? "Only the named reader can acknowledge this earmark." : "Connect the named reader’s wallet to acknowledge."}</p>` : ""}
      ${readStamp()}
    </article>`;
}

const intro = `<section class="intro"><p class="eyebrow">Proof of funds</p><h1>Reserve funds.<br>Show the proof.</h1>
  <p>Deposit ${isMainnet ? "funds" : "test tokens"} and set a slice aside for one reader until a set expiry. You keep ownership; the reader can verify it but cannot claim it.</p></section>`;

async function ownerView(snap) {
  const at = { blockTag: snap.blockTag };
  const [locked, free, count, walletBalance] = await Promise.all([
    vault.lockedBalance(account, at), vault.freeBalance(account, at),
    vault.earmarkCount(account, at), token.balanceOf(account, at),
  ]);
  const end = count > page * pageSize ? count - page * pageSize : 0n;
  const start = end > pageSize ? end - pageSize : 0n;
  const ids = await Promise.all(Array.from({ length: Number(end - start) }, (_, index) =>
    vault.earmarkIdAt(account, end - 1n - BigInt(index), at)));
  const marks = await Promise.all(ids.map(id => readMark(id, snap)));
  const cards = marks.map(({ id, status, verified }) => `
    <li><div><a href="/proof/${id}?${new URLSearchParams({ chain: String(chain.chainId), vault: scope.vault })}">Proof #${id}</a> ${statusBadge({ status, verified })}
    <p>${units(verified.amount)} · ${date(verified.expiry)}</p>
    <small title="${verified.reader}">Reader ${shortAddress(verified.reader)}${verified.acknowledged ? " · Acknowledged" : ""}</small></div>
    <div class="actions"><button class="secondary" data-action="copy" data-id="${id}">Copy link without note</button>
    ${getNote(id) ? `<button class="secondary" data-action="copy-note" data-id="${id}">Copy link with note</button>` : ""}
    ${verified.active && !verified.acknowledged ? `<button class="secondary" data-action="revoke" data-id="${id}">Revoke</button>` : ""}</div></li>`).join("");
  return `${intro}
    <section class="balances" aria-label="Vault balances">
      ${[["Deposited", locked], ["Set aside for readers", locked - free], ["Free to withdraw", free]]
        .map(([label, balance]) => `<div class="panel"><p class="label">${label}</p><strong>${units(balance)}</strong></div>`).join("")}
    </section>
    <div class="grid">
      <section class="panel"><h2>Vault</h2>
        <p class="muted">Wallet balance ${units(walletBalance)}</p>
        ${isMainnet ? "" : '<button class="secondary" data-action="mint">Mint 1,000 test tokens</button>'}
        <form data-action="deposit"><label>Deposit amount<input name="amount" inputmode="decimal" required></label><button>Deposit</button></form>
        <p class="muted">Balances refresh every 12 seconds while this tab is open.</p>
        <button class="secondary" type="button" data-action="refresh">Refresh balances</button>
        <form data-action="withdraw"><label>Withdraw amount<input name="amount" inputmode="decimal" required></label><button>Withdraw</button></form>
      </section>
      <section class="panel"><h2>Issue earmark</h2>
        <form data-action="issue">
          <label>Reader address<input name="reader" placeholder="0x…" required></label>
          <label>Amount in ${escapeHtml(deployment.symbol)}<input name="amount" inputmode="decimal" required></label>
          <label>Expiry in your local time<input name="expiry" type="datetime-local" required></label>
          <label>Note <span class="muted">(optional, share only with a note link)</span><input name="note" maxlength="240"></label>
          <button>Issue earmark</button>
        </form>
      </section>
    </div>
    <section class="panel history"><h2>Your earmarks</h2>
      ${cards ? `<ul>${cards}</ul>` : "<p>No earmarks yet.</p>"}
      ${page || start ? `<div class="actions">
        ${page ? '<button class="secondary" data-action="newer">Newer</button>' : ""}
        ${start ? '<button class="secondary" data-action="older">Older</button>' : ""}
      </div>` : ""}
      ${readStamp()}
    </section>`;
}

async function render({ background = false } = {}) {
  const run = ++generation;
  const currentAccount = account;
  const currentPage = page;
  try {
    let html;
    if (isProofPath && !proofId) {
      html = '<section class="intro"><h1>Proof not found</h1><p>Check the certificate link and try again.</p></section>';
    } else if (!configured) {
      html = `${intro}<section class="panel"><h2>Deployment needed</h2><p>Deploy the contracts and restart the app to connect a vault.</p></section>`;
    } else if (proofId && scopeVerdict === "mismatch") {
      html = `<section class="intro"><h1>Proof is for another vault</h1><p>This link names a different network or vault than this app reads (${escapeHtml(chain.name)}, vault ${scope.vault}). Open the link on the app for that vault.</p></section>`;
    } else if (proofId) {
      try {
        const at = await snapshot();
        if (explorer) issuingTransaction ??= cachedIssuingTransaction(proofId);
        html = showProof(await readMark(proofId, at));
        if (explorer && !issuingTransaction && !issueLookup) {
          issueLookup = findIssuingTransaction(proofId, at.blockTag)
            .then(hash => {
              if (hash && /^0x[0-9a-f]{64}$/i.test(hash)) {
                issuingTransaction = hash;
                void render({ background: true });
              }
            })
            .catch(() => {})
            .finally(() => { issueLookup = undefined; });
        }
      }
      catch (error) {
        if (revertName(error) !== "UnknownEarmark") throw error;
        html = '<section class="intro"><h1>Proof not found</h1><p>This vault has no certificate with that ID.</p></section>';
      }
    } else if (!account) {
      html = `${intro}<section class="panel"><h2>Your vault</h2><p>Connect a wallet to deposit, withdraw, or issue an earmark.</p></section>`;
    } else {
      html = await ownerView(await snapshot());
    }
    if (run === generation && currentAccount === account && currentPage === page && renderedHtml !== html) {
      content.innerHTML = html;
      renderedHtml = html;
    }
  } catch (error) {
    if (run === generation) {
      renderedHtml = undefined;
      content.innerHTML = `<section class="panel"><h1>Chain data unavailable</h1><p>${escapeHtml(errorText(error))} Try refreshing the page.</p></section>`;
      if (!background) alert(errorText(error));
    }
  } finally {
    if (run === generation) {
      content.setAttribute("aria-busy", "false");
      setDisabled();
    }
  }
}

function setDisabled() {
  connect.disabled = pending;
  for (const button of content.querySelectorAll("button")) button.disabled = pending;
}

async function switchChain() {
  const chainId = toQuantity(chain.chainId);
  if (await wallet.request({ method: "eth_chainId" }) === chainId) return;
  try { await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] }); }
  catch (error) {
    if (Number(error.code) !== 4902) throw error;
    await wallet.request({ method: "wallet_addEthereumChain", params: [{
      chainId, chainName: chain.name, rpcUrls: [chain.rpc, ...chain.fallbackRpcs], nativeCurrency: chain.currency,
      ...(chain.explorer ? { blockExplorerUrls: [chain.explorer] } : {}),
    }] });
    await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  }
}

function setAccount(address) {
  const next = address ? getAddress(address) : undefined;
  if (next !== account) page = 0n;
  account = next;
  connect.textContent = account ? shortAddress(account) : "Connect wallet";
  connect.title = account ?? "";
}

async function walletConnect() {
  if (!wallet) throw Error("Open this app in a browser with an EVM wallet.");
  const [address] = await wallet.request({ method: "eth_requestAccounts" });
  await switchChain();
  setAccount(address);
  await render();
}

async function run(action) {
  if (pending) return;
  pending = true;
  setDisabled();
  alert("");
  try { await action(); }
  catch (error) { alert(errorText(error)); }
  finally { pending = false; setDisabled(); }
}

function amountFrom(data) {
  const raw = data.get("amount").trim();
  const decimals = deployment.decimals;
  if (!/^\d+(\.\d+)?$/.test(raw) || (raw.split(".")[1]?.length ?? 0) > decimals) {
    throw Error(`Enter a positive amount with up to ${decimals} decimal places.`);
  }
  const amount = parseUnits(raw, decimals);
  if (amount <= 0n || amount >= 2n ** 256n) throw Error("Enter a supported positive amount.");
  return amount;
}

async function transact(action, { data, id } = {}) {
  if (!wallet || !account) throw Error("Connect your wallet first.");
  const sender = account;
  await switchChain();
  const browser = new BrowserProvider(wallet);
  const signer = await browser.getSigner(sender);
  if ((await browser.getNetwork()).chainId !== BigInt(chain.chainId)) throw Error("Wrong wallet network.");
  const signedVault = vault.connect(signer);
  const signedToken = token.connect(signer);
  const sendVault = async (method, ...args) => {
    await signedVault[method].staticCall(...args);
    return signedVault[method](...args);
  };
  let tx;
  let shareNote;
  if (action === "mint" && !isMainnet) tx = await signedToken.mint(sender, parseUnits("1000", deployment.decimals));
  if (action === "deposit") {
    const amount = amountFrom(data);
    if (await signedToken.allowance(sender, deployment.vault) < amount) {
      alert("Approve the token allowance in your wallet.");
      await (await signedToken.approve(deployment.vault, amount)).wait();
    }
    alert("Confirm the deposit in your wallet.");
    tx = await sendVault("deposit", deployment.token, amount);
  }
  if (action === "withdraw") tx = await sendVault("withdraw", amountFrom(data));
  if (action === "issue") {
    const reader = await names.resolve(data.get("reader"));
    const expiry = Math.floor(new Date(data.get("expiry")).getTime() / 1000);
    if (!Number.isFinite(expiry) || expiry <= Date.now() / 1000) throw Error("Choose a future expiry.");
    const note = data.get("note").trim();
    if (note) shareNote = { note, salt: hexlify(crypto.getRandomValues(new Uint8Array(32))) };
    const memoHash = shareNote ? noteHash(shareNote) : ZeroHash;
    tx = await sendVault("issueEarmark", reader, amountFrom(data), expiry, memoHash);
  }
  if (action === "revoke") tx = await sendVault("revokeEarmark", id);
  if (action === "acknowledge") tx = await sendVault("acknowledge", id);
  if (action === "release") tx = await sendVault("releaseEarmark", id);
  alert("Waiting for transaction confirmation…");
  const receipt = await tx.wait();
  let noteLink;
  if (action === "issue") {
    page = 0n;
    if (shareNote) {
      const event = receipt.logs.find(log => log.fragment?.name === "EarmarkIssued");
      if (event) {
        saveNote(event.args.id, shareNote);
        noteLink = shareLink(event.args.id, shareNote);
      }
    }
  }
  alert("Transaction confirmed.", noteLink);
  await render();
}

document.querySelector("#copy-confirmed-proof").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(confirmedProofLink.getAttribute("href"));
    messageText.textContent = "Proof link copied.";
  } catch {
    messageText.textContent = "Could not copy the link. You can select and copy the URL.";
  }
});

connect.addEventListener("click", () => run(walletConnect));
wallet?.on?.("chainChanged", () => { void render(); });
wallet?.on?.("accountsChanged", addresses => {
  setAccount(addresses[0]);
  void render();
});
content.addEventListener("submit", event => {
  event.preventDefault();
  const form = event.target;
  void run(() => transact(form.dataset.action, { data: new FormData(form) }));
});
content.addEventListener("click", event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;
  void run(async () => {
    if (action === "copy" || action === "copy-note") {
      await navigator.clipboard.writeText(shareLink(id, action === "copy-note" ? getNote(id) : null));
      alert("Proof link copied.");
    } else if (action === "refresh") {
      await render();
    } else if (action === "older" || action === "newer") {
      page += action === "older" ? 1n : -1n;
      await render();
    } else {
      await transact(action, { id });
    }
  });
});

async function start() {
  if (wallet) {
    try { setAccount((await wallet.request({ method: "eth_accounts" }))[0]); }
    catch { /* A wallet is optional for reading. */ }
  }
  await render();
  setInterval(() => {
    if (pending || !configured || document.visibilityState === "hidden") return;
    if (proofId) void render({ background: true });
    // Refresh dashboard balances, but never wipe what the owner is typing.
    else if (account && !Array.from(content.querySelectorAll("input")).some(input => input.value)) void render({ background: true });
  }, 12000);
}


window.addEventListener?.("hashchange", () => { if (proofId) void render(); });
void start();
