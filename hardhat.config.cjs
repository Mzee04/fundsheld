const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");
const { mainnet, testnet, local } = require("./network.json");

subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, ({ solcVersion }) => {
  if (solcVersion !== "0.8.28") throw Error("Unexpected compiler version");
  return {
    compilerPath: require.resolve("solc/soljson.js"),
    isSolcJs: true,
    version: solcVersion,
    longVersion: require("solc").version(),
  };
});

module.exports = {
  solidity: {
    version: "0.8.28",
    settings: { evmVersion: "paris", optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    hardhat: { accounts: [], chainId: local.chainId },
    localhost: { url: local.rpc, chainId: local.chainId, accounts: "remote" },
    qieTestnet: { url: testnet.rpc, chainId: testnet.chainId, accounts: "remote" },
    qieMainnet: { url: mainnet.rpc, chainId: mainnet.chainId, accounts: "remote" },
  },
};
