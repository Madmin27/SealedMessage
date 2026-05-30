"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { usePublicClient, useAccount, useNetwork } from "../lib/wagmiCompat";
import { sealedMessageFheAbi } from "../lib/sealedMessageFheAbi";
import { useContractAddress } from "../lib/useContractAddress";
import { FHEMessageCard } from "./FHEMessageCard";

dayjs.extend(relativeTime);

interface FHEMessageListProps {
  refreshKey?: number;
}

interface FHEMessageViewModel {
  id: bigint;
  sender: string;
  receiver: string;
  conditionMask: number;
  requiredPayment: bigint;
  paidAmount: bigint;
  isUnlocked: boolean;
  createdAt: bigint;
  exists: boolean;
}

export function FHEMessageList({ refreshKey }: FHEMessageListProps) {
  const client = usePublicClient();
  const { address: userAddress, isConnected } = useAccount();
  const { chain } = useNetwork();
  const contractAddress = useContractAddress();
  const chainId = chain?.id;

  const [messages, setMessages] = useState<FHEMessageViewModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const fetchMessages = useCallback(async () => {
    if (!client || !contractAddress || !userAddress) return;

    setLoading(true);
    setError(null);

    try {
      // 1. Get sent & received message IDs for the current user
      const [sentIds, receivedIds] = await Promise.all([
        client.readContract({
          address: contractAddress,
          abi: sealedMessageFheAbi,
          functionName: "getSentMessages",
          args: [userAddress],
        }) as Promise<bigint[]>,
        client.readContract({
          address: contractAddress,
          abi: sealedMessageFheAbi,
          functionName: "getReceivedMessages",
          args: [userAddress],
        }) as Promise<bigint[]>,
      ]);

      // Deduplicate and sort (newest first)
      const allIds = [...new Set([...sentIds, ...receivedIds])].sort((a, b) => {
        if (a > b) return -1;
        if (a < b) return 1;
        return 0;
      });

      // 2. Load details for each message (batch in chunks to avoid rate limits)
      const BATCH_SIZE = 10;
      const results: FHEMessageViewModel[] = [];

      for (let i = 0; i < allIds.length; i += BATCH_SIZE) {
        const batch = allIds.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(async (id) => {
            try {
              const [parties, finView] = await Promise.all([
                client.readContract({
                  address: contractAddress,
                  abi: sealedMessageFheAbi,
                  functionName: "getMessageParties",
                  args: [id],
                }) as Promise<readonly [string, string, boolean, string, string]>,
                client.readContract({
                  address: contractAddress,
                  abi: sealedMessageFheAbi,
                  functionName: "getMessageFinancialView",
                  args: [id],
                }) as Promise<readonly [bigint, bigint, number, boolean, boolean]>,
              ]);

              // getMessageParties returns [sender, receiver, exists, dataCid, metadataCid]
              // getMessageFinancialView returns [requiredPayment, paidAmount, conditionMask, isPaymentMet, isUnlocked, exists]

              const partiesData = Array.isArray(parties) ? parties : [parties];
              const finData = Array.isArray(finView) ? finView : [finView];

              // parties: sender, receiver, exists, dataCid, metadataCid
              const sender = parties[0] as string;
              const receiver = parties[1] as string;
              const exists = Boolean(parties[2]);

              // finView: requiredPayment, paidAmount, conditionMask, isPaymentMet, isUnlocked, exists
              const requiredPayment = finView[0] as bigint;
              const paidAmount = finView[1] as bigint;
              const conditionMask = Number(finView[2]);
              const isUnlocked = Boolean(finView[4]);
              const finExists = Boolean(finView[5]);

              if (!exists || !finExists) return null;

              // createdAt is not directly readable from parties/finView
              // We'll rely on the event data or use ID as proxy for ordering
              return {
                id,
                sender,
                receiver,
                conditionMask,
                requiredPayment,
                paidAmount,
                isUnlocked,
                createdAt: 0n, // Placeholder
                exists: true,
              } as FHEMessageViewModel;
            } catch (err) {
              console.warn(`⚠️ Failed to fetch FHE message ${id}:`, err);
              return null;
            }
          })
        );

        results.push(...batchResults.filter((r): r is FHEMessageViewModel => r !== null));
      }

      setMessages(results);
    } catch (err: any) {
      console.error("❌ FHEMessageList fetch error:", err);
      setError(err?.message || "Failed to load messages");
    } finally {
      setLoading(false);
    }
  }, [client, contractAddress, userAddress]);

  useEffect(() => {
    if (mounted) fetchMessages();
  }, [mounted, fetchMessages, refreshKey]);

  // Auto-refresh every 30s for new incoming messages
  useEffect(() => {
    if (!mounted) return;
    const interval = setInterval(fetchMessages, 30000);
    return () => clearInterval(interval);
  }, [mounted, fetchMessages]);

  if (!mounted) return null;

  return (
    <div className="w-full max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <span>📨</span> FHE Messages
          <span className="rounded bg-purple-600/20 px-2 py-0.5 text-xs text-purple-300">V4-FHE</span>
        </h2>
        <button
          onClick={fetchMessages}
          disabled={loading}
          className="rounded-lg bg-gray-700 px-3 py-1 text-xs text-gray-300 hover:bg-gray-600 disabled:opacity-50"
        >
          {loading ? "⟳ Loading..." : "↻ Refresh"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-900/40 border border-red-500/30 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading && messages.length === 0 && (
        <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-8 text-center text-sm text-gray-400">
          <div className="mb-2 text-2xl">🔐</div>
          <div>Loading FHE messages...</div>
        </div>
      )}

      {!loading && !isConnected && (
        <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-8 text-center text-sm text-gray-400">
          <div className="mb-2 text-2xl">👛</div>
          <div>Connect your wallet to view messages</div>
        </div>
      )}

      {!loading && isConnected && messages.length === 0 && !error && (
        <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-8 text-center text-sm text-gray-400">
          <div className="mb-2 text-2xl">📭</div>
          <div>No FHE messages yet. Send one above!</div>
        </div>
      )}

      {messages.length > 0 && (
        <div className="space-y-3">
          {messages.map((msg) => (
            <FHEMessageCard
              key={msg.id.toString()}
              id={msg.id}
              sender={msg.sender}
              receiver={msg.receiver}
              requiredPayment={msg.requiredPayment}
              paidAmount={msg.paidAmount}
              conditionMask={msg.conditionMask}
              isOnchainUnlocked={msg.isUnlocked}
              createdAt={msg.createdAt > 0n ? msg.createdAt : undefined}
              chainId={chainId}
              onMessageRead={() => fetchMessages()}
            />
          ))}
        </div>
      )}

      {messages.length > 0 && (
        <div className="text-center text-[10px] text-gray-600">
          {messages.length} message{messages.length !== 1 ? "s" : ""} loaded
        </div>
      )}
    </div>
  );
}
