"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useAccount, usePublicClient, useNetwork } from "../lib/wagmiCompat";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { sealedMessageFheAbi } from "../lib/sealedMessageFheAbi";
import { useContractAddress } from "../lib/useContractAddress";
import { ethers } from "ethers";
import { formatEther } from "viem";

dayjs.extend(relativeTime);

interface FHEMessageCardProps {
  id: bigint;
  sender: string;
  receiver: string;
  requiredPayment?: bigint;
  paidAmount?: bigint;
  conditionMask?: number;
  isOnchainUnlocked?: boolean;
  createdAt?: bigint;
  chainId?: number;
  onMessageRead?: () => void;
}

interface DecryptedContent {
  plaintext?: string;
  metadata?: {
    message?: string;
    hasAttachment?: boolean;
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
    dimensions?: { width: number; height: number };
  };
  dataCid?: string;
  metadataCid?: string;
}

export function FHEMessageCard({
  id,
  sender,
  receiver,
  requiredPayment: propRequiredPayment,
  paidAmount: propPaidAmount,
  conditionMask: propConditionMask,
  isOnchainUnlocked: propIsOnchainUnlocked,
  createdAt,
  chainId: propsChainId,
  onMessageRead,
}: FHEMessageCardProps) {
  const { address: userAddress, isConnected } = useAccount();
  const { chain } = useNetwork();
  const contractAddress = useContractAddress();
  const activeChainId = chain?.id;
  const messageChainId = propsChainId ?? activeChainId;
  const client = usePublicClient(
    typeof messageChainId === "number" && Number.isFinite(messageChainId)
      ? { chainId: messageChainId }
      : undefined
  );

  const isSender = userAddress?.toLowerCase() === sender?.toLowerCase();
  const isReceiver = userAddress?.toLowerCase() === receiver?.toLowerCase();
  const canDecrypt = isSender || isReceiver;

  // On-chain state
  const [conditionMask, setConditionMask] = useState<number>(propConditionMask ?? 0);
  const [requiredPayment, setRequiredPayment] = useState<bigint>(propRequiredPayment ?? 0n);
  const [paidAmount, setPaidAmount] = useState<bigint>(propPaidAmount ?? 0n);
  const [onchainUnlocked, setOnchainUnlocked] = useState<boolean>(propIsOnchainUnlocked ?? false);
  const [metadataLoaded, setMetadataLoaded] = useState(false);
  const [isUnlockingPayment, setIsUnlockingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);
  const [isCheckingTime, setIsCheckingTime] = useState(false);
  const [timeCheckError, setTimeCheckError] = useState<string | null>(null);

  // Plaintext CIDs from contract (getMessageParties)
  const [dataCid, setDataCid] = useState<string | null>(null);
  const [metadataCid, setMetadataCid] = useState<string | null>(null);

  // Decrypted content state
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [decryptError, setDecryptError] = useState<string | null>(null);
  const [decryptedContent, setDecryptedContent] = useState<DecryptedContent | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [hasFetchedContent, setHasFetchedContent] = useState(false);

  // Fetch on-chain state + plaintext CIDs
  const fetchOnchainState = useCallback(async () => {
    if (!client || !contractAddress || !userAddress) return;

    try {
      const [finView, parties] = await Promise.all([
        client.readContract({
          address: contractAddress,
          abi: sealedMessageFheAbi,
          functionName: "getMessageFinancialView",
          args: [id],
          account: userAddress,
        }) as Promise<any>,
        client.readContract({
          address: contractAddress,
          abi: sealedMessageFheAbi,
          functionName: "getMessageParties",
          args: [id],
          account: userAddress,
        }) as Promise<any>,
      ]);

      // Financial view — contract now returns isUnlocked
      const finData = finView.viewData || finView;
      setConditionMask(Number(finData.conditionMask ?? 0));
      setRequiredPayment(BigInt(finData.requiredPayment ?? 0));
      setPaidAmount(BigInt(finData.paidAmount ?? 0));
      setOnchainUnlocked(Boolean(finData.isUnlocked ?? false));

      // Parties — now returns (sender, receiver, exists, dataCid, metadataCid)
      const partiesData = parties.viewData || parties;
      if (Array.isArray(partiesData) && partiesData.length >= 5) {
        setDataCid(partiesData[3] as string);
        setMetadataCid(partiesData[4] as string);
      } else if (partiesData?.dataCid) {
        setDataCid(partiesData.dataCid);
        setMetadataCid(partiesData.metadataCid);
      }

      setMetadataLoaded(true);
    } catch (err) {
      console.warn("⚠️ Failed to fetch FHE message state:", err);
    }
  }, [client, contractAddress, id, userAddress]);

  useEffect(() => {
    fetchOnchainState();
  }, [fetchOnchainState]);

  // Poll unlock status
  useEffect(() => {
    if (onchainUnlocked || isSender) return;
    const interval = setInterval(fetchOnchainState, 15000);
    return () => clearInterval(interval);
  }, [fetchOnchainState, onchainUnlocked, isSender]);

  // Determine if message is accessible
  const isAccessible = useMemo(() => {
    if (isSender) return true;
    if (onchainUnlocked) return true;
    const hasTimeCondition = (conditionMask & 0x01) !== 0;
    const hasPaymentCondition = (conditionMask & 0x02) !== 0;
    if (!hasTimeCondition && !hasPaymentCondition) return true;
    if (hasTimeCondition && !hasPaymentCondition) return onchainUnlocked;
    if (!hasTimeCondition && hasPaymentCondition) return paidAmount >= requiredPayment;
    return onchainUnlocked;
  }, [isSender, onchainUnlocked, conditionMask, paidAmount, requiredPayment]);

  const needsPayment = useMemo(() => {
    if (isSender) return false;
    if (onchainUnlocked) return false;
    return (conditionMask & 0x02) !== 0 && paidAmount < requiredPayment;
  }, [isSender, onchainUnlocked, conditionMask, paidAmount, requiredPayment]);

  // Fetch content directly via plaintext CIDs (no FHE decryption needed for CIDs!)
  const handleDecrypt = useCallback(async () => {
    if (!canDecrypt || hasFetchedContent) return;
    if (!dataCid && !metadataCid) {
      setDecryptError("No IPFS CIDs available — fetch on-chain state first");
      return;
    }

    setIsDecrypting(true);
    setDecryptError(null);

    try {
      let metadata: any = null;
      let plaintext = "";

      // Fetch metadata from IPFS
      if (metadataCid) {
        try {
          const resp = await fetch(`/api/ipfs/${metadataCid}`);
          if (resp.ok) {
            metadata = await resp.json();
          }
        } catch (err) {
          console.warn("⚠️ Failed to fetch metadata from IPFS:", err);
        }
      }

      // Extract content
      if (metadata) {
        plaintext = metadata.message || metadata.content || "";
        setDecryptedContent({
          dataCid: dataCid ?? undefined,
          metadataCid: metadataCid ?? undefined,
          plaintext,
          metadata: {
            message: metadata.message || metadata.content,
            hasAttachment: metadata.hasAttachment || metadata.type === "file",
            fileName: metadata.attachment?.fileName || metadata.fileName,
            fileSize: metadata.attachment?.fileSize || metadata.fileSize,
            mimeType: metadata.attachment?.mimeType || metadata.mimeType,
            dimensions: metadata.attachment?.dimensions || metadata.dimensions,
          },
        });
      } else if (dataCid) {
        // Try fetching data directly
        try {
          const resp = await fetch(`/api/ipfs/${dataCid}`);
          if (resp.ok) {
            plaintext = await resp.text();
          }
        } catch {}
        setDecryptedContent({
          dataCid,
          metadataCid,
          plaintext: plaintext || dataCid,
        });
      }

      setHasFetchedContent(true);
      setIsExpanded(true);
      onMessageRead?.();
    } catch (err: any) {
      console.error("❌ Content fetch failed:", err);
      setDecryptError(err?.message || "Failed to fetch content");
    } finally {
      setIsDecrypting(false);
    }
  }, [canDecrypt, hasFetchedContent, dataCid, metadataCid, onMessageRead]);

  // Pay to unlock
  const handlePay = useCallback(async () => {
    if (!contractAddress || !userAddress) return;
    setIsUnlockingPayment(true);
    setPaymentError(null);

    try {
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(contractAddress, sealedMessageFheAbi, signer);

      const tx = await contract.payToUnlock(id, {
        value: requiredPayment - paidAmount,
      });
      await tx.wait();

      setOnchainUnlocked(true);
      await fetchOnchainState();
    } catch (err: any) {
      console.error("❌ Payment failed:", err);
      setPaymentError(err?.reason || err?.message || "Payment failed");
    } finally {
      setIsUnlockingPayment(false);
    }
  }, [contractAddress, userAddress, id, requiredPayment, paidAmount, fetchOnchainState]);

  // Revoke
  const handleRevoke = useCallback(async () => {
    if (!contractAddress || !userAddress || !isSender) return;
    setIsRevoking(true);

    try {
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(contractAddress, sealedMessageFheAbi, signer);
      const tx = await contract.revokeMessage(id);
      await tx.wait();
      await fetchOnchainState();
    } catch (err: any) {
      console.error("❌ Revoke failed:", err);
    } finally {
      setIsRevoking(false);
    }
  }, [contractAddress, userAddress, id, isSender, fetchOnchainState]);

  // Check time condition — calls on-chain oracle to decrypt FHE unlock time
  const handleCheckTime = useCallback(async () => {
    if (!contractAddress || !userAddress) return;
    setIsCheckingTime(true);
    setTimeCheckError(null);

    try {
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(contractAddress, sealedMessageFheAbi, signer);
      const tx = await contract.checkTimeCondition(id);
      await tx.wait();
      await fetchOnchainState();
    } catch (err: any) {
      console.error("❌ checkTimeCondition failed:", err);
      setTimeCheckError(err?.reason || err?.message || "Time check failed");
    } finally {
      setIsCheckingTime(false);
    }
  }, [contractAddress, userAddress, id, fetchOnchainState]);

  // Condition label
  const conditionLabel = useMemo(() => {
    const parts: string[] = [];
    if (conditionMask & 0x01) parts.push("⏰ Time-locked");
    if (conditionMask & 0x02) parts.push("💰 Payment required");
    if (!parts.length) return "🔓 No conditions";
    return parts.join(" + ");
  }, [conditionMask]);

  const timeLocked = (conditionMask & 0x01) !== 0;
  const paymentCondition = (conditionMask & 0x02) !== 0;

  // Helpers
  const shortenAddress = (addr: string) =>
    addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "???";

  return (
    <div className={`rounded-xl border transition-all ${isAccessible ? "border-green-500/30" : "border-yellow-500/30"} bg-gray-800/60 p-4 backdrop-blur-sm`}>
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{isAccessible ? "🔓" : "🔐"}</span>
          <span className="rounded bg-purple-600/20 px-2 py-0.5 text-xs text-purple-300">V4-FHE</span>
          <span className={`rounded px-2 py-0.5 text-xs ${isAccessible ? "bg-green-600/20 text-green-300" : "bg-yellow-600/20 text-yellow-300"}`}>
            {isAccessible ? "Accessible" : "Locked"}
          </span>
        </div>
        <span className="text-xs text-gray-500">#{id.toString()}</span>
      </div>

      {/* Sender / Receiver */}
      <div className="mb-2 space-y-1 text-xs text-gray-400">
        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-gray-500">From:</span>
          <span className="font-mono">{shortenAddress(sender)}</span>
          {isSender && <span className="text-blue-400">(you)</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-gray-500">To:</span>
          <span className="font-mono">{shortenAddress(receiver)}</span>
          {isReceiver && <span className="text-blue-400">(you)</span>}
        </div>
        {createdAt && (
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-gray-500">At:</span>
            <span>{dayjs(Number(createdAt) * 1000).fromNow()}</span>
          </div>
        )}
      </div>

      {/* Conditions */}
      <div className="mb-3 rounded-lg bg-gray-900/50 p-2 text-xs">
        <div className="text-gray-400">{conditionLabel}</div>
        {timeLocked && (
          <div className="text-gray-500">⏰ Time condition active</div>
        )}
        {paymentCondition && requiredPayment > 0n && (
          <div className="flex items-center gap-2 text-gray-400">
            <span>💰 {formatEther(requiredPayment)} ZAMA required</span>
            {paidAmount > 0n && <span className="text-green-400">({formatEther(paidAmount)} paid)</span>}
          </div>
        )}
      </div>

      {/* Errors */}
      {decryptError && (
        <div className="mb-3 rounded-lg bg-red-900/40 p-2 text-xs text-red-300">{decryptError}</div>
      )}
      {paymentError && (
        <div className="mb-3 rounded-lg bg-red-900/40 p-2 text-xs text-red-300">{paymentError}</div>
      )}
      {timeCheckError && (
        <div className="mb-3 rounded-lg bg-yellow-900/40 p-2 text-xs text-yellow-300">{timeCheckError}</div>
      )}

      {/* Content (fetched via plaintext CIDs — no FHE decryption needed) */}
      {isExpanded && decryptedContent && (
        <div className="mb-3 rounded-lg bg-gray-900/50 p-3">
          {decryptedContent.metadata?.hasAttachment ? (
            <div>
              {decryptedContent.metadata?.mimeType?.startsWith("image/") ? (
                <div className="mb-2">
                  {decryptedContent.dataCid && (
                    <img
                      src={`/api/ipfs/${decryptedContent.dataCid}`}
                      alt="Attachment"
                      className="max-h-64 rounded-lg object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = `https://ipfs.io/ipfs/${decryptedContent.dataCid}`;
                      }}
                    />
                  )}
                </div>
              ) : (
                decryptedContent.dataCid && (
                  <div className="mb-2">
                    <a
                      href={`/api/ipfs/${decryptedContent.dataCid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 underline hover:text-blue-300"
                    >
                      📎 {decryptedContent.metadata?.fileName || "Download attachment"}
                    </a>
                    {decryptedContent.metadata?.fileSize && (
                      <span className="ml-2 text-gray-500">
                        ({(decryptedContent.metadata.fileSize / 1024).toFixed(1)} KB)
                      </span>
                    )}
                  </div>
                )
              )}
            </div>
          ) : null}

          {/* Text content */}
          {decryptedContent.plaintext && (
            <div className="whitespace-pre-wrap break-words text-sm text-gray-200">
              {decryptedContent.plaintext}
            </div>
          )}

          {/* Show CID info */}
          <div className="mt-2 text-[10px] text-gray-600">
            {decryptedContent.dataCid && <div>📦 data: {decryptedContent.dataCid}</div>}
            {decryptedContent.metadataCid && <div>🏷️ meta: {decryptedContent.metadataCid}</div>}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        {/* Decrypt / Show content */}
        {canDecrypt && !isExpanded && (
          <button
            onClick={handleDecrypt}
            disabled={isDecrypting}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isDecrypting ? "⏳ Loading..." : !dataCid ? "⏳ Fetching CIDs..." : "🔓 Decrypt & Show"}
          </button>
        )}

        {/* Pay to unlock */}
        {needsPayment && (
          <button
            onClick={handlePay}
            disabled={isUnlockingPayment}
            className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {isUnlockingPayment ? "⏳ Processing..." : `💰 Pay ${formatEther(requiredPayment - paidAmount)} ZAMA`}
          </button>
        )}

        {/* Check time condition — only show if time-locked and not yet unlocked */}
        {timeLocked && !onchainUnlocked && canDecrypt && (
          <button
            onClick={handleCheckTime}
            disabled={isCheckingTime}
            className="rounded-lg bg-yellow-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-yellow-700 disabled:opacity-50"
          >
            {isCheckingTime ? "⏳ Checking..." : "⏰ Check Time Condition"}
          </button>
        )}

        {/* Revoke */}
        {isSender && (
          <button
            onClick={handleRevoke}
            disabled={isRevoking}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {isRevoking ? "⏳ Revoking..." : "🗑️ Revoke"}
          </button>
        )}

        {/* Collapse */}
        {isExpanded && (
          <button
            onClick={() => setIsExpanded(false)}
            className="rounded-lg bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-600"
          >
            ▲ Hide
          </button>
        )}
      </div>
    </div>
  );
}
