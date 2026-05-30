"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { ethers } from "ethers";
import { isAddress } from "viem";
import { useAccount, useNetwork } from "../lib/wagmiCompat";
import { useContractAddress } from "../lib/useContractAddress";
import { sealedMessageFheSecureAbi } from "../lib/sealedMessageFheSecureAbi";
import { sealedMessageFheV51Abi } from "../lib/sealedMessageFheV51Abi";
import { pinFileToIpfs } from "../lib/ipfsClient";
import { combineMessageKey, computeKeccakFromString, encryptBytesEnvelope, encryptJsonEnvelope, generateMessageKey, splitMessageKey } from "../lib/securePayload";
import { encryptKeyPartsForContract } from "../lib/fheSecure";
import {
  generatePreviewText,
  generateThumbnailBlob,
  getPreviewType,
} from "../lib/preview";
import type { PublicPreviewData } from "../lib/preview";

type Props = {
  onSubmitted?: () => void;
  versionKey?: string;
};

type AttachmentMeta = {
  name: string;
  size: number;
  mimeType: string;
};

type UnlockConditionValue = 0 | 1 | 2;
const UNLOCK_CONDITIONS: { value: UnlockConditionValue; label: string; desc: string }[] = [
  { value: 0, label: "Time Only", desc: "Release after a specific time" },
  { value: 1, label: "Payment Only", desc: "Release after payment" },
  { value: 2, label: "Time + Payment", desc: "Both time and payment must pass" },
];

const TIME_PRESETS = [
  { label: "1 min", seconds: 60 },
  { label: "5 min", seconds: 5 * 60 },
  { label: "10 min", seconds: 10 * 60 },
  { label: "1 hour", seconds: 60 * 60 },
  { label: "1 day", seconds: 24 * 60 * 60 },
] as const;

function toDateTimeLocalValue(timestampMs: number): string {
  const date = new Date(timestampMs);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export function SecureFHEMessageForm({ onSubmitted, versionKey }: Props) {
  const { address: userAddress, isConnected } = useAccount();
  const { chain } = useNetwork();
  const contractAddress = useContractAddress();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nativeDecimals = chain?.nativeCurrency?.decimals ?? 18;
  const nativeSymbol = chain?.nativeCurrency?.symbol ?? "ETH";

  const [receiver, setReceiver] = useState("");
  const [content, setContent] = useState("");
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [timeEnabled, setTimeEnabled] = useState(true);
  const [timeMode, setTimeMode] = useState<"preset" | "custom">("preset");
  const [presetSeconds, setPresetSeconds] = useState<number>(60);
  const [unlockAt, setUnlockAt] = useState(() => toDateTimeLocalValue(Date.now() + 60_000));
  const [paymentEnabled, setPaymentEnabled] = useState(false);
  const [paymentInput, setPaymentInput] = useState("");
  const [unlockCondition, setUnlockCondition] = useState<UnlockConditionValue>(
    timeEnabled && paymentEnabled ? 2 : timeEnabled ? 0 : 1
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [typewriterDisplay, setTypewriterDisplay] = useState("");

  // ── Typewriter effect: types out statusMessage char by char ───────
  useEffect(() => {
    if (!statusMessage) { setTypewriterDisplay(""); return; }
    let i = 0;
    setTypewriterDisplay("");
    const interval = setInterval(() => {
      i++;
      setTypewriterDisplay(statusMessage.slice(0, i));
      if (i >= statusMessage.length) clearInterval(interval);
    }, 25);
    return () => clearInterval(interval);
  }, [statusMessage]);

  const parsedPayment = useMemo(() => {
    if (!paymentEnabled || !paymentInput.trim()) return 0n;
    try {
      return ethers.parseUnits(paymentInput.trim(), nativeDecimals);
    } catch {
      return -1n;
    }
  }, [nativeDecimals, paymentEnabled, paymentInput]);

  const unlockTimestamp = useMemo(() => {
    if (!timeEnabled) return 0;
    if (timeMode === "preset") {
      return Math.floor(Date.now() / 1000) + presetSeconds;
    }
    if (!unlockAt) return 0;
    const value = new Date(unlockAt).getTime();
    return Number.isFinite(value) ? Math.floor(value / 1000) : 0;
  }, [presetSeconds, timeEnabled, timeMode, unlockAt]);

  const conditionSummary = useMemo(() => {
    const cond = UNLOCK_CONDITIONS.find((c) => c.value === unlockCondition);
    if (!cond) return "No unlock condition selected";
    if (cond.value === 0) {
      const selectedPreset = TIME_PRESETS.find((preset) => preset.seconds === presetSeconds);
      return `Time Only (${timeMode === "preset" ? selectedPreset?.label ?? `${presetSeconds}s` : "custom"})`;
    }
    if (cond.value === 1) {
      return `Payment Only (${paymentInput.trim() || "..."} ${nativeSymbol})`;
    }
    const selectedPreset = TIME_PRESETS.find((preset) => preset.seconds === presetSeconds);
    return `Time + Payment (time: ${timeMode === "preset" ? selectedPreset?.label ?? `${presetSeconds}s` : "custom"}, payment: ${paymentInput.trim() || "..."} ${nativeSymbol})`;
  }, [unlockCondition, nativeSymbol, paymentInput, presetSeconds, timeEnabled, timeMode]);

  const isFormValid = useMemo(() => {
    if (!isConnected || !userAddress || !contractAddress) return false;
    if (!receiver || !isAddress(receiver) || receiver.toLowerCase() === userAddress.toLowerCase()) return false;
    if (!content.trim() && !attachedFile) return false;
    if (!timeEnabled && !paymentEnabled) return false;
    if (timeEnabled && unlockTimestamp <= Math.floor(Date.now() / 1000)) return false;
    if (paymentEnabled && parsedPayment <= 0n) return false;
    return true;
  }, [attachedFile, content, contractAddress, isConnected, parsedPayment, paymentEnabled, receiver, timeEnabled, unlockTimestamp, userAddress]);

  const handleFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (file && file.size > MAX_ATTACHMENT_BYTES) {
      setError("Attachment is too large. Limit is 5MB.");
      return;
    }
    setAttachedFile(file);
    setError(null);
  }, []);

  const resetForm = useCallback(() => {
    setReceiver("");
    setContent("");
    setAttachedFile(null);
    setTimeEnabled(true);
    setTimeMode("preset");
    setPresetSeconds(60);
    setUnlockAt(toDateTimeLocalValue(Date.now() + 60_000));
    setPaymentEnabled(false);
    setPaymentInput("");
    setUnlockCondition(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const uploadJson = useCallback(async (payload: unknown, fileName: string, metadata?: Record<string, unknown>) => {
    const json = JSON.stringify(payload);
    const file = new File([json], fileName, { type: "application/json" });
    const result = await pinFileToIpfs({ file, metadata });
    return { cid: result.IpfsHash, json };
  }, []);

  const handleSubmit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isFormValid || !contractAddress || !userAddress || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);
    setStatusMessage("Generating encryption keys...");

    try {
      const messageKey = generateMessageKey();
      const keyParts = splitMessageKey(messageKey);
      const attachmentMeta: AttachmentMeta | null = attachedFile
        ? { name: attachedFile.name, size: attachedFile.size, mimeType: attachedFile.type || "application/octet-stream" }
        : null;

      // ── Generate public preview ─────────────────────────────────────
      setStatusMessage("Generating public preview...");
      const autoPreviewText = generatePreviewText(content, attachedFile);
      let previewCid = "";
      let thumbnailCid: string | null = null;

      // For images: generate tiny thumbnail and pin to IPFS
      if (attachedFile && getPreviewType(attachedFile) === "text+image") {
        setStatusMessage("Generating thumbnail preview...");
        const thumbBlob = await generateThumbnailBlob(attachedFile, 50);
        if (thumbBlob) {
          const thumbFile = new File([thumbBlob], "thumb.jpg", { type: "image/jpeg" });
          try {
            const thumbResult = await pinFileToIpfs({
              file: thumbFile,
              metadata: { name: `thumb-${Date.now()}`, keyvalues: { type: "preview-thumbnail" } },
            });
            thumbnailCid = thumbResult.IpfsHash;
          } catch { /* thumbnail is optional */ }
        }
      }

      // Build rich public preview JSON and pin to IPFS
      const previewData: PublicPreviewData = {
        version: 1,
        type: getPreviewType(attachedFile),
        messageLength: content.trim().length,
        ...(attachedFile && {
          fileInfo: {
            name: attachedFile.name,
            size: attachedFile.size,
            mimeType: attachedFile.type || "application/octet-stream",
          },
        }),
        ...(thumbnailCid && { thumbnailCid }),
      };

      try {
        setStatusMessage("Uploading public preview to IPFS...");
        const previewUpload = await uploadJson(
          previewData,
          `public-preview-${Date.now()}.json`,
          { name: `public-preview-${Date.now()}`, keyvalues: { type: "public-preview" } }
        );
        previewCid = previewUpload.cid;
      } catch {
        // preview is non-essential; proceed without it
      }

      // ── Encrypt payload & metadata ──────────────────────────────────
      let attachmentEnvelopeCid: string | null = null;
      if (attachedFile) {
        setStatusMessage("Encrypting attachment...");
        const attachmentBytes = new Uint8Array(await attachedFile.arrayBuffer());
        const encryptedAttachment = await encryptBytesEnvelope(attachmentBytes, messageKey);
        const attachmentUpload = await uploadJson(
          encryptedAttachment,
          `sealed-attachment-${Date.now()}.json`,
          { name: `sealed-attachment-${Date.now()}`, keyvalues: { type: "sealed-attachment" } }
        );
        attachmentEnvelopeCid = attachmentUpload.cid;
      }

      setStatusMessage("Encrypting payload...");
      const payloadEnvelope = await encryptJsonEnvelope(
        {
          version: 1,
          message: content.trim() || null,
          attachmentEnvelopeCid,
        },
        messageKey
      );
      setStatusMessage("Uploading encrypted payload to IPFS...");
      const payloadUpload = await uploadJson(
        payloadEnvelope,
        `sealed-payload-${Date.now()}.json`,
        { name: `sealed-payload-${Date.now()}`, keyvalues: { type: "sealed-payload" } }
      );

      setStatusMessage("Encrypting metadata...");
      const metadataEnvelope = await encryptJsonEnvelope(
        {
          version: 1,
          createdAt: new Date().toISOString(),
          hasAttachment: Boolean(attachmentMeta),
          attachment: attachmentMeta,
        },
        messageKey
      );
      setStatusMessage("Uploading encrypted metadata to IPFS...");
      const metadataUpload = await uploadJson(
        metadataEnvelope,
        `sealed-metadata-${Date.now()}.json`,
        { name: `sealed-metadata-${Date.now()}`, keyvalues: { type: "sealed-metadata" } }
      );

      setStatusMessage("Encrypting key parts for FHE contract...");
      const encryptedKeys = await encryptKeyPartsForContract({
        contractAddress,
        userAddress,
        keyParts,
      });

      setStatusMessage("Computing integrity hashes...");
      const payloadHash = await computeKeccakFromString(payloadUpload.json);
      const metadataHash = await computeKeccakFromString(metadataUpload.json);

      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const formAbi = versionKey === "v5.1-fhe" ? sealedMessageFheV51Abi : sealedMessageFheSecureAbi;
      const contract = new ethers.Contract(contractAddress, formAbi, signer);

      setStatusMessage("Sending transaction to blockchain...");
      const tx = await contract.sendMessage(
        receiver as `0x${string}`,
        unlockTimestamp,
        paymentEnabled ? parsedPayment : 0n,
        unlockCondition,
        payloadUpload.cid,
        metadataUpload.cid,
        previewCid,
        autoPreviewText,
        payloadHash,
        metadataHash,
        encryptedKeys.handles[0],
        encryptedKeys.handles[1],
        encryptedKeys.handles[2],
        encryptedKeys.handles[3],
        encryptedKeys.inputProof
      );
      setStatusMessage("⏳ Waiting for confirmation...");
      await tx.wait();

      setStatusMessage("✅ Done!");
      setSuccess("Secure FHE message submitted.");
      resetForm();
      onSubmitted?.();
    } catch (submitError) {
      console.error("Secure FHE submit failed", submitError);
      setError(submitError instanceof Error ? submitError.message : "Secure FHE submit failed");
    } finally {
      setIsSubmitting(false);
    }
  }, [attachedFile, content, contractAddress, isFormValid, isSubmitting, onSubmitted, parsedPayment, paymentEnabled, receiver, resetForm, unlockTimestamp, uploadJson, userAddress, versionKey]);

  return (
    <div className="w-full max-w-2xl mx-auto rounded-xl border border-emerald-500/30 bg-gray-900/80 p-6 backdrop-blur-sm">
      <h2 className="mb-5 flex items-center gap-2 text-xl font-bold text-white">
        <span>🛡️</span>
        Secure FHE Message
        <span className="rounded bg-emerald-600/20 px-2 py-0.5 text-xs text-emerald-300">{versionKey === "v5.1-fhe" ? "V5.1-FHE" : "V5-FHE"}</span>
      </h2>

      <div className="mb-4 rounded-lg border border-emerald-500/20 bg-emerald-950/20 p-3 text-xs text-emerald-200">
        Message access is gated with Zama FHE. The message stays sealed until the selected unlock conditions are satisfied.
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-950/30 p-3 text-sm text-red-200">{error}</div>}
      {success && <div className="mb-4 rounded-lg border border-green-500/30 bg-green-950/30 p-3 text-sm text-green-200">{success}</div>}

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="mb-1 block text-sm text-gray-300">Receiver</label>
          <input value={receiver} onChange={(event) => setReceiver(event.target.value)} placeholder="0x..." className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500" />
        </div>

        <div>
          <label className="mb-1 block text-sm text-gray-300">Encrypted message</label>
          <textarea value={content} onChange={(event) => setContent(event.target.value)} rows={4} placeholder="Write the private message" className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500" />
        </div>

        <div>
          <label className="mb-1 block text-sm text-gray-300">Public preview</label>
          <div className="rounded-lg border border-emerald-700/40 bg-emerald-950/20 px-3 py-2 text-sm text-emerald-100">
            {generatePreviewText(content, attachedFile)}
          </div>
          <p className="mt-1 text-xs text-gray-500">Auto-generated preview visible to everyone. Helps recipients identify your message.</p>
        </div>

        <div>
          <label className="mb-1 block text-sm text-gray-300">Attachment</label>
          <input ref={fileInputRef} type="file" onChange={handleFileChange} className="w-full text-sm text-gray-400 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-600 file:px-3 file:py-1.5 file:text-sm file:text-white hover:file:bg-emerald-700" />
          {attachedFile && <div className="mt-2 text-xs text-gray-400">{attachedFile.name} ({Math.ceil(attachedFile.size / 1024)} KB)</div>}
        </div>

        <div className="space-y-4 rounded-lg border border-gray-700 bg-gray-800/40 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={timeEnabled} onChange={(event) => setTimeEnabled(event.target.checked)} />
              Time condition
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={paymentEnabled} onChange={(event) => setPaymentEnabled(event.target.checked)} />
              Payment condition
            </label>
          </div>

          {timeEnabled && (
            <div className="space-y-3 rounded-lg border border-gray-700 bg-gray-900/40 p-3">
              <div className="flex items-center gap-4 text-xs text-gray-400">
                <label className="flex items-center gap-2">
                  <input type="radio" name="secure-time-mode" checked={timeMode === "preset"} onChange={() => setTimeMode("preset")} />
                  Quick presets
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="secure-time-mode" checked={timeMode === "custom"} onChange={() => setTimeMode("custom")} />
                  Custom date
                </label>
              </div>

              {timeMode === "preset" ? (
                <div className="flex flex-wrap gap-2">
                  {TIME_PRESETS.map((preset) => {
                    const active = preset.seconds === presetSeconds;
                    return (
                      <button
                        key={preset.seconds}
                        type="button"
                        onClick={() => setPresetSeconds(preset.seconds)}
                        className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                          active
                            ? "border-emerald-500 bg-emerald-600/20 text-emerald-200"
                            : "border-gray-700 bg-gray-800 text-gray-300 hover:border-emerald-500/50 hover:text-white"
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div>
                  <label className="mb-1 block text-sm text-gray-300">Unlock after</label>
                  <input type="datetime-local" value={unlockAt} onChange={(event) => setUnlockAt(event.target.value)} className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500" />
                </div>
              )}
            </div>
          )}

          {paymentEnabled && (
            <div className="rounded-lg border border-gray-700 bg-gray-900/40 p-3">
              <label className="mb-1 block text-sm text-gray-300">Required payment</label>
              <input value={paymentInput} onChange={(event) => setPaymentInput(event.target.value)} placeholder={`0.01 ${nativeSymbol}`} className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500" />
            </div>
          )}

          <div className="rounded-lg border border-emerald-700/20 bg-emerald-950/10 p-3">
            <label className="mb-2 block text-sm text-emerald-200">Unlock condition</label>
            <div className="flex flex-wrap gap-2">
              {UNLOCK_CONDITIONS.map((cond) => (
                <button
                  key={cond.value}
                  type="button"
                  onClick={() => setUnlockCondition(cond.value)}
                  disabled={cond.value === 0 ? !timeEnabled : cond.value === 1 ? !paymentEnabled : !timeEnabled || !paymentEnabled}
                  className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                    unlockCondition === cond.value
                      ? "border-emerald-400 bg-emerald-500/20 text-emerald-100"
                      : "border-gray-700 bg-gray-800 text-gray-300 hover:border-emerald-500/50"
                  } ${cond.value === 0 && !timeEnabled ? "opacity-30 cursor-not-allowed" : ""} ${cond.value === 1 && !paymentEnabled ? "opacity-30 cursor-not-allowed" : ""} ${cond.value === 2 && (!timeEnabled || !paymentEnabled) ? "opacity-30 cursor-not-allowed" : ""}`}
                >
                  {cond.label}
                </button>
              ))}
            </div>
          </div>

          <p className="text-xs text-gray-400">Active unlock rule: {conditionSummary}.</p>
        </div>

        <div className="relative">
          {/* Typewriter status message during submission */}
          {isSubmitting && typewriterDisplay && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-emerald-700/30 bg-emerald-950/20 px-3 py-2 font-mono text-xs text-emerald-300">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
              <span className="flex-1">{typewriterDisplay}</span>
              <span className="animate-pulse text-emerald-400">▊</span>
            </div>
          )}
          <button type="submit" disabled={!isFormValid || isSubmitting} className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50">
            {isSubmitting ? "Submitting secure message..." : "Send Secure FHE Message"}
          </button>
        </div>
      </form>
    </div>
  );
}
