import { useNetwork } from "wagmi";
import { getContractAddress } from "./chains";

/**
 * Hook to get the active SealedMessage contract address for the current network.
 * No version switching – one contract per supported chain.
 */
export function useContractAddress(): `0x${string}` | undefined {
  const { chain } = useNetwork();
  
  if (!chain) {
    return undefined;
  }

  return getContractAddress(chain.id);
}

/**
 * Check if the current network has a deployed SealedMessage contract.
 */
export function useHasContract(): boolean {
  const address = useContractAddress();
  return !!address;
}
