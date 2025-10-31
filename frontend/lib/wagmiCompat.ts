"use client";

import { useCallback, useMemo } from "react";
import {
  useAccount,
  useChainId,
  useConfig,
  usePublicClient,
  useSimulateContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWalletClient,
  useWriteContract
} from "wagmi";
import type {
  WaitForTransactionReceiptErrorType,
  WaitForTransactionReceiptReturnType,
  WriteContractParameters
} from "@wagmi/core";
import type { Abi, Chain } from "viem";

export { useAccount, usePublicClient, useWalletClient, useChainId, useConfig } from "wagmi";

export type LegacyContractWriteConfig = {
  abi: Abi;
  address?: `0x${string}`;
  functionName?: string;
  args?: readonly unknown[];
  account?: `0x${string}`;
  value?: bigint;
  chainId?: number;
  request?: WriteContractParameters<Abi, string, readonly unknown[]>;
};

type AnyWriteContractParameters = WriteContractParameters<Abi, string, readonly unknown[]>;

type PrepareContractWriteParameters = {
  abi: Abi;
  address?: `0x${string}`;
  functionName: string;
  args?: readonly unknown[];
  account?: `0x${string}`;
  value?: bigint;
  chainId?: number;
  enabled?: boolean;
};

type UseWaitForTransactionParameters = {
  hash?: `0x${string}`;
  chainId?: number;
  confirmations?: number;
  enabled?: boolean;
  onError?: (error: WaitForTransactionReceiptErrorType) => void;
  onSuccess?: (receipt: WaitForTransactionReceiptReturnType) => void;
};

type SwitchNetworkResult = ReturnType<typeof useSwitchChain> & {
  switchNetwork?: (chainId: number) => void;
  switchNetworkAsync?: (chainId: number) => Promise<unknown>;
  isLoading: ReturnType<typeof useSwitchChain>["isPending"];
  pendingChainId?: number;
};

const ensureRequest = (
  config?: LegacyContractWriteConfig,
  override?: Partial<AnyWriteContractParameters>
): AnyWriteContractParameters => {
  const baseRequest: AnyWriteContractParameters | undefined = config?.request
    ? (config.request as AnyWriteContractParameters)
    : config?.address && config.functionName
    ? {
        abi: config.abi,
        address: config.address,
        functionName: config.functionName,
        args: (config.args ?? []) as readonly unknown[],
        account: config.account,
        value: config.value,
        chainId: config.chainId
      } as AnyWriteContractParameters
    : undefined;

  const target = baseRequest ?? (override as AnyWriteContractParameters | undefined);

  if (!target) {
    throw new Error("Contract write configuration is missing required parameters");
  }

  if (!override) {
    return target;
  }

  return {
    ...target,
    ...override
  } as AnyWriteContractParameters;
};

export function useNetwork(): { chain?: Chain; chains: readonly Chain[]; chainUnsupported: boolean } {
  const config = useConfig();
  const chainId = useChainId();
  const chains = config.chains as readonly Chain[];
  const chain = chains.find((candidate) => candidate.id === chainId);

  return {
    chain,
    chains,
    chainUnsupported: Boolean(chainId && !chain)
  };
}

export function useSwitchNetwork(): SwitchNetworkResult {
  const switchResult = useSwitchChain();
  const { switchChain, switchChainAsync, variables, isPending } = switchResult;

  const switchNetwork = useCallback((chainId: number) => {
    switchChain({ chainId });
  }, [switchChain]);

  const switchNetworkAsync = useCallback(
    (chainId: number) => switchChainAsync({ chainId }) as Promise<unknown>,
    [switchChainAsync]
  );

  return {
    ...switchResult,
    switchNetwork,
    switchNetworkAsync,
    isLoading: isPending,
    pendingChainId: variables?.chainId
  } as SwitchNetworkResult;
}

export function usePrepareContractWrite(parameters: PrepareContractWriteParameters) {
  const { enabled = true, ...rest } = parameters;
  const { abi, address, functionName, args, account, value, chainId } = rest;

  const simulation = useSimulateContract({
    abi,
    address,
    functionName,
    args: args as readonly unknown[] | undefined,
    account,
    value,
    chainId,
    query: {
      enabled: Boolean(enabled && address && functionName)
    }
  });

  const config = useMemo<LegacyContractWriteConfig>(
    () => ({
      abi,
      address,
      functionName,
      args,
      account,
      value,
      chainId,
      request: simulation.data?.request as AnyWriteContractParameters | undefined
    }),
    [abi, address, functionName, args, account, value, chainId, simulation.data?.request]
  );

  return {
    ...simulation,
    config
  };
}

export function useContractWrite(config?: LegacyContractWriteConfig) {
  const result = useWriteContract();
  const {
    writeContract,
    writeContractAsync,
    data: hash,
    error,
    status,
    reset,
    failureCount,
    isIdle,
    isPending,
    isSuccess,
    isError,
    variables
  } = result;

  const write = useCallback(
    (override?: Partial<AnyWriteContractParameters>) => {
      const request = ensureRequest(config, override);
      return writeContract(request);
    },
    [config, writeContract]
  );

  const writeAsync = useCallback(
    (override?: Partial<AnyWriteContractParameters>) => {
      const request = ensureRequest(config, override);
      return writeContractAsync(request);
    },
    [config, writeContractAsync]
  );

  const data = useMemo(() => (hash ? { hash } : undefined), [hash]);

  return {
    data,
    error,
    status,
    reset,
    failureCount,
    isIdle,
    isLoading: isPending,
    isPending,
    isSuccess,
    isError,
    variables,
    write,
    writeAsync,
    writeContract,
    writeContractAsync,
    hash
  };
}

export function useWaitForTransaction(parameters: UseWaitForTransactionParameters = {}) {
  const { hash, enabled, onError, onSuccess, ...rest } = parameters;

  const waitResult = useWaitForTransactionReceipt({
    hash,
    ...rest,
    query: {
      enabled: enabled ?? Boolean(hash),
      gcTime: 0,
      ...(onError ? { onError } : {}),
      ...(onSuccess ? { onSuccess } : {})
    }
  });

  return {
    ...waitResult,
    isLoading: waitResult.isLoading,
    isSuccess: waitResult.isSuccess,
    isError: waitResult.isError,
    data: waitResult.data
  };
}
