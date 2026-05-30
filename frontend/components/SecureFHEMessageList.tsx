"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, usePublicClient } from "../lib/wagmiCompat";
import { useContractAddress } from "../lib/useContractAddress";
import { sealedMessageFheSecureAbi } from "../lib/sealedMessageFheSecureAbi";
import { SecureFHEMessageCard } from "./SecureFHEMessageCard";

type Props = {
  refreshKey?: number;
};

type SecureMessageRow = {
  id: bigint;
  summary: {
    sender: string;
    receiver: string;
    createdAt: bigint;
    unlockTime: bigint;
    conditionMode: number;
    hasTimeCondition: boolean;
    hasPaymentCondition: boolean;
    payloadCid: string;
    metadataCid: string;
    previewCid: string;
    previewText: string;
    payloadHash: string;
    metadataHash: string;
    revoked: boolean;
    unlocked: boolean;
  };
  access: {
    requiredPayment: bigint;
    paidAmount: bigint;
    isPaymentMet: boolean;
    isTimeMet: boolean;
    isReadyToUnlock: boolean;
    isUnlocked: boolean;
    isRevoked: boolean;
  };
};

export function SecureFHEMessageList({ refreshKey }: Props) {
  const client = usePublicClient();
  const contractAddress = useContractAddress();
  const { address: userAddress, isConnected } = useAccount();
  const [items, setItems] = useState<SecureMessageRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMessages = useCallback(async () => {
    if (!client || !contractAddress || !userAddress) {
      setItems([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [sentIds, receivedIds] = await Promise.all([
        client.readContract({ address: contractAddress, abi: sealedMessageFheSecureAbi, functionName: "getSentMessages", args: [userAddress] }) as Promise<bigint[]>,
        client.readContract({ address: contractAddress, abi: sealedMessageFheSecureAbi, functionName: "getReceivedMessages", args: [userAddress] }) as Promise<bigint[]>,
      ]);

      const ids = [...new Set([...sentIds, ...receivedIds])].sort((left, right) => Number(right - left));
      const rows = await Promise.all(ids.map(async (id) => {
        const [summary, access] = await Promise.all([
          client.readContract({ address: contractAddress, abi: sealedMessageFheSecureAbi, functionName: "getMessageSummary", args: [id] }) as Promise<SecureMessageRow["summary"]>,
          client.readContract({ address: contractAddress, abi: sealedMessageFheSecureAbi, functionName: "getMessageAccess", args: [id] }) as Promise<SecureMessageRow["access"]>,
        ]);
        return { id, summary, access };
      }));

      setItems(rows);
    } catch (fetchError) {
      console.error("secure list fetch failed", fetchError);
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load secure messages");
    } finally {
      setLoading(false);
    }
  }, [client, contractAddress, userAddress]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages, refreshKey]);

  if (!isConnected) {
    return <div className="mx-auto w-full max-w-2xl rounded-xl border border-gray-700 bg-gray-900/60 p-6 text-center text-sm text-gray-400">Connect your wallet to inspect secure FHE messages.</div>;
  }

  if (loading && items.length === 0) {
    return <div className="mx-auto w-full max-w-2xl rounded-xl border border-gray-700 bg-gray-900/60 p-6 text-center text-sm text-gray-400">Loading secure FHE messages...</div>;
  }

  if (error) {
    return <div className="mx-auto w-full max-w-2xl rounded-xl border border-red-500/30 bg-red-950/20 p-6 text-sm text-red-200">{error}</div>;
  }

  if (items.length === 0) {
    return <div className="mx-auto w-full max-w-2xl rounded-xl border border-gray-700 bg-gray-900/60 p-6 text-center text-sm text-gray-400">No secure FHE messages yet.</div>;
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-3">
      {items.map((item) => (
        <SecureFHEMessageCard key={item.id.toString()} id={item.id} summary={item.summary} access={item.access} onChanged={fetchMessages} />
      ))}
    </div>
  );
}
