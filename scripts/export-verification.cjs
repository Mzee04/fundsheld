const { readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const debugPath = path.resolve("artifacts/contracts/FundsHeldVault.sol/FundsHeldVault.dbg.json");
const debug = JSON.parse(readFileSync(debugPath, "utf8"));
const build = JSON.parse(readFileSync(path.resolve(path.dirname(debugPath), debug.buildInfo), "utf8"));
writeFileSync("artifacts/FundsHeldVault.standard-input.json", JSON.stringify(build.input, null, 2) + "\n");
console.log(`Compiler: v${build.solcLongVersion.split(".Emscripten")[0]}`);
console.log("Standard JSON input: artifacts/FundsHeldVault.standard-input.json");
