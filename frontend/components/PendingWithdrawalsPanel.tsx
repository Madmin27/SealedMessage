"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ethers, formatEther } from "ethers";
import { useAccount, usePublicClient } from "../lib/wagmiCompat";
import { useContractAbi, useContractAddress, useContractVersion } from "../lib/useContractAddress";

type Props = {
  onWithdrawSuccess?: () => void;
};

export function PendingWithdrawalsPanel({ onWithdrawSuccess }: Props) {
  const { address, isConnected } = useAccount();
  const client = usePublicClient();
  const contractAddress = useContractAddress();
  const versionKey = useContractVersion();
  const abi = useContractAbi();
  const [pendingWei, setPendingWei] = useState<bigint>(0n);
  const [isLoading, setIsLoading] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isSupportedVersion = versionKey === "v5.1-fhe" || versionKey === "v5.2-fhe" || versionKey === "v5.2.1-fhe";
  const hasPending = pendingWei > 0n;
  const pendingEth = useMemo(() => formatEther(pendingWei), [pendingWei]);

  const refreshPending = useCallback(async () => {
    if (!isConnected || !address || !client || !contractAddress || !isSupportedVersion) {
      setPendingWei(0n);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const value = await client.readContract({
        address: contractAddress,
        abi,
        functionName: "pendingWithdrawals",
        args: [address],
      }) as bigint;
      setPendingWei(typeof value === "bigint" ? value : 0n);
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "Could not read pending earnings");
    } finally {
      setIsLoading(false);
    }
  }, [abi, address, client, contractAddress, isConnected, isSupportedVersion]);

  useEffect(() => {
    refreshPending();
    const interval = window.setInterval(refreshPending, 15_000);
    return () => window.clearInterval(interval);
  }, [refreshPending]);

  const handleWithdraw = useCallback(async () => {
    if (!contractAddress || !hasPending || isWithdrawing) return;

    setIsWithdrawing(true);
    setError(null);
    setSuccess(null);
    try {
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const signerAddress = await signer.getAddress();
      if (!address || signerAddress.toLowerCase() !== address.toLowerCase()) {
        throw new Error("Active wallet changed. Please reconnect and try again.");
      }
      const contract = new ethers.Contract(contractAddress, abi, signer);
      const tx = await contract.withdrawPayments();
      await tx.wait();
      setSuccess("Earnings withdrawn.");
      await refreshPending();
      onWithdrawSuccess?.();
    } catch (withdrawError) {
      const message = withdrawError instanceof Error ? withdrawError.message : "Withdraw failed";
      if (message.includes("ACTION_REJECTED") || message.includes("user rejected action")) {
        setError("Transaction was cancelled in the wallet.");
      } else {
        setError(message);
      }
    } finally {
      setIsWithdrawing(false);
    }
  }, [abi, address, contractAddress, hasPending, isWithdrawing, onWithdrawSuccess, refreshPending]);

  if (!isConnected || !isSupportedVersion) {
    return null;
  }

  return (
    <div className="rounded-[24px] border border-cyber-blue/25 bg-[linear-gradient(180deg,rgba(7,20,38,0.88),rgba(5,10,25,0.94))] p-4 shadow-glow-blue">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-brand-cyan">Pending earnings</p>
          <p className="mt-1 text-sm text-text-light/70">
            {isLoading
              ? "Checking pending withdrawals..."
              : hasPending
                ? `You have ${pendingEth} ETH available to withdraw.`
                : "No pending earnings yet."}
          </p>
          {!hasPending && !isLoading && (
            <p className="mt-1 text-xs text-text-light/45">Payments received for your messages will appear here.</p>
          )}
        </div>

        <button
          type="button"
          onClick={handleWithdraw}
          disabled={!hasPending || isWithdrawing}
          className="rounded-xl bg-gradient-to-r from-cyber-blue to-sunset px-4 py-2 text-sm font-semibold text-midnight shadow-glow-orange transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isWithdrawing ? "Withdrawing..." : hasPending ? `Withdraw ${pendingEth} ETH` : "Withdraw earnings"}
        </button>
      </div>

      {success && <div className="mt-3 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">{success}</div>}
      {error && <div className="mt-3 rounded-xl border border-red-500/25 bg-red-950/30 px-3 py-2 text-xs text-red-200">{error}</div>}
    </div>
  );
}
