"use client";

import { createContext, useContext, useCallback, useState, useEffect, type PropsWithChildren } from "react";
import { getDefaultDeploymentVersion, getDeploymentsForChain } from "../lib/deployments";

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

function getDefaultVersions(): Record<number, string> {
  return {
    11155111: getDefaultDeploymentVersion(11155111) ?? "v3",
  };
}

// ========================================
// Available versions
// ========================================

function getVersionOptions(chainId?: number): VersionOption[] {
  return getDeploymentsForChain(chainId)
    .filter((deployment) => Boolean(deployment.address))
    .map((deployment) => ({
      key: deployment.key,
      label: deployment.label,
      description: deployment.description,
      isFHE: deployment.isFHE,
    }));
}

// ========================================
// Available versions per chain
// ========================================

function getChainVersionKeys(chainId?: number): string[] {
  return getVersionOptions(chainId).map((deployment) => deployment.key);
}

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
  const versions = getVersionOptions(chainId);
  return versions.length > 0 && versions.every((version) => version.isFHE);
}

// ========================================
// Context
// ========================================

const VersionContext = createContext<VersionContextValue>({
  getSelectedVersion: () => "v3",
  selectVersion: () => {},
  getAvailableVersions: () => getVersionOptions(11155111),
  getSelectedVersionLabel: () => "V3 — SealedMessage",
});

export function VersionProvider({ children }: PropsWithChildren) {
  const [versionMap, setVersionMap] = useState<Record<number, string>>({});

  // Client-side mount — load from localStorage
  useEffect(() => {
    const defaultVersions = getDefaultVersions();
    const loaded: Record<number, string> = {};
    // Load defaults for all chains
    for (const chainId of Object.keys(defaultVersions).map(Number)) {
      const stored = getStoredVersion(chainId);
      const availableKeys = getChainVersionKeys(chainId);
      const fallbackVersion = defaultVersions[chainId] ?? "v3";
      loaded[chainId] = stored && availableKeys.includes(stored) ? stored : fallbackVersion;
    }
    // Also check non-default chains
    for (const storageName of Object.keys(localStorage)) {
      if (storageName.startsWith(STORAGE_KEY_PREFIX)) {
        const chainId = parseInt(storageName.replace(STORAGE_KEY_PREFIX, ""), 10);
        if (!isNaN(chainId) && !loaded[chainId]) {
          const stored = localStorage.getItem(storageName);
          const fallbackVersion = getDefaultDeploymentVersion(chainId) ?? "v3";
          loaded[chainId] = stored && getChainVersionKeys(chainId).includes(stored) ? stored : fallbackVersion;
        }
      }
    }
    setVersionMap(loaded);
  }, []);

  const getSelectedVersion = useCallback(
    (chainId?: number): string | undefined => {
      if (!chainId) return undefined;
      const availableKeys = getChainVersionKeys(chainId);
      // First try from map
      const mapped = versionMap[chainId];
      if (mapped && availableKeys.includes(mapped)) return mapped;
      // Otherwise try default
      return getDefaultDeploymentVersion(chainId) ?? "v3";
    },
    [versionMap]
  );

  const selectVersion = useCallback((chainId: number, versionKey: string) => {
    setVersionMap((prev) => ({ ...prev, [chainId]: versionKey }));
    setStoredVersion(chainId, versionKey);
  }, []);

  const getAvailableVersions = useCallback(
    (chainId?: number): VersionOption[] => {
      if (chainId) {
        return getVersionOptions(chainId);
      }
      return getVersionOptions(11155111);
    },
    []
  );

  const getSelectedVersionLabel = useCallback(
    (chainId?: number): string => {
      const key = chainId ? getSelectedVersion(chainId) : undefined;
      if (!key) return "Unknown";
      const option = getAvailableVersions(chainId).find((version) => version.key === key);
      return option?.label ?? key;
    },
    [getAvailableVersions, getSelectedVersion]
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
