"use client";

import { useNetwork } from "./wagmiCompat";
import { getContractAddress, getFHEContractAddress } from "./chains";
import { useVersioning } from "../components/VersionProvider";
import { getDeployment } from "./deployments";

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
  const deployment = getDeployment(chain.id, version);

  if (deployment?.address) {
    return deployment.address;
  }

  const isFHE = version === "v4-fhe-legacy";

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
export function useContractVersion(): string | undefined {
  const { chain } = useNetwork();
  const { getSelectedVersion } = useVersioning();

  if (!chain) return undefined;

  return getSelectedVersion(chain.id);
}

/**
 * Returns whether the selected version is FHE.
 */
export function useIsFHE(): boolean {
  const version = useContractVersion();
  return version === "v4-fhe-legacy" || version === "v5-fhe";
}
