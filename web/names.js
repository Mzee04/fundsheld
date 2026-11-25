import { getAddress, ZeroAddress } from "ethers";

export function createNameAdapter(chainId, mainnetResolver) {
  return {
    async resolve(input) {
      const value = input.trim();
      if (/\.qie$/i.test(value)) {
        if (chainId !== 1990 || !mainnetResolver) {
          throw new Error("Use a wallet address. .qie lookup is unavailable on this network.");
        }
        const address = getAddress(await mainnetResolver(value));
        if (address === ZeroAddress) throw new Error("This .qie name has no wallet address.");
        return address;
      }
      const address = getAddress(value);
      if (address === ZeroAddress) throw new Error("Enter a nonzero wallet address.");
      return address;
    },
    display(address) {
      return getAddress(address);
    },
  };
}
