const { local, testnet, mainnet } = require("../network.json");

async function deploymentPlan(networkName, allowMainnet, confirmChain) {
  if (networkName === "localhost") return { chain: local };
  if (networkName === "qieTestnet") return { chain: testnet };
  if (networkName !== "qieMainnet") throw Error("Unsupported deployment network.");
  if (allowMainnet !== "yes") throw Error("Mainnet requires FUNDSHELD_ALLOW_MAINNET=yes.");
  if (await confirmChain(mainnet.chainId) !== String(mainnet.chainId)) throw Error("Mainnet confirmation did not match.");
  return { chain: mainnet, existingToken: mainnet.token };
}

module.exports = { deploymentPlan };
