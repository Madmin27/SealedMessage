// ========================================
// SealedMessage configuration (single contract per chain)
// ========================================

import { defineChain } from "viem";
import rawChainData from "./chains.public.json";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const INFURA_KEY = process.env.NEXT_PUBLIC_INFURA_API_KEY || "";

type PublicChainConfig = {
  id: number;
  name: string;
  network: string;
  testnet: boolean;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: {
    default: string;
    public?: string;
    infuraBase?: string;
  };
  blockExplorer?: string;
  faucet?: string;
};

const chainData = rawChainData as Record<string, PublicChainConfig>;

const CONTRACT_ADDRESSES: Record<string, string | undefined> = {
  sepolia: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_SEPOLIA,
  baseSepolia: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_BASE_SEPOLIA,
  scrollSepolia: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_SCROLL_SEPOLIA
};

export type ChainDefinition = {
  id: number;
  name: string;
  network: string;
  testnet: boolean;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: {
    default: string;
    public?: string;
    infura?: string;
  };
  blockExplorer?: string;
  contractAddress: `0x${string}`;
  faucet?: string;
};

export const supportedChains: Record<string, ChainDefinition> = Object.entries(chainData).reduce(
  (accumulator, [key, config]) => {
    const rpcUrls = {
      default: config.rpcUrls.default,
      public: config.rpcUrls.public ?? config.rpcUrls.default,
      infura:
        config.rpcUrls.infuraBase && INFURA_KEY
          ? `${config.rpcUrls.infuraBase}${INFURA_KEY}`
          : undefined
    };

    const contractAddress = (CONTRACT_ADDRESSES[key] || ZERO_ADDRESS) as `0x${string}`;

    accumulator[key] = {
      id: config.id,
      name: config.name,
      network: config.network,
      testnet: config.testnet,
      nativeCurrency: config.nativeCurrency,
      rpcUrls,
      blockExplorer: config.blockExplorer,
      contractAddress,
      faucet: config.faucet
    };

    return accumulator;
  },
  {} as Record<string, ChainDefinition>
);

export type ChainKey = keyof typeof supportedChains;
export type ChainConfig = ChainDefinition;

// ========================================
// Helper Functions
// ========================================

export function getChainByKey(chainKey: string): ChainConfig | undefined {
  return supportedChains[chainKey];
}

export function getChainById(chainId: number): ChainConfig | undefined {
  return Object.values(supportedChains).find((chain) => chain.id === chainId);
}

export function isChainSupported(chainId: number): boolean {
  return Object.values(supportedChains).some((chain) => chain.id === chainId);
}

export function getContractAddress(chainId: number): `0x${string}` | undefined {
  const chain = getChainById(chainId);
  return chain?.contractAddress !== ZERO_ADDRESS ? chain?.contractAddress : undefined;
}

export function toViemChain(chain: ChainConfig) {
  return defineChain({
    id: chain.id,
    name: chain.name,
    network: chain.network,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: {
      default: { http: [chain.rpcUrls.default] },
      public: { http: [chain.rpcUrls.public ?? chain.rpcUrls.default] }
    },
    blockExplorers: chain.blockExplorer
      ? {
          default: {
            name: "Explorer",
            url: chain.blockExplorer
          }
        }
      : undefined,
    testnet: chain.testnet
  });
}
