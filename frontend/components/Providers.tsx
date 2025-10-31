"use client";

import { PropsWithChildren, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { connectorsForWallets, midnightTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { injectedWallet, metaMaskWallet } from "@rainbow-me/rainbowkit/wallets";
import { sequenceWallet } from "../lib/sequenceWallet";
import "@rainbow-me/rainbowkit/styles.css";
import { defineChain, fallback, http, type Transport } from "viem";
import { createConfig, WagmiProvider } from "wagmi";
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
const sequenceProjectAccessKey = process.env.NEXT_PUBLIC_SEQUENCE_PROJECT_ACCESS_KEY?.trim();
const sequenceAppName = process.env.NEXT_PUBLIC_SEQUENCE_APP_NAME?.trim() || "SealedMessage";
const sequenceDefaultChainIdEnv = process.env.NEXT_PUBLIC_SEQUENCE_DEFAULT_CHAIN_ID?.trim();
const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() || "sealedmessage";
const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

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

const resolvedChains = chainEntries.map(({ config, defaultRpc, publicRpc }) =>
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

if (resolvedChains.length === 0) {
  throw new Error("At least one chain must be configured for wagmi");
}

const chains = resolvedChains as [typeof resolvedChains[number], ...typeof resolvedChains[number][]];

const transports = chainEntries.reduce<Record<number, Transport>>(
  (accumulator, entry) => {
    const urls = Array.from(new Set([entry.defaultRpc, entry.publicRpc].filter(Boolean)));
    if (urls.length === 0) {
      return accumulator;
    }
    accumulator[entry.config.id] =
      urls.length === 1
        ? http(urls[0])
        : fallback(urls.map((url) => http(url)));
    return accumulator;
  },
  {}
);

const resolveSequenceDefaultNetwork = (): number | undefined => {
  if (sequenceDefaultChainIdEnv) {
    const parsed = Number(sequenceDefaultChainIdEnv);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  if (primaryChainKey) {
    const entry = chainEntries.find((candidate) => candidate.key === primaryChainKey);
    if (entry) {
      return entry.config.id;
    }
  }
  return chainEntries[0]?.config.id;
};

type WalletFactory = Parameters<typeof connectorsForWallets>[0][number]["wallets"][number];

const sequenceWalletFactory: WalletFactory | null = sequenceProjectAccessKey
  ? () =>
      sequenceWallet({
        chains,
        projectAccessKey: sequenceProjectAccessKey,
        defaultNetwork: resolveSequenceDefaultNetwork(),
        connect: {
          app: sequenceAppName
        },
        walletAppURL: appUrl
      })
  : null;

const walletGroups: Parameters<typeof connectorsForWallets>[0] = [
  {
    groupName: "Recommended",
    wallets: [
      ...(sequenceWalletFactory ? [sequenceWalletFactory] : []),
      injectedWallet,
      metaMaskWallet
    ]
  }
];

const connectors = connectorsForWallets(
  walletGroups,
  {
    appName: sequenceAppName,
    projectId: walletConnectProjectId,
    appUrl,
    appDescription: "SealedMessage dApp"
  }
);

const wagmiConfig = createConfig({
  chains,
  connectors,
  transports,
  ssr: true
});

export function Providers({ children }: PropsWithChildren) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig} reconnectOnMount={false}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={midnightTheme()}>
          <VersionProvider>{children}</VersionProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
