"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { ethers } from "ethers";
import { isAddress } from "viem";
import { useAccount, useNetwork } from "../lib/wagmiCompat";
import { useContractAddress } from "../lib/useContractAddress";
import { sealedMessageFheSecureAbi } from "../lib/sealedMessageFheSecureAbi";
import { sealedMessageFheV51Abi } from "../lib/sealedMessageFheV51Abi";
import { sealedMessageFheV52Abi } from "../lib/sealedMessageFheV52Abi";
import { pinFileToIpfs } from "../lib/ipfsClient";
import { combineMessageKey, computeKeccakFromString, encryptBytesEnvelope, encryptJsonEnvelope, generateMessageKey, splitMessageKey } from "../lib/securePayload";
import { encryptKeyPartsForContract } from "../lib/fheSecure";
import {
  generatePreviewText,
  generateThumbnailBlob,
  getPreviewType,
} from "../lib/preview";
import { UnlockConditionsInfo } from "./UnlockConditionsInfo";
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

type UnlockConditionValue = 0 | 1 | 2 | 3;
type ConditionLogic = "AND" | "OR";
const UNLOCK_CONDITIONS: { value: UnlockConditionValue; label: string; desc: string }[] = [
  { value: 0, label: "Time Only", desc: "Release after a specific time" },
  { value: 1, label: "Payment Only", desc: "Release after payment" },
  { value: 2, label: "Time + Payment", desc: "Both time and payment must pass" },
  { value: 3, label: "Time OR Payment", desc: "Either time or payment can unlock" },
];

const TIME_PRESETS = [
  { label: "1 min (Dev/Test)", seconds: 60 },
  { label: "5 min", seconds: 5 * 60 },
  { label: "10 min", seconds: 10 * 60 },
  { label: "1 hour", seconds: 60 * 60 },
  { label: "1 day", seconds: 24 * 60 * 60 },
] as const;

const SAFETY_BUFFER_SECONDS = 90;
const MIN_CLIENT_UNLOCK_DELAY_SECONDS = 180;

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
  const isV52 = versionKey === "v5.2-fhe";
  const nativeDecimals = chain?.nativeCurrency?.decimals ?? 18;
  const nativeSymbol = chain?.nativeCurrency?.symbol ?? "ETH";

  const [receiver, setReceiver] = useState("");
  const [content, setContent] = useState("");
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [timeEnabled, setTimeEnabled] = useState(true);
  const [timeMode, setTimeMode] = useState<"preset" | "custom">("preset");
  const [presetSeconds, setPresetSeconds] = useState<number>(5 * 60);
  const [unlockAt, setUnlockAt] = useState(() => toDateTimeLocalValue(Date.now() + 5 * 60_000));
  const [paymentEnabled, setPaymentEnabled] = useState(false);
  const [paymentInput, setPaymentInput] = useState("");
  const [unlockCondition, setUnlockCondition] = useState<UnlockConditionValue>(
    timeEnabled && paymentEnabled ? 2 : timeEnabled ? 0 : 1
  );
  const [conditionLogic, setConditionLogic] = useState<ConditionLogic>("AND");
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

  const resolveUnlockTimestamp = useCallback((nowSeconds = Math.floor(Date.now() / 1000)) => {
    if (!timeEnabled) return 0;
    if (timeMode === "preset") {
      const effectiveDelay = Math.max(presetSeconds, MIN_CLIENT_UNLOCK_DELAY_SECONDS);
      return nowSeconds + effectiveDelay + SAFETY_BUFFER_SECONDS;
    }
    if (!unlockAt) return 0;
    const value = new Date(unlockAt).getTime();
    return Number.isFinite(value) ? Math.floor(value / 1000) : 0;
  }, [presetSeconds, timeEnabled, timeMode, unlockAt]);

  const unlockTimestamp = useMemo(() => resolveUnlockTimestamp(), [resolveUnlockTimestamp]);

  const bothConditionsEnabled = timeEnabled && paymentEnabled;
  const isUnsupportedOrCondition = bothConditionsEnabled && conditionLogic === "OR" && !isV52;
  const unlockTimePreview = useMemo(() => {
    if (!timeEnabled || unlockTimestamp <= 0) return null;
    const date = new Date(unlockTimestamp * 1000);
    return {
      local: date.toLocaleString(),
      utc: date.toISOString().replace("T", " ").replace(".000Z", " UTC"),
    };
  }, [timeEnabled, unlockTimestamp]);

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
    if (cond.value === 3) {
      const selectedPreset = TIME_PRESETS.find((preset) => preset.seconds === presetSeconds);
      return `Time OR Payment (time: ${timeMode === "preset" ? selectedPreset?.label ?? `${presetSeconds}s` : "custom"}, payment: ${paymentInput.trim() || "..."} ${nativeSymbol})`;
    }
    const selectedPreset = TIME_PRESETS.find((preset) => preset.seconds === presetSeconds);
    return `Time + Payment (time: ${timeMode === "preset" ? selectedPreset?.label ?? `${presetSeconds}s` : "custom"}, payment: ${paymentInput.trim() || "..."} ${nativeSymbol})`;
  }, [unlockCondition, nativeSymbol, paymentInput, presetSeconds, timeMode]);

  const isFormValid = useMemo(() => {
    if (!isConnected || !userAddress || !contractAddress) return false;
    if (!receiver || !isAddress(receiver) || receiver.toLowerCase() === userAddress.toLowerCase()) return false;
    if (!content.trim() && !attachedFile) return false;
    if (!timeEnabled && !paymentEnabled) return false;
    if (timeEnabled && unlockTimestamp <= Math.floor(Date.now() / 1000) + SAFETY_BUFFER_SECONDS) return false;
    if (paymentEnabled && parsedPayment <= 0n) return false;
    if (isUnsupportedOrCondition) return false;
    return true;
  }, [attachedFile, content, contractAddress, isConnected, isUnsupportedOrCondition, parsedPayment, paymentEnabled, receiver, timeEnabled, unlockTimestamp, userAddress]);

  useEffect(() => {
    if (timeEnabled && paymentEnabled) {
      setUnlockCondition(conditionLogic === "OR" && isV52 ? 3 : 2);
      return;
    }
    if (timeEnabled) {
      setUnlockCondition(0);
      setConditionLogic("AND");
      return;
    }
    if (paymentEnabled) {
      setUnlockCondition(1);
      setConditionLogic("AND");
    }
  }, [conditionLogic, isV52, paymentEnabled, timeEnabled]);

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
    setPresetSeconds(5 * 60);
    setUnlockAt(toDateTimeLocalValue(Date.now() + 5 * 60_000));
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
    if (isUnsupportedOrCondition) {
      setError("OR logic is only supported by V5.2-FHE. Select the V5.2 deployment or switch back to AND.");
      return;
    }

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
      const signerAddress = await signer.getAddress();
      if (signerAddress.toLowerCase() !== userAddress.toLowerCase()) {
        throw new Error("Wallet address changed while preparing the transaction. Please review the form with the active MetaMask address and try again.");
      }
      const formAbi = versionKey === "v5.2-fhe" ? sealedMessageFheV52Abi : versionKey === "v5.1-fhe" ? sealedMessageFheV51Abi : sealedMessageFheSecureAbi;
      const contract = new ethers.Contract(contractAddress, formAbi, signer);
      const txUnlockTimestamp = resolveUnlockTimestamp();

      if (timeEnabled && txUnlockTimestamp <= Math.floor(Date.now() / 1000) + SAFETY_BUFFER_SECONDS) {
        setError("Unlock time moved too close while preparing the transaction. Please choose a later time and try again.");
        setIsSubmitting(false);
        return;
      }

      setStatusMessage("Sending transaction to blockchain...");
      const tx = await contract.sendMessage(
        receiver as `0x${string}`,
        txUnlockTimestamp,
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
  }, [attachedFile, content, contractAddress, isFormValid, isSubmitting, isUnsupportedOrCondition, onSubmitted, parsedPayment, paymentEnabled, receiver, resetForm, resolveUnlockTimestamp, timeEnabled, unlockCondition, uploadJson, userAddress, versionKey]);

  return (
    <div className="mx-auto w-full max-w-2xl rounded-[24px] border border-cyber-blue/25 bg-[linear-gradient(180deg,rgba(7,12,31,0.96),rgba(4,7,19,0.98))] p-5 shadow-glow-blue md:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-white">
            <span>🛡️</span>
            Secure FHE Message
            <span className="rounded-full border border-cyber-blue/25 bg-cyber-blue/10 px-2 py-0.5 text-xs text-brand-cyan">{versionKey === "v5.2-fhe" ? "V5.2-FHE" : versionKey === "v5.1-fhe" ? "V5.1-FHE" : "V5-FHE"}</span>
          </h2>
          <p className="mt-1 text-xs text-text-light/50">
            Active wallet: <span className="font-mono text-brand-cyan">{userAddress ? `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}` : "Not connected"}</span>
          </p>
        </div>
        <div className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-300">
          Sepolia FHE
        </div>
      </div>

      <div className="mb-4 rounded-2xl border border-cyber-blue/25 bg-cyber-blue/10 p-3 text-xs leading-5 text-brand-cyan">
        Message access is gated with Zama FHE. The message stays sealed until the selected unlock conditions are satisfied.
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-950/30 p-3 text-sm text-red-200">{error}</div>}
      {success && <div className="mb-4 rounded-lg border border-green-500/30 bg-green-950/30 p-3 text-sm text-green-200">{success}</div>}

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-cyber-blue">Receiver</label>
          <input value={receiver} onChange={(event) => setReceiver(event.target.value)} placeholder="0x..." className="w-full rounded-xl border border-cyber-blue/15 bg-midnight/90 px-3 py-2 text-sm text-white outline-none focus:border-cyber-blue" />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-cyber-blue">Message</label>
          <textarea value={content} onChange={(event) => setContent(event.target.value)} rows={5} placeholder="Write and seal" className="w-full rounded-xl border border-cyber-blue/25 bg-midnight/90 px-3 py-3 text-sm text-white outline-none transition focus:border-cyber-blue focus:shadow-glow-blue" />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-cyber-blue">Public preview</label>
          <div className="rounded-xl border border-cyber-blue/20 bg-midnight/80 px-3 py-2 text-sm text-text-light">
            {generatePreviewText(content, attachedFile)}
          </div>
          <p className="mt-1 text-xs text-gray-500">Auto-generated preview visible to everyone. Helps recipients identify your message.</p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-cyber-blue">Attachment</label>
          <input ref={fileInputRef} type="file" onChange={handleFileChange} className="hidden" />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-xl bg-gradient-to-r from-cyber-blue to-sunset px-3 py-2 text-sm font-semibold text-white hover:brightness-110"
            >
              Choose File
            </button>
            <span className="text-sm text-gray-400">{attachedFile ? attachedFile.name : "No file chosen"}</span>
          </div>
          {attachedFile && <div className="mt-2 text-xs text-gray-400">{attachedFile.name} ({Math.ceil(attachedFile.size / 1024)} KB)</div>}
        </div>

        <div className="space-y-4 rounded-2xl border border-cyber-blue/25 bg-midnight/55 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyber-blue">Unlock conditions</p>
                <UnlockConditionsInfo />
              </div>
            </div>
            <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:min-w-[360px] sm:grid-cols-2">
              <label
                className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                  timeEnabled
                    ? "border-cyber-blue bg-cyber-blue/15 text-brand-cyan shadow-glow-blue"
                    : "border-cyber-blue/20 bg-brand-panel/70 text-text-light/65 hover:border-cyber-blue/50 hover:text-white"
                }`}
              >
                <input
                  type="checkbox"
                  checked={timeEnabled}
                  onChange={(event) => setTimeEnabled(event.target.checked)}
                  className="h-4 w-4 accent-cyber-blue"
                />
                <span className="flex flex-col">
                  <span>Time condition</span>
                  <span className="text-[11px] font-normal text-text-light/45">Unlock after time</span>
                </span>
              </label>
              <label
                className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                  paymentEnabled
                    ? "border-sunset bg-sunset/15 text-brand-orange-soft shadow-glow-orange"
                    : "border-cyber-blue/20 bg-brand-panel/70 text-text-light/65 hover:border-sunset/50 hover:text-white"
                }`}
              >
                <input
                  type="checkbox"
                  checked={paymentEnabled}
                  onChange={(event) => setPaymentEnabled(event.target.checked)}
                  className="h-4 w-4 accent-sunset"
                />
                <span className="flex flex-col">
                  <span>Payment condition</span>
                  <span className="text-[11px] font-normal text-text-light/45">Require payment</span>
                </span>
              </label>
            </div>
          </div>

          {timeEnabled && (
            <div className="space-y-3 rounded-2xl border border-cyber-blue/35 bg-[linear-gradient(180deg,rgba(4,28,46,0.62),rgba(2,17,31,0.72))] p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm font-semibold text-brand-cyan">Unlock time</span>
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
              </div>

              {timeMode === "preset" ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {TIME_PRESETS.map((preset) => {
                    const active = preset.seconds === presetSeconds;
                    return (
                      <button
                        key={preset.seconds}
                        type="button"
                        onClick={() => setPresetSeconds(preset.seconds)}
                        className={`min-h-10 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                          active
                            ? "border-sunset bg-sunset/15 text-brand-orange-soft"
                            : "border-cyber-blue/15 bg-brand-panel text-text-light/75 hover:border-cyber-blue/50 hover:text-white"
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
                  <input type="datetime-local" value={unlockAt} onChange={(event) => setUnlockAt(event.target.value)} className="w-full rounded-xl border border-cyber-blue/15 bg-brand-panel px-3 py-2 text-sm text-white outline-none focus:border-cyber-blue" />
                </div>
              )}

              {unlockTimePreview && (
                <div className="rounded-xl border border-cyber-blue/15 bg-brand-panel/70 p-3 text-xs text-gray-400">
                  <div className="flex items-center justify-between gap-3">
                    <span>Your local time</span>
                    <span className="text-right font-mono text-text-light/80">{unlockTimePreview.local}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3">
                    <span>Blockchain/UTC</span>
                    <span className="text-right font-mono text-text-light/80">{unlockTimePreview.utc}</span>
                  </div>
                  <p className="mt-2 border-t border-cyber-blue/10 pt-2 text-gray-500">
                    Unlock time is enforced by Sepolia block time. Wallet approval and block production can shift timing by a few seconds or minutes.
                  </p>
                </div>
              )}
            </div>
          )}

          {paymentEnabled && (
            <div className="rounded-2xl border border-aurora/35 bg-[linear-gradient(180deg,rgba(34,13,55,0.58),rgba(15,8,31,0.72))] p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <label className="block text-sm font-semibold text-[#c39cff]">Required payment</label>
                <span className="rounded-md border border-aurora/30 bg-aurora/20 px-2 py-1 text-xs font-semibold text-[#d9c7ff]">{nativeSymbol}</span>
              </div>
              <input value={paymentInput} onChange={(event) => setPaymentInput(event.target.value)} placeholder={`0.01 ${nativeSymbol}`} className="w-full rounded-xl border border-cyber-blue/15 bg-brand-panel px-3 py-2 text-sm text-white outline-none focus:border-cyber-blue" />
              <p className="mt-2 text-xs text-text-light/45">Receiver pays this amount to unlock; funds are transferred to the sender by the contract.</p>
            </div>
          )}

          <div className="rounded-2xl border border-cyber-blue/25 bg-cyber-blue/5 p-3">
            <label className="mb-2 block text-sm text-brand-cyan">Unlock condition</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
              {UNLOCK_CONDITIONS.map((cond) => (
                <button
                  key={cond.value}
                  type="button"
                  onClick={() => {
                    setUnlockCondition(cond.value);
                    if (cond.value === 3) {
                      setConditionLogic("OR");
                      return;
                    }
                    setConditionLogic("AND");
                  }}
                  disabled={cond.value === 0 ? !timeEnabled : cond.value === 1 ? !paymentEnabled : cond.value === 3 ? (!timeEnabled || !paymentEnabled || !isV52) : !timeEnabled || !paymentEnabled}
                  className={`rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors ${
                    unlockCondition === cond.value
                      ? "border-sunset bg-gradient-to-r from-cyber-blue/20 to-sunset/20 text-white"
                      : "border-cyber-blue/15 bg-brand-panel text-text-light/75 hover:border-cyber-blue/50"
                  } ${cond.value === 0 && !timeEnabled ? "opacity-30 cursor-not-allowed" : ""} ${cond.value === 1 && !paymentEnabled ? "opacity-30 cursor-not-allowed" : ""} ${cond.value === 2 && (!timeEnabled || !paymentEnabled) ? "opacity-30 cursor-not-allowed" : ""} ${cond.value === 3 && (!isV52 || !timeEnabled || !paymentEnabled) ? "opacity-30 cursor-not-allowed" : ""}`}
                >
                  <span className="block">{cond.label}</span>
                  <span className="mt-1 block text-[11px] font-normal text-text-light/45">{cond.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {bothConditionsEnabled && isUnsupportedOrCondition && (
            <div className="rounded-2xl border border-red-500/25 bg-red-950/30 p-3 text-xs text-red-200">
              OR is not supported by the active contract version. Switch to V5.2-FHE to use on-chain OR unlocking.
            </div>
          )}

          <p className="text-xs text-gray-400">Active unlock rule: {conditionSummary}.</p>
        </div>

        <div className="relative">
          {/* Typewriter status message during submission */}
          {isSubmitting && typewriterDisplay && (
            <div className="mb-2 flex items-center gap-2 rounded-xl border border-cyber-blue/20 bg-cyber-blue/10 px-3 py-2 font-mono text-xs text-brand-cyan">
              <span className="h-2 w-2 animate-pulse rounded-full bg-sunset" />
              <span className="flex-1">{typewriterDisplay}</span>
              <span className="animate-pulse text-sunset">▊</span>
            </div>
          )}
          <button type="submit" disabled={!isFormValid || isSubmitting} className="w-full rounded-xl bg-gradient-to-r from-cyber-blue via-aurora to-sunset px-4 py-3 text-sm font-semibold tracking-[0.18em] text-midnight shadow-glow-orange hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
            {isSubmitting ? "Submitting secure message..." : "Send Secure FHE Message"}
          </button>
        </div>
      </form>
    </div>
  );
}
