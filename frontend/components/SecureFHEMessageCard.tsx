"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { ethers } from "ethers";
import { formatEther } from "viem";
import { useAccount } from "../lib/wagmiCompat";
import { useContractAddress, useContractVersion } from "../lib/useContractAddress";
import { sealedMessageFheSecureAbi } from "../lib/sealedMessageFheSecureAbi";
import { sealedMessageFheV51Abi } from "../lib/sealedMessageFheV51Abi";
import { combineMessageKey, decryptBytesEnvelope, decryptJsonEnvelope, type EncryptedEnvelope } from "../lib/securePayload";
import { decryptKeyPartsForUser } from "../lib/fheSecure";
import { getFileTypeLabel, formatSizeShort } from "../lib/preview";
import type { PublicPreviewData } from "../lib/preview";

dayjs.extend(relativeTime);

type SecureMessageSummary = {
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

type SecureMessageAccess = {
  requiredPayment: bigint;
  paidAmount: bigint;
  isPaymentMet: boolean;
  isTimeMet: boolean;
  isReadyToUnlock: boolean;
  isUnlocked: boolean;
  isRevoked: boolean;
};

type Props = {
  id: bigint;
  summary: SecureMessageSummary;
  access: SecureMessageAccess;
  onChanged?: () => void;
};

type DecryptedPayload = {
  version: number;
  message: string | null;
  attachmentEnvelopeCid: string | null;
};

type DecryptedMetadata = {
  version: number;
  createdAt: string;
  hasAttachment: boolean;
  attachment: {
    name: string;
    size: number;
    mimeType: string;
  } | null;
};

// v3: cache key is scoped by contract + receiver to avoid cross-message leaks.
const STORAGE_PREFIX = "sealed-decrypted-v3-";

/** Convert Uint8Array to base64 string for localStorage */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Convert base64 string back to a Blob URL */
function base64ToBlobUrl(base64: string, mimeType: string): string {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

export function SecureFHEMessageCard({ id, summary, access, onChanged }: Props) {
  const { address: userAddress } = useAccount();
  const contractAddress = useContractAddress();
  const versionKey = useContractVersion();
  const isV51 = versionKey === "v5.1-fhe";
  const abi = isV51 ? sealedMessageFheV51Abi : sealedMessageFheSecureAbi;
  const versionBadge = isV51 ? "V5.1-FHE" : "V5-FHE";
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null);
  const [attachmentType, setAttachmentType] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<PublicPreviewData | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const [decryptedAttachmentMeta, setDecryptedAttachmentMeta] = useState<{ name: string; size: number } | null>(null);
  const isReceiver = userAddress?.toLowerCase() === summary.receiver.toLowerCase();
  const isSender = userAddress?.toLowerCase() === summary.sender.toLowerCase();
  const normalizedContractAddress = contractAddress?.toLowerCase() ?? "unknown-contract";
  const normalizedUserAddress = userAddress?.toLowerCase() ?? "anonymous";
  const storageKey = `${STORAGE_PREFIX}${normalizedContractAddress}:${normalizedUserAddress}:${id.toString()}`;

  // ── Restore cached decrypted content from localStorage (starts collapsed) ─
  useEffect(() => {
    setContent(null);
    setAttachmentUrl(null);
    setAttachmentType(null);
    setDecryptedAttachmentMeta(null);

    if (!isReceiver || !access.isUnlocked || access.isRevoked) {
      return;
    }

    try {
      const cached = localStorage.getItem(storageKey);
      if (cached) {
        const parsed = JSON.parse(cached) as {
          content: string;
          attachmentData: string | null;
          attachmentType: string | null;
          attachmentName?: string;
          attachmentSize?: number;
        };
        setContent(parsed.content);
        if (parsed.attachmentData && parsed.attachmentType) {
          // Reconstruct blob URL from base64 (blob: URLs die on page reload)
          const newUrl = base64ToBlobUrl(parsed.attachmentData, parsed.attachmentType);
          setImageLoading(true);
          setAttachmentUrl(newUrl);
          setAttachmentType(parsed.attachmentType);
          if (parsed.attachmentName || parsed.attachmentSize) {
            setDecryptedAttachmentMeta({
              name: parsed.attachmentName ?? "file",
              size: parsed.attachmentSize ?? 0,
            });
          }
        }
        // Always start collapsed for cache-restored messages
        setIsCollapsed(true);
      }
    } catch { /* ignore corrupt cache */ }
  }, [access.isRevoked, access.isUnlocked, isReceiver, storageKey]);

  // ── Fetch public preview data from IPFS ─────────────────────────────
  useEffect(() => {
    if (!summary.previewCid) return;
    let cancelled = false;
    fetch(`/api/ipfs/${summary.previewCid}`, { cache: "force-cache" })
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((data: PublicPreviewData) => {
        if (!cancelled) setPreviewData(data);
      })
      .catch(() => { /* preview is optional */ });
    return () => { cancelled = true; };
  }, [summary.previewCid]);

  // ── Fetch thumbnail from IPFS ───────────────────────────────────────
  useEffect(() => {
    if (!previewData?.thumbnailCid) return;
    let cancelled = false;
    fetch(`/api/ipfs/${previewData.thumbnailCid}`, { cache: "force-cache" })
      .then((r) => { if (!r.ok) throw new Error(); return r.blob(); })
      .then((blob) => {
        if (!cancelled) setThumbnailUrl(URL.createObjectURL(blob));
      })
      .catch(() => { /* thumbnail is optional */ });
    return () => { cancelled = true; };
  }, [previewData?.thumbnailCid]);

  // ── Save to localStorage after decrypt (base64 for cross-session survival) ─
  const saveToCache = useCallback((c: string, bytes: Uint8Array | null, aType: string | null, aMeta?: { name: string; size: number } | null) => {
    try {
      const payload: { content: string; attachmentData?: string; attachmentType?: string; attachmentName?: string; attachmentSize?: number } = { content: c };
      // Only cache attachments up to ~3MB (localStorage limit is ~5MB, base64 adds 33%)
      if (bytes && bytes.byteLength < 3_000_000) {
        payload.attachmentData = uint8ArrayToBase64(bytes);
        payload.attachmentType = aType ?? "application/octet-stream";
        if (aMeta) {
          payload.attachmentName = aMeta.name;
          payload.attachmentSize = aMeta.size;
        }
      }
      localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch { /* storage full — ignore */ }
  }, [storageKey]);

  const effectiveRequiredPayment = summary.hasPaymentCondition ? access.requiredPayment : 0n;
  const effectivePaidAmount = summary.hasPaymentCondition ? access.paidAmount : 0n;
  const paymentRemaining = effectiveRequiredPayment > effectivePaidAmount ? effectiveRequiredPayment - effectivePaidAmount : 0n;
  const canUnlock = !access.isUnlocked && !access.isRevoked && access.isReadyToUnlock;
  const canDecrypt = isReceiver && access.isUnlocked && !access.isRevoked;
  const alreadyDecrypted = content !== null;
  const logicLabel = isV51
    ? (summary.conditionMode === 0 ? "Time"
      : summary.conditionMode === 1 ? "Payment"
      : "Time + Payment")
    : summary.hasTimeCondition && summary.hasPaymentCondition
      ? (summary.conditionMode === 1 ? "Time OR payment" : "Time AND payment")
      : summary.hasTimeCondition
        ? "Time"
        : "Payment";

  const callContract = useCallback(async (method: "unlockMessage" | "payToUnlock" | "revokeMessage", value?: bigint) => {
    if (!contractAddress) return;

    if (method === "payToUnlock" && !summary.hasPaymentCondition) {
      setError("This message does not have a payment unlock condition.");
      return;
    }

    setIsWorking(true);
    setError(null);

    try {
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(contractAddress, abi, signer);

      if (method === "payToUnlock") {
        if (value === undefined || value <= 0n) {
          throw new Error("This message is not requesting a valid payment amount.");
        }

        const signerAddress = await signer.getAddress();
        const balance = await provider.getBalance(signerAddress);
        if (balance < value) {
          throw new Error(
            `Insufficient Sepolia ETH. Need ${formatEther(value)} ETH for payment, but wallet only has ${formatEther(balance)} ETH. Gas is extra.`
          );
        }
      }

      if (method === "unlockMessage" && !access.isReadyToUnlock) {
        const reasons: string[] = [];
        if (summary.hasPaymentCondition && !access.isPaymentMet) {
          reasons.push(`payment of ${formatEther(effectiveRequiredPayment)} ETH is still required`);
        }
        if (summary.hasTimeCondition && !access.isTimeMet) {
          reasons.push("unlock time has not been reached yet");
        }
        throw new Error(
          reasons.length > 0
            ? `Message cannot be unlocked yet: ${reasons.join(" and ")}.`
            : "Message cannot be unlocked yet."
        );
      }

      const tx = value !== undefined ? await contract[method](id, { value }) : await contract[method](id);
      await tx.wait();
      onChanged?.();
    } catch (contractError) {
      console.error(method, contractError);
      const message = contractError instanceof Error ? contractError.message : `${method} failed`;
      if (message.includes("ACTION_REJECTED") || message.includes("user rejected action")) {
        setError("Transaction was cancelled in the wallet.");
      } else if (message.includes("insufficient funds")) {
        setError("Wallet balance is not enough for this transaction. Payment amount and gas are both required.");
      } else if (message.includes("No payment")) {
        setError("This transaction did not include the required ETH payment.");
      } else {
        setError(message);
      }
    } finally {
      setIsWorking(false);
    }
  }, [
    access.isPaymentMet,
    access.isReadyToUnlock,
    access.isTimeMet,
    abi,
    contractAddress,
    effectiveRequiredPayment,
    id,
    onChanged,
    summary.hasPaymentCondition,
    summary.hasTimeCondition,
  ]);

  const handleDecrypt = useCallback(async () => {
    if (!canDecrypt || !contractAddress || !userAddress) return;
    setIsWorking(true);
    setError(null);

    try {
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(contractAddress, abi, signer);
      const handles = await contract.getKeyHandles(id) as [`0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`];
      const parts = await decryptKeyPartsForUser({
        contractAddress,
        signer,
        userAddress,
        handles,
      });
      const messageKey = combineMessageKey(parts);

      const [payloadResponse, metadataResponse] = await Promise.all([
        fetch(`/api/ipfs/${summary.payloadCid}`, { cache: "no-store" }),
        fetch(`/api/ipfs/${summary.metadataCid}`, { cache: "no-store" }),
      ]);

      const payloadEnvelope = await payloadResponse.json() as EncryptedEnvelope;
      const metadataEnvelope = await metadataResponse.json() as EncryptedEnvelope;
      const payload = await decryptJsonEnvelope<DecryptedPayload>(payloadEnvelope, messageKey);
      const metadata = await decryptJsonEnvelope<DecryptedMetadata>(metadataEnvelope, messageKey);
      const msg = payload.message ?? "";
      setContent(msg);

      let aUrl: string | null = null;
      let aBytes: Uint8Array | null = null;
      let aType: string | null = null;
      if (payload.attachmentEnvelopeCid) {
        const attachmentResponse = await fetch(`/api/ipfs/${payload.attachmentEnvelopeCid}`, { cache: "no-store" });
        const attachmentEnvelope = await attachmentResponse.json() as EncryptedEnvelope;
        const attachmentBytes = await decryptBytesEnvelope(attachmentEnvelope, messageKey);
        const mimeType = metadata.attachment?.mimeType || "application/octet-stream";
        aUrl = URL.createObjectURL(new Blob([attachmentBytes], { type: mimeType }));
        aBytes = attachmentBytes;
        aType = mimeType;
        setImageLoading(true);
        setAttachmentUrl(aUrl);
        setAttachmentType(aType);
        if (metadata.attachment) setDecryptedAttachmentMeta(metadata.attachment);
      }

      saveToCache(msg, aBytes, aType, metadata.attachment);
    } catch (decryptError) {
      console.error("secure decrypt failed", decryptError);
      setError(decryptError instanceof Error ? decryptError.message : "Decrypt failed");
    } finally {
      setIsWorking(false);
    }
  }, [canDecrypt, contractAddress, id, saveToCache, summary.metadataCid, summary.payloadCid, userAddress, abi]);

  const statusLabel = useMemo(() => {
    if (access.isRevoked) return "Revoked";
    if (access.isUnlocked) return "Unlocked";
    return "Locked";
  }, [access.isRevoked, access.isUnlocked]);

  // ── Time remaining display ─────────────────────────────────────────
  const timeRemainingStr = useMemo(() => {
    if (!summary.hasTimeCondition || summary.unlockTime <= 0n) return null;
    const now = Math.floor(Date.now() / 1000);
    const unlockSec = Number(summary.unlockTime);
    if (now >= unlockSec) return null; // already met
    const diff = unlockSec - now;
    if (diff < 60) return `${diff} seconds`;
    if (diff < 3600) return `${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hr ${Math.floor((diff % 3600) / 60)} min`;
    return `${Math.floor(diff / 86400)}d ${Math.floor((diff % 86400) / 3600)}h`;
  }, [summary.hasTimeCondition, summary.unlockTime]);

  // ── Build rich preview element from contract + IPFS data ────────────
  const previewElement = useMemo(() => {
    const text = summary.previewText;
    if (!text) return null;

    const pd = previewData;
    let icon = "💬";
    let typeLabel = "Text message";

    if (pd) {
      if (pd.type === "text+image") {
        icon = "🖼️";
        typeLabel = "Message with image";
      } else if (pd.type === "text+file") {
        icon = "📎";
        typeLabel = "Message with file";
      }
    } else {
      // Determine from previewText format
      if (text.includes("+") && text.includes("(")) {
        icon = "📎";
        typeLabel = "Message with attachment";
      }
    }

    return (
      <div className="mt-2 rounded border border-emerald-700/30 bg-emerald-950/15 p-2.5">
        {/* Row 1: type icon + type label + character count */}
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-base">{icon}</span>
          <span className="text-xs font-medium text-emerald-200">{typeLabel}</span>
          {pd?.messageLength !== undefined && (
            <span className="text-xs text-gray-400">{pd.messageLength} chars</span>
          )}
        </div>

        {/* Row 2: preview text */}
        <div className="text-xs italic text-emerald-100/80">
          &ldquo;{text}&rdquo;
        </div>

        {/* Row 3: file info (when available) */}
        {(pd?.fileInfo || (pd && pd.type !== "text")) && pd?.fileInfo && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
            {/* Thumbnail row */}
            {(pd.type === "text+image" && thumbnailUrl) && (
              <div className="flex-shrink-0">
                <img
                  src={thumbnailUrl}
                  alt="thumb"
                  className="h-10 w-10 rounded border border-gray-600 object-cover"
                />
              </div>
            )}
            {/* File icon + name + size + type */}
            <span className="flex items-center gap-1">
              <span>{getFileTypeLabel(pd.fileInfo.mimeType, pd.fileInfo.name)}</span>
              <span className="max-w-[140px] truncate font-mono">{pd.fileInfo.name}</span>
              <span>({formatSizeShort(pd.fileInfo.size)})</span>
            </span>
          </div>
        )}
      </div>
    );
  }, [summary.previewText, previewData, thumbnailUrl]);

  // ── Toggle collapse/expand (JS-only, no contract call) ──────────────
  const toggleCollapse = useCallback(() => {
    setIsCollapsed((prev) => !prev);
  }, []);

  return (
    <div className="rounded-xl border border-emerald-500/20 bg-gray-900/70 p-4">
      {/* ── Header row (always visible) ─────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="rounded bg-emerald-600/20 px-2 py-0.5 text-xs text-emerald-300">{versionBadge}</span>
          <span className="text-sm text-white">#{id.toString()}</span>
          {alreadyDecrypted && (
            <span className="text-xs text-purple-400">🔓 Decrypted</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">{statusLabel}</span>
          <button
            onClick={toggleCollapse}
            className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white"
            title={isCollapsed ? "Expand" : "Collapse"}
          >
            {isCollapsed ? "▶" : "▼"}
          </button>
        </div>
      </div>

      {/* ── Summary + preview (always visible) ──────────────────────── */}
      <div className="mt-2 space-y-1 text-sm text-gray-300">
        <div>From: <span className="font-mono text-xs">{summary.sender}</span></div>
        <div>To: <span className="font-mono text-xs">{summary.receiver}</span></div>
        <div>Created: {dayjs(Number(summary.createdAt) * 1000).fromNow()}</div>
        {summary.hasTimeCondition && summary.unlockTime > 0n && (
          <div>Unlock time: {new Date(Number(summary.unlockTime) * 1000).toLocaleString()}</div>
        )}
        <div>Unlock logic: {logicLabel}</div>
        {summary.hasPaymentCondition && (
          <div>Payment: {formatEther(effectivePaidAmount)} / {formatEther(effectiveRequiredPayment)} ETH</div>
        )}
        {/* Show pending conditions for locked messages */}
        {!access.isUnlocked && !access.isRevoked && (
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
            {timeRemainingStr && (
              <span className="text-yellow-300">⏳ {timeRemainingStr} remaining</span>
            )}
            {summary.hasPaymentCondition && paymentRemaining > 0n && (
              <span className="text-yellow-300">💰 {formatEther(paymentRemaining)} ETH needed</span>
            )}
            {!timeRemainingStr && !access.isPaymentMet && paymentRemaining <= 0n && (
              <span className="text-yellow-300">⏰ Waiting for unlock</span>
            )}
          </div>
        )}
      </div>

      {/* ── Rich public preview ──────────────────────────────────────── */}
      {previewElement}

      {/* ── Collapsible content ─────────────────────────────────────── */}
      {!isCollapsed && (
        <>
          {error && (
            <div className="mt-3 rounded border border-red-500/30 bg-red-950/30 p-2 text-xs text-red-200">{error}</div>
          )}

          {/* Decrypted message content */}
          {content !== null && (
            <div className="mt-3 whitespace-pre-wrap rounded bg-gray-800/80 p-3 text-sm text-white">
              {content || "(empty message)"}
            </div>
          )}
          {attachmentUrl && (
            <div className="mt-3">
              {/* File info badge */}
              {decryptedAttachmentMeta && (
                <div className="mb-1.5 flex items-center gap-2 text-xs text-gray-400">
                  <span>{getFileTypeLabel(attachmentType ?? "", decryptedAttachmentMeta.name)}</span>
                  <span className="max-w-[200px] truncate font-mono">{decryptedAttachmentMeta.name}</span>
                  <span>({formatSizeShort(decryptedAttachmentMeta.size)})</span>
                </div>
              )}
              {attachmentType?.startsWith("image/") ? (
                <>
                  {imageLoading && (
                    <div className="flex h-48 items-center justify-center rounded-lg bg-gray-800/60">
                      <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
                    </div>
                  )}
                  <img
                    src={attachmentUrl}
                    alt="Decrypted attachment"
                    className={`max-h-64 rounded-lg object-contain ${imageLoading ? "hidden" : ""}`}
                    onLoad={() => setImageLoading(false)}
                    onError={() => setImageLoading(false)}
                  />
                </>
              ) : (
                <a href={attachmentUrl} download className="text-sm text-emerald-300 underline">
                  Download decrypted attachment
                </a>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="mt-4 flex flex-wrap gap-2">
            {summary.hasPaymentCondition && paymentRemaining > 0n && isReceiver && !access.isRevoked && (
              <button
                disabled={isWorking}
                onClick={() => callContract("payToUnlock", paymentRemaining)}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                Pay {formatEther(paymentRemaining)} ETH
              </button>
            )}
            {canUnlock && (
              <button
                disabled={isWorking}
                onClick={() => callContract("unlockMessage")}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                Release Zama FHE key
              </button>
            )}
            {canDecrypt && !alreadyDecrypted && (
              <button
                disabled={isWorking}
                onClick={handleDecrypt}
                className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                Decrypt payload
              </button>
            )}
            {alreadyDecrypted && (
              <button
                onClick={() => setIsCollapsed(true)}
                className="rounded-lg bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-600"
              >
                Close
              </button>
            )}
            {isSender && !access.isUnlocked && !access.isRevoked && (
              <button
                disabled={isWorking}
                onClick={() => callContract("revokeMessage")}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                Revoke
              </button>
            )}
          </div>
        </>
      )}

      {/* Collapsed hint */}
      {isCollapsed && alreadyDecrypted && (
        <div className="mt-2 text-xs text-gray-500 italic">
          🔓 Decrypted. <button onClick={toggleCollapse} className="text-emerald-400 underline">Click to expand</button> (no re-payment needed).
        </div>
      )}
    </div>
  );
}
