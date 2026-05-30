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
  /** Seçili zincir için aktif versiyonu döndürür */
  getSelectedVersion: (chainId?: number) => string | undefined;
  /** Bir zincir için versiyon seçer (localStorage'a kaydeder) */
  selectVersion: (chainId: number, versionKey: string) => void;
  /** Bir zincir için kullanılabilir versiyonları döndürür */
  getAvailableVersions: (chainId?: number) => VersionOption[];
  /** Aktif zincir için seçili versiyon etiketini döndürür */
  getSelectedVersionLabel: (chainId?: number) => string;
}

// ========================================
// Default versions per chain
// ========================================

const DEFAULT_VERSIONS: Record<number, string> = {
  8009: "v4-fhe", // Zama FHEVM — default FHE
};

// ========================================
// Available versions
// ========================================

const ALL_VERSIONS: VersionOption[] = [
  { key: "v3", label: "V3 — SealedMessage", description: "Original (ECDH+AES-256-GCM)", isFHE: false },
  { key: "v4-fhe", label: "V4-FHE — SealedMessageFHE", description: "FHE-encrypted (Zama FHEVM)", isFHE: true },
];

// ========================================
// FHE-only chains (sadece FHE versiyonu desteklenir)
// ========================================

const FHE_ONLY_CHAINS: number[] = [8009];

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
    // localStorage dolu olabilir, sessizce başarısız ol
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

  // Client-side mount — localStorage'dan yükle
  useEffect(() => {
    const loaded: Record<number, string> = {};
    // Tüm zincirler için varsayılanları yükle
    for (const chainId of Object.keys(DEFAULT_VERSIONS).concat("8009").map(Number)) {
      const stored = getStoredVersion(chainId);
      loaded[chainId] = stored ?? DEFAULT_VERSIONS[chainId] ?? "v3";
    }
    // Varsayılan olmayan zincirleri de kontrol et
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
      // Önce map'ten dene
      const mapped = versionMap[chainId];
      if (mapped) return mapped;
      // Yoksa varsayılanı dene
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
