"use client";

import { createContext, useContext, useCallback, useState, useEffect, type PropsWithChildren } from "react";

// ========================================
// Types
// ========================================

export interface VersionOption {
  key: string;
  label: string;
  description: string;
  isFHE: boolean;
}

export interface VersionContextValue {
  /** Returns the active version for the selected chain */
  getSelectedVersion: (chainId?: number) => string | undefined;
  /** Selects a version for a chain (saves to localStorage) */
  selectVersion: (chainId: number, versionKey: string) => void;
  /** Returns available versions for a chain */
  getAvailableVersions: (chainId?: number) => VersionOption[];
  /** Returns the selected version label for the active chain */
  getSelectedVersionLabel: (chainId?: number) => string;
}

// ========================================
// Default versions per chain
// ========================================

const DEFAULT_VERSIONS: Record<number, string> = {
  11155111: "v4-fhe", // Sepolia-backed Zama FHEVM defaults to FHE
};

// ========================================
// Available versions
// ========================================

const ALL_VERSIONS: VersionOption[] = [
  { key: "v3", label: "V3 — SealedMessage", description: "Original (ECDH+AES-256-GCM)", isFHE: false },
  { key: "v4-fhe", label: "V4-FHE — SealedMessageFHE", description: "FHE-encrypted (Zama FHEVM on Sepolia)", isFHE: true },
];

// ========================================
// FHE-only chains (only FHE version supported)
// ========================================

const FHE_ONLY_CHAINS: number[] = [11155111];

// ========================================
// LocalStorage helpers
// ========================================

const STORAGE_KEY_PREFIX = "sealedmsg-version-";

function getStoredVersion(chainId: number): string | null {
  try {
    return localStorage.getItem(`${STORAGE_KEY_PREFIX}${chainId}`);
  } catch {
    return null;
  }
}

function setStoredVersion(chainId: number, version: string): void {
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${chainId}`, version);
  } catch {
    // localStorage may be full, silently fail
  }
}

// ========================================
// FHE chain check
// ========================================

export function isFHEChain(chainId: number): boolean {
  return FHE_ONLY_CHAINS.includes(chainId);
}

// ========================================
// Context
// ========================================

const VersionContext = createContext<VersionContextValue>({
  getSelectedVersion: () => "v3",
  selectVersion: () => {},
  getAvailableVersions: () => ALL_VERSIONS,
  getSelectedVersionLabel: () => "V3 — SealedMessage",
});

export function VersionProvider({ children }: PropsWithChildren) {
  const [versionMap, setVersionMap] = useState<Record<number, string>>({});

  // Client-side mount — load from localStorage
  useEffect(() => {
    const loaded: Record<number, string> = {};
    // Load defaults for all chains
    for (const chainId of Object.keys(DEFAULT_VERSIONS).map(Number)) {
      const stored = getStoredVersion(chainId);
      loaded[chainId] = stored ?? DEFAULT_VERSIONS[chainId] ?? "v3";
    }
    // Also check non-default chains
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(STORAGE_KEY_PREFIX)) {
        const chainId = parseInt(key.replace(STORAGE_KEY_PREFIX, ""), 10);
        if (!isNaN(chainId) && !loaded[chainId]) {
          loaded[chainId] = localStorage.getItem(key) ?? "v3";
        }
      }
    }
    setVersionMap(loaded);
  }, []);

  const getSelectedVersion = useCallback(
    (chainId?: number): string | undefined => {
      if (!chainId) return undefined;
      // First try from map
      const mapped = versionMap[chainId];
      if (mapped) return mapped;
      // Otherwise try default
      return DEFAULT_VERSIONS[chainId] ?? "v3";
    },
    [versionMap]
  );

  const selectVersion = useCallback((chainId: number, versionKey: string) => {
    setVersionMap((prev) => ({ ...prev, [chainId]: versionKey }));
    setStoredVersion(chainId, versionKey);
  }, []);

  const getAvailableVersions = useCallback(
    (chainId?: number): VersionOption[] => {
      if (chainId && isFHEChain(chainId)) {
        // FHE-only chain — sadece FHE versiyonu
        return ALL_VERSIONS.filter((v) => v.isFHE);
      }
      return ALL_VERSIONS;
    },
    []
  );

  const getSelectedVersionLabel = useCallback(
    (chainId?: number): string => {
      const key = chainId ? getSelectedVersion(chainId) : undefined;
      if (!key) return "Unknown";
      const option = ALL_VERSIONS.find((v) => v.key === key);
      return option?.label ?? key;
    },
    [getSelectedVersion]
  );

  const value: VersionContextValue = {
    getSelectedVersion,
    selectVersion,
    getAvailableVersions,
    getSelectedVersionLabel,
  };

  return <VersionContext.Provider value={value}>{children}</VersionContext.Provider>;
}

export function useVersioning(): VersionContextValue {
  return useContext(VersionContext);
}
