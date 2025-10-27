"use client";

import { PropsWithChildren, useEffect, useState } from "react";
import { WagmiConfig, createConfig, configureChains } from "wagmi";
import { jsonRpcProvider } from "wagmi/providers/jsonRpc";
import { RainbowKitProvider, midnightTheme, connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet, metaMaskWallet } from "@rainbow-me/rainbowkit/wallets";
import "@rainbow-me/rainbowkit/styles.css";
import { defineChain } from "viem";
import { supportedChains, type ChainDefinition } from "../lib/chains";
import { VersionProvider } from "./VersionProvider";

type ChainEntry = {
  key: string;
  config: ChainDefinition;
  defaultRpc: string;
  publicRpc: string;
};

const sanitizeChainKey = (key: string) => key.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();

const primaryChainKey = process.env.NEXT_PUBLIC_CHAIN_KEY?.trim();
const primaryRpcOverride = process.env.NEXT_PUBLIC_RPC_URL?.trim();

const readOverrideForChain = (chainKey: string): string | undefined => {
  const baseKey = sanitizeChainKey(chainKey);
  const explicitKey = `${baseKey}_RPC_URL`;
  const publicKey = `NEXT_PUBLIC_${baseKey}_RPC_URL`;

  const explicitOverride = process.env[explicitKey as keyof typeof process.env];
  if (typeof explicitOverride === "string" && explicitOverride.trim().length > 0) {
    return explicitOverride.trim();
  }

  const publicOverride = process.env[publicKey as keyof typeof process.env];
  if (typeof publicOverride === "string" && publicOverride.trim().length > 0) {
    return publicOverride.trim();
  }

  if (primaryChainKey && primaryRpcOverride && primaryChainKey === chainKey) {
    return primaryRpcOverride;
  }

  return undefined;
};

const chainEntries: ChainEntry[] = Object.entries(supportedChains)
  .filter(([, config]) => config.testnet)
  .map(([key, config]) => {
    const override = readOverrideForChain(key);
    const resolvedDefault = override ?? config.rpcUrls.default;
    const resolvedPublic = override ?? config.rpcUrls.public ?? config.rpcUrls.default;

    return {
      key,
      config,
      defaultRpc: resolvedDefault,
      publicRpc: resolvedPublic
    };
  });

const chainMetaById = new Map<number, ChainEntry>();
for (const entry of chainEntries) {
  chainMetaById.set(entry.config.id, entry);
}

export function Providers({ children }: PropsWithChildren) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);
  const chains = chainEntries.map(({ config, defaultRpc, publicRpc }) =>
    defineChain({
      id: config.id,
      name: config.name,
      network: config.network,
      nativeCurrency: config.nativeCurrency,
      rpcUrls: {
        default: { http: [defaultRpc] },
        public: { http: [publicRpc] }
      },
      blockExplorers: config.blockExplorer
        ? {
            default: {
              name: "Explorer",
              url: config.blockExplorer
            }
          }
        : undefined,
      testnet: config.testnet
    })
  );

  const { publicClient, webSocketPublicClient } = configureChains(
    chains,
    [
      jsonRpcProvider({
        rpc: (chain) => {
          const entry = chainMetaById.get(chain.id);
          if (!entry) {
            return null;
          }
          return { http: entry.defaultRpc };
        }
      })
    ]
  );

  const connectors = connectorsForWallets([
    {
  groupName: "Recommended",
      wallets: [
        injectedWallet({ chains }),
        metaMaskWallet({ chains, projectId: "sealedmessage" })
      ]
    }
  ]);

  const config = createConfig({
    autoConnect: false, // Disable auto-connect to prevent hydration issues
    connectors,
    publicClient,
    webSocketPublicClient
  });

  return (
    <WagmiConfig config={config}>
      <RainbowKitProvider chains={chains} theme={midnightTheme()}>
        <VersionProvider>
          {children}
        </VersionProvider>
      </RainbowKitProvider>
    </WagmiConfig>
  );
}
