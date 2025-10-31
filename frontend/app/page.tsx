"use client";

import { useState, useCallback } from "react";
import { WalletButton } from "../components/WalletButton";
import { MessageForm } from "../components/MessageForm";
import { MessageList } from "../components/MessageList";
import { NetworkSwitcher } from "../components/NetworkSwitcher";
import { VersionSwitcher } from "../components/VersionSwitcher";
import { appConfig } from "../lib/env";

export default function HomePage() {
  const [refreshKey, setRefreshKey] = useState<number>(0);
  
  console.log("🏠 HomePage loaded");

  // Stabilize callback - same reference on every render
  const handleMessageSubmitted = useCallback(() => {
    console.log("📨 New message sent, updating list...");
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
            Note: Later, content will be kept private on-chain with Fully Homomorphic Encryption (FHE).
          </p>
        </div>
      </div>

      <MessageList refreshKey={refreshKey} />
    </main>
  );
}
