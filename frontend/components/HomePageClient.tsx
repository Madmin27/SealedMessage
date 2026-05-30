"use client";

import { useState, useCallback } from "react";
import { useNetwork } from "../lib/wagmiCompat";
import { WalletButton } from "./WalletButton";
import { MessageForm } from "./MessageForm";
import { MessageList } from "./MessageList";
import { FHEMessageForm } from "./FHEMessageForm";
import { FHEMessageList } from "./FHEMessageList";
import { SecureFHEMessageForm } from "./SecureFHEMessageForm";
import { SecureFHEMessageList } from "./SecureFHEMessageList";
import { NetworkSwitcher } from "./NetworkSwitcher";
import { VersionSwitcher } from "./VersionSwitcher";
import { useVersioning } from "./VersionProvider";

export function HomePageClient() {
  const [refreshKey, setRefreshKey] = useState<number>(0);
  const { chain } = useNetwork();
  const { getSelectedVersion } = useVersioning();
  const activeChainId = chain?.id;

  const selectedVersion = activeChainId ? getSelectedVersion(activeChainId) : undefined;
  const isSecureFHE = selectedVersion === "v5-fhe";
  const isLegacyFHE = selectedVersion === "v4-fhe-legacy";
  const isFHE = isSecureFHE || isLegacyFHE;

  const handleMessageSubmitted = useCallback(() => {
    setRefreshKey((prev: number) => prev + 1);
  }, []);

  return (
    <main className="flex flex-1 flex-col gap-6">
      <header className="flex flex-col gap-4 rounded-xl border border-cyber-blue/30 bg-midnight/80 p-6 shadow-glow-blue overflow-visible">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-cyber-blue">SealedMessage</h1>
            <p className="mt-2 max-w-2xl text-sm text-text-light/80">
              When conditions intersect, the seal breaks.
              {isFHE && <span className="ml-2 rounded bg-purple-600/20 px-2 py-0.5 text-xs text-purple-300">🔐 FHE</span>}
            </p>
          </div>
          <div className="flex flex-col gap-3 md:items-end overflow-visible">
            <WalletButton />
            <div className="w-full md:w-80 overflow-visible">
              <NetworkSwitcher />
            </div>
            <div className="w-full md:w-80 overflow-visible">
              <VersionSwitcher />
            </div>
          </div>
        </div>
      </header>

      {isSecureFHE ? (
        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr] xl:grid-cols-[1fr_1fr]">
          <SecureFHEMessageForm onSubmitted={handleMessageSubmitted} />
          <div className="rounded-xl border border-emerald-500/30 bg-midnight/80 p-6 text-sm text-text-light/80 shadow-glow-blue">
            <h2 className="text-lg font-semibold text-emerald-400">🛡️ How Secure FHE Works</h2>
            <ol className="mt-4 list-decimal space-y-2 pl-4">
              <li>Payload and metadata are AES-256-GCM encrypted locally.</li>
              <li>Only encrypted envelopes are pinned to IPFS.</li>
              <li>Zama FHE stores the AES key parts and releases receiver access only after conditions pass.</li>
              <li>The receiver decrypts the key with userDecrypt and opens the payload locally.</li>
            </ol>
            <p className="mt-4 text-xs text-emerald-300/70">No public decrypt path. No plaintext metadata path.</p>
          </div>
        </div>
      ) : isLegacyFHE ? (
        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr] xl:grid-cols-[1fr_1fr]">
          <FHEMessageForm onSubmitted={handleMessageSubmitted} />
          <div className="rounded-xl border border-purple-500/30 bg-midnight/80 p-6 text-sm text-text-light/80 shadow-glow-blue">
            <h2 className="text-lg font-semibold text-purple-400">🔐 Legacy FHE Flow</h2>
            <ol className="mt-4 space-y-2 list-decimal pl-4">
              <li>Set unlock conditions (time, payment, or both).</li>
              <li>Content is encrypted with AES-256-GCM client-side, then stored on IPFS via Pinata.</li>
              <li>Only the unlock time is encrypted with Zama FHE on-chain.</li>
              <li>When conditions are met, content becomes viewable.</li>
            </ol>
            <p className="mt-4 text-xs text-purple-400/60">
              Legacy path preserved for old deployments only.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr] xl:grid-cols-[1fr_1fr]">
          <MessageForm onSubmitted={handleMessageSubmitted} />
          <div className="rounded-xl border border-cyber-blue/30 bg-midnight/80 p-6 text-sm text-text-light/80 shadow-glow-blue">
            <h2 className="text-lg font-semibold text-cyber-blue">📌 How It Works?</h2>
            <ol className="mt-4 space-y-2 list-decimal pl-4">
              <li>Select the unlock date as a future time.</li>
              <li>Write your message and confirm the transaction.</li>
              <li>When the specified date arrives, the content becomes automatically viewable.</li>
            </ol>
            <p className="mt-4 text-xs text-slate-400">
              V3 uses ECDH+AES-256-GCM for end-to-end encryption.
            </p>
          </div>
        </div>
      )}

      {isSecureFHE ? (
        <SecureFHEMessageList refreshKey={refreshKey} />
      ) : isLegacyFHE ? (
        <FHEMessageList refreshKey={refreshKey} />
      ) : (
        <MessageList refreshKey={refreshKey} />
      )}
    </main>
  );
}
