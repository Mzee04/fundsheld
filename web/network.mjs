import { FallbackProvider, FetchRequest, JsonRpcProvider } from "ethers";

function endpoints(chain) {
  return [chain.rpc, ...(chain.fallbackRpcs ?? [])].map(url => {
    const request = new FetchRequest(url);
    request.timeout = 8_000;
    return new JsonRpcProvider(request, chain.chainId, { batchMaxCount: 1, cacheTimeout: -1, staticNetwork: true });
  });
}

// One provider for reads with failover, plus each endpoint on its own so reads can be cross-checked.
export function createRpcSet(chain) {
  const providers = endpoints(chain);
  const rpc = providers.length === 1 ? providers[0] :
    new FallbackProvider(providers.map((provider, index) => ({ provider, priority: index + 1, stallTimeout: 750 })),
      chain.chainId, { quorum: 1, cacheTimeout: -1 });
  return { rpc, providers };
}

export function createRpc(chain) {
  return createRpcSet(chain).rpc;
}

// Ask every endpoint for its chain ID and latest block. Read at the lowest block that every
// responding endpoint has, so the same state can be compared across endpoints.
export async function consistentBlock(providers, chainId) {
  const answers = await Promise.allSettled(providers.map(async provider => {
    const [network, block] = await Promise.all([provider.send("eth_chainId", []), provider.getBlockNumber()]);
    if (BigInt(network) !== BigInt(chainId)) throw Error("wrong chain");
    return { provider, block };
  }));
  const live = answers.filter(answer => answer.status === "fulfilled").map(answer => answer.value);
  if (!live.length) throw Error("No RPC endpoint returned the expected network.");
  return { blockTag: Math.min(...live.map(item => item.block)), live: live.map(item => item.provider), total: providers.length };
}

// Run the same read on every live endpoint at one block and report whether they agree.
export async function crossCheck(live, read, key = value => JSON.stringify(value, (_, item) =>
  typeof item === "bigint" ? item.toString() : item)) {
  const results = await Promise.allSettled(live.map(read));
  const ok = results.filter(result => result.status === "fulfilled").map(result => result.value);
  if (!ok.length) throw results[0].reason;
  const keys = new Set(ok.map(key));
  return { value: ok[0], agreeing: keys.size === 1 ? ok.length : 0, checked: ok.length, conflict: keys.size > 1 };
}

export function selectChain(networks, chainId, production) {
  const id = Number(chainId || (production ? networks.mainnet.chainId : networks.local.chainId));
  const chain = Object.values(networks).find(item => item.chainId === id);
  if (!chain) throw Error("Unsupported VITE_CHAIN_ID.");
  return chain;
}
