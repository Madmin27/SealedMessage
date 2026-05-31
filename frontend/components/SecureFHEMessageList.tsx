"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, usePublicClient } from "../lib/wagmiCompat";
import { useContractAddress, useContractVersion } from "../lib/useContractAddress";
import { sealedMessageFheSecureAbi } from "../lib/sealedMessageFheSecureAbi";
import { sealedMessageFheV51Abi } from "../lib/sealedMessageFheV51Abi";
import { sealedMessageFheV52Abi } from "../lib/sealedMessageFheV52Abi";
import { PendingWithdrawalsPanel } from "./PendingWithdrawalsPanel";
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

/** Normalize V5.1 summary struct to V5-compatible shape */
function normalizeSummary(summary: any): SecureMessageRow["summary"] {
  // V5.1 has `condition` (enum) instead of conditionMode/hasTimeCondition/hasPaymentCondition
  // and `paid` bool in summary (V5 has it in access as paidAmount)
  if (summary.condition !== undefined) {
    const condition = Number(summary.condition);
    return {
      sender: summary.sender,
      receiver: summary.receiver,
      createdAt: summary.createdAt,
      unlockTime: summary.unlockTime,
      conditionMode: condition,
      hasTimeCondition: condition === 0 || condition === 2 || condition === 3,
      hasPaymentCondition: condition === 1 || condition === 2 || condition === 3,
      payloadCid: summary.payloadCid,
      metadataCid: summary.metadataCid,
      previewCid: summary.previewCid,
      previewText: summary.previewText,
      payloadHash: summary.payloadHash,
      metadataHash: summary.metadataHash,
      revoked: summary.revoked,
      unlocked: summary.unlocked,
    };
  }
  return summary as SecureMessageRow["summary"];
}

/** Normalize V5.1 access struct to V5-compatible shape */
function normalizeAccess(access: any): SecureMessageRow["access"] {
  // V5.1 has `condition` (enum) and `paid` (bool) instead of paidAmount/isPaymentMet
  if (access.condition !== undefined) {
    return {
      requiredPayment: access.requiredPayment,
      paidAmount: access.paid ? access.requiredPayment : 0n,
      isPaymentMet: !!access.paid,
      isTimeMet: !!access.isTimeMet,
      isReadyToUnlock: !!access.isReadyToUnlock,
      isUnlocked: !!access.isUnlocked,
      isRevoked: !!access.isRevoked,
    };
  }
  return access as SecureMessageRow["access"];
}

export function SecureFHEMessageList({ refreshKey }: Props) {
  const client = usePublicClient();
  const contractAddress = useContractAddress();
  const versionKey = useContractVersion();
  const { address: userAddress, isConnected } = useAccount();
  const [items, setItems] = useState<SecureMessageRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isV52 = versionKey === "v5.2-fhe";
  const isV51 = versionKey === "v5.1-fhe";
  const abi = isV52 ? sealedMessageFheV52Abi : isV51 ? sealedMessageFheV51Abi : sealedMessageFheSecureAbi;

  const fetchMessages = useCallback(async () => {
    if (!client || !contractAddress || !userAddress) {
      setItems([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [sentIds, receivedIds] = await Promise.all([
        client.readContract({ address: contractAddress, abi, functionName: "getSentMessages", args: [userAddress] }) as Promise<bigint[]>,
        client.readContract({ address: contractAddress, abi, functionName: "getReceivedMessages", args: [userAddress] }) as Promise<bigint[]>,
      ]);

      const ids = [...new Set([...sentIds, ...receivedIds])].sort((left, right) => Number(right - left));
      const rows = await Promise.all(ids.map(async (id) => {
        const [rawSummary, rawAccess] = await Promise.all([
          client.readContract({ address: contractAddress, abi, functionName: "getMessageSummary", args: [id] }) as Promise<any>,
          client.readContract({ address: contractAddress, abi, functionName: "getMessageAccess", args: [id] }) as Promise<any>,
        ]);
        const summary = normalizeSummary(rawSummary);
        const access = normalizeAccess(rawAccess);
        return { id, summary, access };
      }));

      setItems(rows);
    } catch (fetchError) {
      console.error("secure list fetch failed", fetchError);
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load secure messages");
    } finally {
      setLoading(false);
    }
  }, [client, contractAddress, userAddress, abi]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages, refreshKey]);

  if (!isConnected) {
    return <div className="mx-auto w-full max-w-2xl rounded-xl border border-gray-700 bg-gray-900/60 p-6 text-center text-sm text-gray-400">Connect your wallet to inspect secure FHE messages.</div>;
  }

  const content = (() => {
    if (loading && items.length === 0) {
      return <div className="rounded-xl border border-gray-700 bg-gray-900/60 p-6 text-center text-sm text-gray-400">Loading secure FHE messages...</div>;
    }

    if (error) {
      return <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-6 text-sm text-red-200">{error}</div>;
    }

    if (items.length === 0) {
      return <div className="rounded-xl border border-gray-700 bg-gray-900/60 p-6 text-center text-sm text-gray-400">No secure FHE messages yet.</div>;
    }

    return items.map((item) => (
      <SecureFHEMessageCard key={item.id.toString()} id={item.id} summary={item.summary} access={item.access} onChanged={fetchMessages} />
    ));
  })();

  return (
    <div className="mx-auto w-full max-w-2xl space-y-3">
      <PendingWithdrawalsPanel onWithdrawSuccess={fetchMessages} />
      {content}
    </div>
  );
}
