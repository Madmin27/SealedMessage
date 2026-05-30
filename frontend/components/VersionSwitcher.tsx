"use client";

import { useState, useMemo, useCallback } from "react";
import { useNetwork } from "../lib/wagmiCompat";
import { useVersioning } from "./VersionProvider";

export function VersionSwitcher() {
  const { chain } = useNetwork();
  const { getSelectedVersion, selectVersion, getAvailableVersions, getSelectedVersionLabel } =
    useVersioning();

  const chainId = chain?.id;
  const availableVersions = useMemo(() => getAvailableVersions(chainId), [getAvailableVersions, chainId]);
  const currentVersion = chainId ? getSelectedVersion(chainId) : undefined;
  const currentLabel = chainId ? getSelectedVersionLabel(chainId) : "Versiyon seçin";

  const [isOpen, setIsOpen] = useState(false);

  const handleSelect = useCallback(
    (versionKey: string) => {
      if (chainId) {
        selectVersion(chainId, versionKey);
      }
      setIsOpen(false);
    },
    [chainId, selectVersion]
  );

  // Sadece bir versiyon varsa dropdown göstermeye gerek yok
  if (availableVersions.length <= 1) {
    return null;
  }

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-2 rounded-lg border border-gray-600 bg-gray-800 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <span className="flex items-center gap-2">
          {currentVersion === "v4-fhe" && <span className="text-xs">🔐</span>}
          {currentVersion === "v3" && <span className="text-xs">📜</span>}
          {currentLabel}
        </span>
        <svg
          className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <>
          {/* Arkaplan tıkla-kapat */}
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />

          <div className="absolute right-0 z-20 mt-2 w-72 origin-top-right rounded-lg border border-gray-600 bg-gray-800 shadow-xl">
            <div className="p-1">
              {availableVersions.map((version) => {
                const isActive = currentVersion === version.key;
                return (
                  <button
                    key={version.key}
                    type="button"
                    disabled={isActive}
                    onClick={() => handleSelect(version.key)}
                    className={`flex w-full items-start gap-3 rounded-md px-3 py-3 text-left text-sm transition-colors ${
                      isActive
                        ? "bg-blue-600/20 text-blue-300 cursor-default"
                        : "text-gray-300 hover:bg-gray-700 hover:text-white"
                    }`}
                  >
                    <span className="mt-0.5 text-base">
                      {version.isFHE ? "🔐" : "📜"}
                    </span>
                    <div className="flex-1">
                      <div className="font-medium">{version.label}</div>
                      <div className="mt-0.5 text-xs text-gray-400">
                        {version.description}
                      </div>
                    </div>
                    {isActive && (
                      <span className="text-blue-400 text-xs mt-1">✓</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
