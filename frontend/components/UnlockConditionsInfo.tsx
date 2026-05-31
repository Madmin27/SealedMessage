"use client";

import { useEffect, useState } from "react";

export function UnlockConditionsInfo() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex h-7 items-center gap-1 rounded-full border border-cyber-blue/25 bg-cyber-blue/10 px-2.5 text-xs font-semibold text-brand-cyan transition hover:border-cyber-blue hover:bg-cyber-blue/20"
        aria-label="Open unlock condition guide"
      >
        <span className="flex h-4 w-4 items-center justify-center rounded-full border border-brand-cyan/40 text-[10px]">?</span>
        Conditions
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="unlock-conditions-title">
          <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-[24px] border border-cyber-blue/30 bg-[linear-gradient(180deg,rgba(7,12,31,0.98),rgba(4,7,19,0.99))] p-5 text-sm text-text-light shadow-glow-blue-strong">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="unlock-conditions-title" className="text-lg font-semibold text-brand-cyan">Unlock conditions</h2>
                <p className="mt-1 text-xs text-text-light/55">What senders choose and what receivers must satisfy before decrypting.</p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-lg border border-cyber-blue/20 bg-midnight px-2 py-1 text-xs text-text-light/70 hover:border-cyber-blue/60 hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <section className="rounded-2xl border border-cyber-blue/15 bg-brand-panel/70 p-3">
                <h3 className="font-semibold text-brand-cyan">Time Only</h3>
                <p className="mt-1 text-xs leading-5 text-text-light/70">The message opens after the selected blockchain time has passed.</p>
              </section>
              <section className="rounded-2xl border border-sunset/20 bg-brand-panel/70 p-3">
                <h3 className="font-semibold text-brand-orange-soft">Payment Only</h3>
                <p className="mt-1 text-xs leading-5 text-text-light/70">The receiver pays the required ETH before the message can be unlocked.</p>
              </section>
              <section className="rounded-2xl border border-aurora/25 bg-brand-panel/70 p-3">
                <h3 className="font-semibold text-[#c39cff]">Time AND Payment</h3>
                <p className="mt-1 text-xs leading-5 text-text-light/70">Both conditions are required: time must pass and payment must be made.</p>
              </section>
              <section className="rounded-2xl border border-emerald-400/20 bg-brand-panel/70 p-3">
                <h3 className="font-semibold text-emerald-300">Time OR Payment</h3>
                <p className="mt-1 text-xs leading-5 text-text-light/70">Either condition is enough: the receiver can wait for time or pay to unlock earlier.</p>
              </section>
            </div>

            <div className="mt-4 space-y-3 rounded-2xl border border-cyber-blue/15 bg-midnight/60 p-4 text-xs leading-5 text-text-light/70">
              <p><span className="font-semibold text-brand-cyan">Sender:</span> chooses the condition, can revoke only while the message is unopened and unpaid, and withdraws received payments from pending earnings.</p>
              <p><span className="font-semibold text-brand-cyan">Receiver:</span> sees only public preview data before unlock, satisfies the selected condition, then decrypts locally after FHE access is released.</p>
              <p><span className="font-semibold text-brand-cyan">Privacy:</span> payload, private metadata, attachments, and AES key material remain sealed until the unlock rule is satisfied.</p>
            </div>

            <p className="mt-4 text-xs text-brand-cyan/70">
              Full reference: <span className="font-mono">docs/unlock-conditions.md</span>
            </p>
          </div>
        </div>
      )}
    </>
  );
}
