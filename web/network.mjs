import { FallbackProvider, FetchRequest, JsonRpcProvider } from "ethers";

export function createRpc(chain) {
  const providers = [chain.rpc, ...chain.fallbackRpcs].map((url, index) => {
    const request = new FetchRequest(url);
    request.timeout = 8_000;
    return {
      provider: new JsonRpcProvider(request, chain.chainId, { batchMaxCount: 1, cacheTimeout: -1 }),
      priority: index + 1,
      stallTimeout: 750,
    };
  });
  return providers.length === 1 ? providers[0].provider :
    new FallbackProvider(providers, chain.chainId, { quorum: 1, cacheTimeout: -1 });
}

export function selectChain(networks, chainId, production) {
  const id = Number(chainId || (production ? networks.mainnet.chainId : networks.local.chainId));
  const chain = Object.values(networks).find(item => item.chainId === id);
  if (!chain) throw Error("Unsupported VITE_CHAIN_ID.");
  return chain;
}
