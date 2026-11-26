const { ethers } = require("ethers");
const hre = require("hardhat");
const fs = require("node:fs");
const { createInterface } = require("node:readline/promises");
const { deploymentPlan } = require("./deploy-policy.cjs");

async function confirmChain(chainId) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw Error("Mainnet confirmation requires an interactive terminal.");
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try { return await terminal.question(`Type ${chainId} to deploy the vault to QIE Mainnet: `); }
  finally { terminal.close(); }
}

async function main() {
  const { chain, existingToken } = await deploymentPlan(hre.network.name, process.env.FUNDSHELD_ALLOW_MAINNET, confirmChain);
  const { createRpc } = await import("../web/network.mjs");
  const provider = createRpc(chain);
  try {
    if ((await provider.getNetwork()).chainId !== BigInt(chain.chainId)) throw Error("Unexpected chain.");
    await deploy(provider, chain, existingToken);
  } finally {
    await provider.destroy();
  }
}

async function deploy(provider, chain, existingToken) {
  let tokenAddress = existingToken;
  const tokenAbi = ["function decimals() view returns (uint8)", "function symbol() view returns (string)"];
  const readTokenMetadata = async address => {
    const asset = new ethers.Contract(address, tokenAbi, provider);
    const [decimals, symbol] = await Promise.all([asset.decimals(), asset.symbol()]);
    if (decimals > 80n || !symbol.trim()) throw Error("Unsupported token metadata.");
    return { decimals: Number(decimals), symbol };
  };
  let metadata = tokenAddress ? await readTokenMetadata(tokenAddress) : undefined;

  let signer;
  if (chain.chainId === 31337) {
    const address = "0x0000000000000000000000000000000000001001";
    await provider.send("hardhat_impersonateAccount", [address]);
    await provider.send("hardhat_setBalance", [address, ethers.toQuantity(ethers.parseEther("10"))]);
    signer = new ethers.JsonRpcSigner(provider, address);
  } else {
    const keystorePath = process.env.FUNDSHELD_KEYSTORE;
    const password = process.env.FUNDSHELD_KEYSTORE_PASSWORD;
    if (!keystorePath || password === undefined) throw Error("Configure the encrypted keystore and password locally.");
    const wallet = await ethers.Wallet.fromEncryptedJson(fs.readFileSync(keystorePath, "utf8"), password);
    signer = wallet.connect(provider);
    if (await provider.getBalance(signer.address) === 0n) throw Error("Fund the deployer with network gas.");
  }

  signer = new ethers.NonceManager(signer);
  async function deployContract(name, args = []) {
    const { abi, bytecode } = await hre.artifacts.readArtifact(name);
    const contract = await new ethers.ContractFactory(abi, bytecode, signer).deploy(...args);
    const receipt = await contract.deploymentTransaction().wait();
    const address = await contract.getAddress();
    console.log(name, address, receipt.hash);
    return { address, receipt };
  }

  if (!tokenAddress) {
    tokenAddress = (await deployContract("MockQUSDC")).address;
    metadata = await readTokenMetadata(tokenAddress);
  }
  const { address: vault, receipt } = await deployContract("FundsHeldVault", [tokenAddress]);
  const deployment = {
    chainId: chain.chainId, token: tokenAddress, vault, ...metadata,
    deploymentBlock: receipt.blockNumber, vaultTransaction: receipt.hash,
  };
  fs.writeFileSync(`web/deployments/${chain.chainId}.json`, JSON.stringify(deployment, null, 2) + "\n");
}

main().catch(error => {
  const safe = new Set([
    "Unsupported deployment network.", "Mainnet requires FUNDSHELD_ALLOW_MAINNET=yes.",
    "Mainnet confirmation did not match.", "Mainnet confirmation requires an interactive terminal.",
    "Unexpected chain.", "Configure the encrypted keystore and password locally.",
    "Fund the deployer with network gas.", "Unsupported token metadata.",
  ]);
  console.error(safe.has(error.message) ? error.message : "Deployment failed. Check RPC, gas, keystore and network settings.");
  process.exitCode = 1;
});
