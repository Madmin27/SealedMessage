import { getChainByKey, supportedChains, ZERO_ADDRESS } from "./chains";

const ensure = (value: string | undefined): string | undefined => value?.trim() || undefined;

const supportedKeys = Object.keys(supportedChains);
const defaultChainKey = supportedKeys[0];

const envChainKey = ensure(process.env.NEXT_PUBLIC_CHAIN_KEY) as keyof typeof supportedChains | undefined;
const activeChainKey = envChainKey && supportedChains[envChainKey] ? envChainKey : defaultChainKey;

const activeChain = activeChainKey ? getChainByKey(activeChainKey) : undefined;

if (!activeChain) {
  throw new Error("No supported chains configured. Please populate lib/chains.public.json.");
}

const contractOverride = ensure(process.env.NEXT_PUBLIC_CONTRACT_ADDRESS);
const explorerOverride = ensure(process.env.NEXT_PUBLIC_EXPLORER_URL);
const rpcOverride = ensure(process.env.NEXT_PUBLIC_RPC_URL);

export const appConfig = {
  contractAddress: (contractOverride || activeChain.contractAddress || ZERO_ADDRESS) as `0x${string}`,
  chain: {
    id: activeChain.id,
    name: activeChain.name,
    network: activeChain.network,
    nativeCurrency: activeChain.nativeCurrency,
    rpcUrl: rpcOverride || activeChain.rpcUrls.default,
    explorerUrl: explorerOverride || activeChain.blockExplorer
  }
};
