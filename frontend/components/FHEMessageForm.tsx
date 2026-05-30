"use client";

import { useState, useMemo, useCallback, useEffect, useRef, type ChangeEvent, type FormEvent } from "react";
import { useAccount, useNetwork } from "../lib/wagmiCompat";
import { useBalance } from "wagmi";
import { useContractAddress } from "../lib/useContractAddress";
import { sealedMessageFheAbi } from "../lib/sealedMessageFheAbi";
import { encryptEuint64 } from "../lib/fhevm-sdk";
import { isAddress } from "viem";
import { ethers } from "ethers";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import relativeTime from "dayjs/plugin/relativeTime";
import { pinFileToIpfs } from "../lib/ipfsClient";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(relativeTime);

const MAX_ATTACHMENT_BYTES = 1 * 1024 * 1024;

interface Props {
  onSubmitted?: () => void;
}

export function FHEMessageForm({ onSubmitted }: Props) {
  const { address: userAddress, isConnected } = useAccount();
  const { chain } = useNetwork();
  const contractAddress = useContractAddress();
  const { data: balance } = useBalance({ address: userAddress });
  const chainId = chain?.id;
  const nativeSymbol = chain?.nativeCurrency?.symbol ?? "ETH";
  const nativeDecimals = chain?.nativeCurrency?.decimals ?? 18;

  // Form state
  const [receiver, setReceiver] = useState<string>("");
  const [content, setContent] = useState<string>("");
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [ipfsHash, setIpfsHash] = useState<string>("");
  const [previewIpfsHash, setPreviewIpfsHash] = useState<string>("");
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);
  const [attachmentPreviewMime, setAttachmentPreviewMime] = useState<string>("");
  const [attachmentMetadata, setAttachmentMetadata] = useState<{
    type: string;
    size: number;
    name: string;
    dimensions?: { width: number; height: number };
  } | null>(null);

  // Conditions
  const [timeConditionEnabled, setTimeConditionEnabled] = useState(true);
  const [paymentEnabled, setPaymentEnabled] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState<string>("0"); // Internal base units
  const [paymentInputValue, setPaymentInputValue] = useState<string>("");
  const [unlockMode, setUnlockMode] = useState<"preset" | "custom">("preset");
  const [presetDuration, setPresetDuration] = useState(300);
  const [unlock, setUnlock] = useState("");
  const [selectedTimezone, setSelectedTimezone] = useState("UTC");
  const [isPresetsOpen, setIsPresetsOpen] = useState(false);
  const [plannedUnlockTimestamp, setPlannedUnlockTimestamp] = useState<number>(() => Math.floor(Date.now() / 1000) + 300);
  const [conditionMask, setConditionMask] = useState(0x01);

  // UI state
  const [error, setError] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [mounted, setMounted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Prevent hydration mismatch
  useEffect(() => {
    setMounted(true);
    const localTime = new Date();
    const year = localTime.getFullYear();
    const month = String(localTime.getMonth() + 1).padStart(2, "0");
    const day = String(localTime.getDate()).padStart(2, "0");
    const hours = String(localTime.getHours()).padStart(2, "0");
    const minutes = String(localTime.getMinutes()).padStart(2, "0");
    setUnlock(`${year}-${month}-${day}T${hours}:${minutes}`);
    setPlannedUnlockTimestamp(Math.floor(Date.now() / 1000) + 300);
    setSelectedTimezone(dayjs.tz.guess());
  }, []);

  // Computed unlock time
  const computedUnlockTime = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    if (!timeConditionEnabled) return now;

    if (unlockMode === "preset") return now + presetDuration;

    try {
      const parsed = dayjs.tz(unlock, selectedTimezone);
      if (parsed.isValid()) return parsed.unix();
    } catch { /* ignore */ }
    return now;
  }, [timeConditionEnabled, unlockMode, presetDuration, unlock, selectedTimezone]);

  const parsedPaymentAmount = useMemo(() => {
    if (!paymentAmount) return 0n;
    try {
      return BigInt(paymentAmount);
    } catch (err) {
      console.warn("⚠️ Invalid FHE payment amount state", paymentAmount, err);
      return 0n;
    }
  }, [paymentAmount]);

  const hasValidPaymentAmount = parsedPaymentAmount > 0n;

  // Recompute mask
  useEffect(() => {
    let mask = 0;
    const now = Math.floor(Date.now() / 1000);
    if (timeConditionEnabled && computedUnlockTime > now + 60) mask |= 0x01;
    if (paymentEnabled && hasValidPaymentAmount) mask |= 0x02;
    if (mask === 0) mask = 0x01;
    setConditionMask(mask);
  }, [timeConditionEnabled, paymentEnabled, hasValidPaymentAmount, computedUnlockTime]);

  // Validate form
  const isFormValid = useMemo(() => {
    if (!isConnected || !userAddress || !contractAddress || !receiver || !isAddress(receiver)) return false;
    if (receiver.toLowerCase() === userAddress.toLowerCase()) return false;
    if (content.trim().length === 0 && !attachedFile) return false;
    if (!timeConditionEnabled && !paymentEnabled) return false;
    if (paymentEnabled && !hasValidPaymentAmount) return false;
    return true;
  }, [isConnected, userAddress, contractAddress, receiver, content, attachedFile, timeConditionEnabled, paymentEnabled, hasValidPaymentAmount]);

  // Upload to IPFS
  const uploadToIPFS = useCallback(async (fileOrJson: File | Blob, fileName: string): Promise<string> => {
    const file = fileOrJson instanceof File ? fileOrJson : new File([fileOrJson], fileName, { type: "application/json" });
    const data = await pinFileToIpfs({
      file,
      metadata: { name: fileName, keyvalues: { type: "fhe-message" } },
    });
    return data.IpfsHash;
  }, []);

  // File handling
  const handleFileSelect = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_ATTACHMENT_BYTES) {
      setError(`❌ File too large! Maximum: 1MB`);
      return;
    }

    setAttachedFile(file);
    setError(null);
    setAttachmentMetadata({ type: file.type, size: file.size, name: file.name });

    // Preview for images
    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        setAttachmentPreview(dataUrl);
        setAttachmentPreviewMime(file.type);

        // Upload preview to IPFS
        fetch(dataUrl)
          .then((r) => r.blob())
          .then((blob) => uploadToIPFS(blob, `preview-${Math.random().toString(36).substring(2, 8)}`))
          .then((hash) => setPreviewIpfsHash(hash))
          .catch(() => {});

        // Get dimensions
        const img = new Image();
        img.onload = () => setAttachmentMetadata((p) => p ? { ...p, dimensions: { width: img.width, height: img.height } } : p);
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    }

    // Upload original to IPFS
    setIsUploadingFile(true);
    try {
      const hash = await uploadToIPFS(file, file.name);
      setIpfsHash(hash);
    } catch (err: any) {
      setError(`IPFS upload error: ${err.message}`);
      setAttachedFile(null);
    } finally {
      setIsUploadingFile(false);
    }
  }, [uploadToIPFS]);

  const removeAttachment = useCallback(() => {
    setAttachedFile(null);
    setIpfsHash("");
    setPreviewIpfsHash("");
    setAttachmentPreview(null);
    setAttachmentPreviewMime("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const generateShortHash = () => Math.random().toString(36).substring(2, 8);

  // Submit — sendMessage with plaintext CIDs + FHE-encrypted unlockTime only
  const handleSubmit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || !isFormValid || !contractAddress || !userAddress) return;

    setIsSubmitting(true);
    setError(null);

    try {
      // 1. Upload content + metadata to IPFS (gets plaintext CIDs)
      const shortHash = generateShortHash();
      const now = new Date().toISOString();
      const plainText = content.trim();

      let dataCid: string;
      let metadataCid: string;

      if (attachedFile && ipfsHash) {
        dataCid = ipfsHash;
        const metadataPayload = {
          type: "file",
          version: 1,
          shortHash,
          hasAttachment: true,
          message: plainText || null,
          attachment: {
            ipfsHash,
            fileName: attachedFile.name,
            fileSize: attachedFile.size,
            mimeType: attachedFile.type,
            dimensions: attachmentMetadata?.dimensions ?? null,
          },
          preview: { ipfsHash: previewIpfsHash || null },
          createdAt: now,
        };
        const metadataJson = JSON.stringify(metadataPayload);
        metadataCid = await uploadToIPFS(new Blob([metadataJson], { type: "application/json" }), `meta-${shortHash}.json`);
      } else {
        dataCid = `text:${shortHash}`;
        const metadataPayload = {
          type: "text",
          version: 1,
          shortHash,
          hasAttachment: false,
          message: plainText,
          createdAt: now,
        };
        const metadataJson = JSON.stringify(metadataPayload);
        metadataCid = await uploadToIPFS(new Blob([metadataJson], { type: "application/json" }), `meta-${shortHash}.json`);
      }

      // 2. FHE encrypt ONLY the unlock time
      const unlockTime = timeConditionEnabled ? BigInt(computedUnlockTime) : 0n;
      const encUnlockTime = await encryptEuint64(unlockTime);

      // 3. Prepare contract args — plaintext CIDs + encrypted unlock time
      //    FHEVM v0.11: sendMessage takes separate handle + proof params
      const requiredPayment = paymentEnabled ? parsedPaymentAmount : 0n;
      const args: readonly [
        `0x${string}`,        // receiver
        `0x${string}`,        // encryptedUnlockTimeHandle (bytes32)
        `0x${string}`,        // unlockProof (bytes)
        string,               // dataCid (plaintext)
        string,               // metadataCid (plaintext)
        bigint,               // requiredPayment
        number,               // conditionMask
      ] = [
        receiver as `0x${string}`,
        encUnlockTime.value as `0x${string}`,
        encUnlockTime.proof as `0x${string}`,
        dataCid,
        metadataCid,
        requiredPayment,
        conditionMask,
      ];

      // 4. Write to contract via ethers
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(contractAddress, sealedMessageFheAbi, signer);
      const tx = await contract.sendMessage(...args, {
        value: requiredPayment > 0n ? requiredPayment : undefined,
      });
      await tx.wait();

      // Success
      setSuccessToast(true);
      setTimeout(() => setSuccessToast(false), 3000);

      // Reset form
      setReceiver("");
      setContent("");
      setAttachedFile(null);
      setIpfsHash("");
      setPreviewIpfsHash("");
      setAttachmentPreview(null);
      setPaymentAmount("0");
      setPaymentInputValue("");
      setPaymentEnabled(false);
      setTimeConditionEnabled(true);
      setUnlockMode("preset");
      setPresetDuration(300);
      setPlannedUnlockTimestamp(Math.floor(Date.now() / 1000) + 300);
      onSubmitted?.();
    } catch (err: any) {
      console.error("❌ FHE sendMessage error:", err);
      setError(err?.reason || err?.message || err?.shortMessage || "Transaction failed");
    } finally {
      setIsSubmitting(false);
    }
  }, [
    isSubmitting, isFormValid, contractAddress, userAddress, receiver, content,
    attachedFile, ipfsHash, attachmentMetadata, previewIpfsHash,
    computedUnlockTime, timeConditionEnabled, paymentEnabled,
    parsedPaymentAmount, conditionMask, uploadToIPFS, onSubmitted,
  ]);

  // ==========================================
  // Render (unchanged UI — same as before)
  // ==========================================
  if (!mounted) return null;

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="rounded-xl border border-blue-500/30 bg-gray-900/80 p-6 backdrop-blur-sm">
        <h2 className="mb-6 text-xl font-bold text-white flex items-center gap-2">
          <span>🔐</span> New FHE-Encrypted Message
          <span className="ml-2 rounded bg-blue-600/20 px-2 py-0.5 text-xs text-blue-300">V4-FHE</span>
        </h2>

        {error && (
          <div className="mb-4 rounded-lg bg-red-900/40 border border-red-500/30 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {successToast && (
          <div className="mb-4 rounded-lg bg-green-900/40 border border-green-500/30 p-3 text-sm text-green-300">
            ✅ Message sent successfully with FHE encryption!
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Receiver */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-300">Receiver Address</label>
            <input
              type="text"
              value={receiver}
              onChange={(e) => setReceiver(e.target.value)}
              placeholder="0x..."
              className="w-full rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {/* Content */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-300">Message</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={3}
              placeholder="Write your message..."
              className="w-full rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {/* File attachment */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-300">Attachment (optional)</label>
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileSelect}
              className="w-full text-sm text-gray-400 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-sm file:text-white hover:file:bg-blue-700"
            />
            {attachedFile && (
              <div className="mt-2 flex items-center gap-2 rounded-lg bg-gray-800 p-2 text-xs text-gray-300">
                <span>📎 {attachedFile.name}</span>
                {isUploadingFile && <span className="text-yellow-400">Uploading...</span>}
                <button type="button" onClick={removeAttachment} className="ml-auto text-red-400 hover:text-red-300">
                  ✕
                </button>
              </div>
            )}
          </div>

          {/* Unlock conditions */}
          <div className="space-y-3 rounded-lg border border-gray-700 bg-gray-800/50 p-4">
            <h3 className="text-sm font-semibold text-gray-300">Unlock Conditions</h3>

            {/* Time condition */}
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={timeConditionEnabled} onChange={(e) => setTimeConditionEnabled(e.target.checked)}
                className="rounded border-gray-600 bg-gray-700 text-blue-500" />
              Time-based unlock
            </label>

            {timeConditionEnabled && (
              <div className="ml-6 space-y-2">
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setUnlockMode("preset"); setIsPresetsOpen(!isPresetsOpen); }}
                    className={`rounded-lg px-3 py-1.5 text-xs ${unlockMode === "preset" ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300"}`}>
                    Preset
                  </button>
                  <button type="button" onClick={() => setUnlockMode("custom")}
                    className={`rounded-lg px-3 py-1.5 text-xs ${unlockMode === "custom" ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300"}`}>
                    Custom
                  </button>
                </div>

                {unlockMode === "preset" && (
                  <div className="flex flex-wrap gap-2">
                    {[60, 300, 600, 1800, 3600, 86400, 604800].map((sec) => {
                      const labels: Record<number, string> = { 60: "1m", 300: "5m", 600: "10m", 1800: "30m", 3600: "1h", 86400: "1d", 604800: "1w" };
                      return (
                        <button key={sec} type="button" onClick={() => setPresetDuration(sec)}
                          className={`rounded-lg px-3 py-1 text-xs ${presetDuration === sec ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}>
                          {labels[sec]}
                        </button>
                      );
                    })}
                  </div>
                )}

                {unlockMode === "custom" && (
                  <div className="flex flex-col gap-2">
                    <input
                      type="datetime-local"
                      value={unlock}
                      onChange={(e) => setUnlock(e.target.value)}
                      className="rounded-lg border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
                    />
                    <span className="text-xs text-gray-500">Timezone: {selectedTimezone}</span>
                  </div>
                )}
              </div>
            )}

            {/* Payment condition */}
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={paymentEnabled} onChange={(e) => setPaymentEnabled(e.target.checked)}
                className="rounded border-gray-600 bg-gray-700 text-blue-500" />
              Payment required to unlock
            </label>

            {paymentEnabled && (
              <div className="ml-6">
                <input
                  type="text"
                  step="0.001"
                  inputMode="decimal"
                  value={paymentInputValue}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === "" || /^\d*\.?\d*$/.test(value)) {
                      setPaymentInputValue(value);

                      if (value && value !== ".") {
                        try {
                          const nextAmount = ethers.parseUnits(value, nativeDecimals).toString();
                          setPaymentAmount(nextAmount);
                        } catch (err) {
                          console.warn("⚠️ Failed to parse FHE payment input", err);
                          setPaymentAmount("0");
                        }
                      } else {
                        setPaymentAmount("0");
                      }
                    }
                  }}
                  placeholder={`Amount in ${nativeSymbol}`}
                  className="w-full rounded-lg border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                />
                <p className="mt-2 text-xs text-gray-500">
                  Example: 0.001 {nativeSymbol}
                </p>
              </div>
            )}
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={!isFormValid || isSubmitting || isUploadingFile}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isUploadingFile ? "📤 Uploading to IPFS..." :
             isSubmitting ? "🔐 Encrypting & Sending..." :
             "🔒 Send FHE-Encrypted Message"}
          </button>

          {isSubmitting && (
            <div className="text-center text-xs text-gray-500">
              <p>Step 1: Uploading content to IPFS ✓</p>
              <p>Step 2: FHE-encrypting unlock time with Zama relayer...</p>
              <p>Step 3: Submitting transaction to Zama FHEVM...</p>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
