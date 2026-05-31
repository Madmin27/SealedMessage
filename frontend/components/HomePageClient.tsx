"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import Image from "next/image";
import { useAccount, useNetwork } from "../lib/wagmiCompat";
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
  const { address: userAddress } = useAccount();
  const { chain } = useNetwork();
  const { getSelectedVersion } = useVersioning();
  const activeChainId = chain?.id;

  const selectedVersion = activeChainId ? getSelectedVersion(activeChainId) : undefined;
  const isSecureFHE = selectedVersion === "v5-fhe" || selectedVersion === "v5.1-fhe" || selectedVersion === "v5.2-fhe" || selectedVersion === "v5.2.1-fhe";
  const isLegacyFHE = selectedVersion === "v4-fhe-legacy";
  const isFHE = isSecureFHE || isLegacyFHE;
  const walletScopeKey = useMemo(
    () => `${activeChainId ?? "no-chain"}:${userAddress?.toLowerCase() ?? "no-account"}:${selectedVersion ?? "no-version"}`,
    [activeChainId, selectedVersion, userAddress]
  );

  const handleMessageSubmitted = useCallback(() => {
    setRefreshKey((prev: number) => prev + 1);
  }, []);

  useEffect(() => {
    setRefreshKey((prev) => prev + 1);
  }, [walletScopeKey]);

  return (
    <main className="flex flex-1 flex-col gap-6 md:gap-8">
      <header className="relative overflow-hidden rounded-[28px] border border-cyber-blue/25 bg-brand-panel/85 px-4 py-5 shadow-glow-blue-strong sm:px-5 md:px-8 md:py-7">
        <Image
          src="/image/9.png"
          alt="SealedMessage hero background"
          fill
          priority
          className="pointer-events-none absolute inset-0 object-cover opacity-35"
        />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(24,209,255,0.18),transparent_28%),radial-gradient(circle_at_85%_82%,rgba(122,61,255,0.26),transparent_24%),linear-gradient(180deg,rgba(5,8,22,0.12),rgba(5,8,22,0.76))]" />
        <div className="relative z-10 flex flex-col gap-8">
          <div className="flex flex-col justify-between gap-6 xl:flex-row xl:items-start">
            <div className="max-w-3xl space-y-4">
              <div className="inline-flex rounded-full border border-cyber-blue/20 bg-midnight/55 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.35em] text-brand-cyan shadow-glow-blue">
                Private. Encrypted. On-Chain.
              </div>
              <Image
                src="/image/6-transparent.png"
                alt="SealedMessage wordmark"
                width={680}
                height={227}
                className="h-auto w-full max-w-[560px] drop-shadow-[0_0_28px_rgba(24,209,255,0.22)]"
                priority
              />
              <div className="max-w-[620px] space-y-4">
                <p className="text-base leading-7 text-text-light/86 md:text-lg">
                  Send sealed messages with time, payment, or FHE-gated release logic. The interface now follows the same neon-circuit brand system as the hero artwork.
                  {isFHE && <span className="ml-2 rounded-full border border-aurora/30 bg-aurora/10 px-2 py-0.5 text-xs font-semibold text-[#b89cff]">FHE Enabled</span>}
                </p>
                <Image
                  src="/image/8-transparent.png"
                  alt="SealedMessage divider"
                  width={2172}
                  height={724}
                  className="h-12 w-full max-w-[560px] object-contain object-left opacity-85 sm:h-16"
                />
              </div>
            </div>

            <div className="flex w-full max-w-[360px] flex-col gap-3 self-start overflow-visible">
              <WalletButton />
              <div className="overflow-visible">
                <NetworkSwitcher />
              </div>
              <div className="overflow-visible">
                <VersionSwitcher />
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-[28px] border border-cyber-blue/20 bg-midnight/55 p-5 backdrop-blur-[1px]">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border border-cyber-blue/15 bg-brand-panel/70 p-4">
                  <p className="text-[11px] uppercase tracking-[0.25em] text-text-light/45">Mode</p>
                  <p className="mt-2 text-lg font-semibold text-text-light">{selectedVersion ?? "Select version"}</p>
                </div>
                <div className="rounded-2xl border border-cyber-blue/15 bg-brand-panel/70 p-4">
                  <p className="text-[11px] uppercase tracking-[0.25em] text-text-light/45">Network</p>
                  <p className="mt-2 text-lg font-semibold text-brand-cyan">{chain?.name ?? "Disconnected"}</p>
                </div>
                <div className="rounded-2xl border border-cyber-blue/15 bg-brand-panel/70 p-4">
                  <p className="text-[11px] uppercase tracking-[0.25em] text-text-light/45">Unlock Model</p>
                  <p className="mt-2 text-lg font-semibold text-[#c39cff]">{isSecureFHE ? "FHE Secure" : isLegacyFHE ? "Legacy FHE" : "Timed Release"}</p>
                </div>
              </div>
              {isSecureFHE && (
                <div className="mt-4 rounded-2xl border border-cyber-blue/15 bg-brand-panel/70 p-4 text-sm text-text-light/80">
                  <h2 className="text-lg font-semibold text-brand-cyan">🛡️ How Secure FHE Works</h2>
                  <ol className="mt-3 list-decimal space-y-1.5 pl-4">
                    <li>Payload and metadata are AES-256-GCM encrypted locally.</li>
                    <li>Only encrypted envelopes are pinned to IPFS.</li>
                    <li>Zama FHE stores the AES key parts and releases receiver access only after conditions pass.</li>
                    <li>The receiver decrypts the key with userDecrypt and opens the payload locally.</li>
                  </ol>
                  <p className="mt-3 text-xs text-brand-cyan/70">No public decrypt path. No plaintext metadata path.</p>
                </div>
              )}
            </div>

            <div className="rounded-[30px] border border-cyber-blue/20 bg-[linear-gradient(180deg,rgba(10,16,39,0.88),rgba(8,12,28,0.94))] p-5 shadow-glow-blue">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Image
                    src="/image/7-transparent.png"
                    alt="SealedMessage icon"
                    width={72}
                    height={72}
                    className="h-12 w-12 shrink-0 object-contain drop-shadow-[0_0_14px_rgba(24,209,255,0.25)] sm:h-14 sm:w-14"
                  />
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.3em] text-brand-cyan">Active Contract</p>
                    <p className="mt-1 text-lg font-semibold text-text-light">{isSecureFHE ? "AES-256-GCM" : isLegacyFHE ? "Legacy FHE" : "ECDH + AES"}</p>
                  </div>
                </div>
                <div className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-300">
                  ON-CHAIN
                </div>
              </div>

              <div className="mt-5 space-y-3 text-sm text-text-light/72">
                <div className="flex items-center justify-between gap-4 rounded-2xl border border-cyber-blue/10 bg-midnight/50 px-4 py-3">
                  <span>Release Logic</span>
                  <span className="font-semibold text-brand-cyan">{isSecureFHE ? "Time / Payment / FHE" : "Time-based unlock"}</span>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-2xl border border-cyber-blue/10 bg-midnight/50 px-4 py-3">
                  <span>Privacy Layer</span>
                  <span className="font-semibold text-[#c39cff]">{isFHE ? "Encrypted metadata + sealed payload" : "Client-side encrypted payload"}</span>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-2xl border border-cyber-blue/10 bg-midnight/50 px-4 py-3">
                  <span>Status</span>
                  <span className="font-semibold text-emerald-300">Ready to send</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="pointer-events-none mx-auto w-full max-w-5xl">
        <Image
          src="/image/8-transparent.png"
          alt="Section divider"
          width={2172}
          height={724}
          className="h-12 w-full object-contain opacity-65 sm:h-16 md:h-20"
        />
      </div>

      {isSecureFHE ? (
        <div className="mx-auto w-full max-w-2xl">
          <SecureFHEMessageForm key={`secure-form-${walletScopeKey}`} onSubmitted={handleMessageSubmitted} versionKey={selectedVersion} />
        </div>
      ) : isLegacyFHE ? (
        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr] xl:grid-cols-[1fr_1fr]">
          <FHEMessageForm key={`legacy-fhe-form-${walletScopeKey}`} onSubmitted={handleMessageSubmitted} />
          <div className="rounded-[24px] border border-aurora/25 bg-brand-panel/75 p-6 text-sm text-text-light/80 shadow-glow-blue">
            <h2 className="text-lg font-semibold text-cyber-blue">🔐 Legacy FHE Flow</h2>
            <ol className="mt-4 space-y-2 list-decimal pl-4">
              <li>Set unlock conditions (time, payment, or both).</li>
              <li>Content is encrypted with AES-256-GCM client-side, then stored on IPFS via Pinata.</li>
              <li>Only the unlock time is encrypted with Zama FHE on-chain.</li>
              <li>When conditions are met, content becomes viewable.</li>
            </ol>
            <p className="mt-4 text-xs text-cyber-blue/60">
              Legacy path preserved for old deployments only.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr] xl:grid-cols-[1fr_1fr]">
          <MessageForm key={`message-form-${walletScopeKey}`} onSubmitted={handleMessageSubmitted} />
          <div className="rounded-[24px] border border-cyber-blue/20 bg-brand-panel/75 p-6 text-sm text-text-light/80 shadow-glow-blue">
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
        <SecureFHEMessageList key={`secure-list-${walletScopeKey}`} refreshKey={refreshKey} />
      ) : isLegacyFHE ? (
        <FHEMessageList key={`fhe-list-${walletScopeKey}`} refreshKey={refreshKey} />
      ) : (
        <MessageList key={`message-list-${walletScopeKey}`} refreshKey={refreshKey} />
      )}
    </main>
  );
}
