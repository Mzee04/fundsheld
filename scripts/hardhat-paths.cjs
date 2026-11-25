const path = require("node:path");

// Keep Hardhat's global paths inside this project, including on macOS.
const modulePath = require.resolve("env-paths", { paths: [require.resolve("hardhat")] });
require(modulePath);
const localPaths = name => {
  const root = path.join(__dirname, "..", ".hardhat-home", name);
  return Object.fromEntries(["data", "config", "cache", "log", "temp"]
    .map(kind => [kind, path.join(root, kind)]));
};
localPaths.default = localPaths;
require.cache[modulePath].exports = localPaths;
process.env.HARDHAT_DISABLE_TELEMETRY = "1";
if (process.platform === "darwin") process.env.CHOKIDAR_USEPOLLING ??= "1";
