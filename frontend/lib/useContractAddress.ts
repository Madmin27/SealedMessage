import { useNetwork } from "./wagmiCompat";
import { getContractAddress, getFHEContractAddress } from "./chains";
import { useVersioning } from "../components/VersionProvider";

/**
 * Hook to get the active SealedMessage contract address for the current network.
 * Version-aware: returns the FHE or original contract address based on the user's selected version.
 */
export function useContractAddress(): `0x${string}` | undefined {
  const { chain } = useNetwork();
  const { getSelectedVersion } = useVersioning();

  if (!chain) {
    return undefined;
  }

  const version = getSelectedVersion(chain.id);
  const isFHE = version === "v4-fhe";

  if (isFHE) {
    return getFHEContractAddress(chain.id);
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

/**
 * Returns the ABI name based on the selected contract version.
 */
export function useContractVersion(): "v3" | "v4-fhe" | undefined {
  const { chain } = useNetwork();
  const { getSelectedVersion } = useVersioning();

  if (!chain) return undefined;

  const version = getSelectedVersion(chain.id);
  if (version === "v4-fhe") return "v4-fhe";
  return "v3";
}

/**
 * Returns whether the selected version is FHE.
 */
export function useIsFHE(): boolean {
  const version = useContractVersion();
  return version === "v4-fhe";
}
