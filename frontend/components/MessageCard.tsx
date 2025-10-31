"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useContractWrite, useWaitForTransaction, usePublicClient, useAccount, usePrepareContractWrite, useWalletClient } from "../lib/wagmiCompat";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";
import relativeTime from "dayjs/plugin/relativeTime";
import { sealedMessageAbi } from "../lib/sealedMessageAbi";
import { appConfig } from "../lib/env";
import { useContractAddress } from "../lib/useContractAddress";
import { getChainById, ZERO_ADDRESS, type ChainKey } from "../lib/chains";
import { generateFallbackKeyPair } from "../lib/fallbackKey";
import type { DecryptOptions } from "../lib/decryption";
import { useNetwork } from "../lib/wagmiCompat";
import { IPFSFileDisplay } from "./IPFSFileDisplay";
import { MessagePreview, AttachmentBadge } from "./MessagePreview";
import { MessagePreviewData } from "@/types/message";
import { formatUnits, keccak256 } from "viem";
import { aesGcmDecryptMessage } from "../lib/encryption";

dayjs.extend(duration);
dayjs.extend(relativeTime);

interface MessageCardProps {
  id: bigint;
  sender: string;
  receiver: string;
  unlockTime: bigint;
  unlockDate: string;
  unlocked: boolean;
  isRead: boolean;
  isSent: boolean;
  index: number;
  contractAddress?: string; // ✅ Mesajın hangi contract'tan geldiği (override için)
  onMessageRead?: () => void;
  onHide?: () => void; // Hide message callback
  // V3 ödeme bilgileri
  requiredPayment?: bigint;
  paidAmount?: bigint;
  conditionType?: number;
  // Transaction hash'leri
  transactionHash?: string;
  paymentTxHash?: string;
  // Dosya desteği
  contentType?: number; // 0=TEXT, 1=IPFS_HASH, 2=ENCRYPTED
  fileMetadata?: {
    name: string;
    size: number;
    type: string;
  };
  chainId?: number;
  chainKey?: ChainKey;
  createdAt?: bigint;
  createdDate?: string | null;
}

interface SentPreviewCache {
  payload?: string;
  truncated?: boolean;
  original?: string | null;
  fileMetadata?: {
    fileName?: string | null;
    fileSize?: number | null;
    mimeType?: string | null;
  thumbnail?: string | null; // 25×25 thumbnail (base64)
    dimensions?: { width: number; height: number } | null;
  } | null;
}

const globalTextDecoder = typeof TextDecoder !== "undefined" ? new TextDecoder() : undefined;

const stripHexPrefix = (value: string) => (value.startsWith("0x") ? value.slice(2) : value);

const hexToBytes = (hexValue: string): Uint8Array => {
  const sanitized = stripHexPrefix(hexValue).toLowerCase();
  if (sanitized.length === 0) {
    return new Uint8Array();
  }
  const length = Math.ceil(sanitized.length / 2);
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index++) {
    const sliceStart = sanitized.length - (index + 1) * 2;
    const byteHex = sanitized.slice(Math.max(0, sliceStart), sliceStart + 2);
    const parsed = parseInt(byteHex.padStart(2, "0"), 16);
    if (Number.isNaN(parsed)) {
      throw new Error("Ciphertext contains non-hex characters");
    }
    bytes[length - index - 1] = parsed;
  }
  return bytes;
};

const decodeAscii = (bytes: Uint8Array): string => {
  if (!globalTextDecoder) {
    return "";
  }
  try {
    const raw = globalTextDecoder.decode(bytes).replace(/\0+$/g, "");
    const sanitized = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
    return sanitized.trim().length > 0 ? sanitized.trimEnd() : "";
  } catch (err) {
    console.error("⚠️ ASCII decode failed", err);
    return "";
  }
};

const sanitizeIpfsValue = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  let sanitized = value.trim();
  if (!sanitized) {
    return undefined;
  }
  sanitized = sanitized.replace(/^ipfs:\/\//i, "");
  sanitized = sanitized.replace(/^https?:\/\/[^/]+\/ipfs\//i, "");
  sanitized = sanitized.replace(/^\/+/, "");
  const [cidPart] = sanitized.split(/[?#]/u);
  const cidOnly = cidPart.includes("/") ? cidPart.split("/")[0] : cidPart;
  return cidOnly || undefined;
};

interface NormalizedMetadata {
  type: string;
  shortHash?: string;
  fullHash?: string;
  message?: string;
  ipfs?: string;
  name?: string;
  size?: number;
  mimeType?: string;
  previewText?: string;
  thumbnail?: string;
  dimensions?: { width: number; height: number };
  hasAttachment?: boolean;
  createdAt?: string;
  metadataKeccak?: `0x${string}`;
}

const normaliseMetadataPayload = (
  raw: any,
  context: { shortHash?: string; fullHash?: string } = {}
): NormalizedMetadata => {
  if (!raw || typeof raw !== "object") {
    return {
      type: "unknown",
      shortHash: context.shortHash,
      fullHash: context.fullHash
    };
  }

  const inferredType =
    typeof raw.type === "string"
      ? raw.type
      : raw.ipfs || raw.ipfsHash
      ? "file"
      : "text";

  const normalized: NormalizedMetadata = {
    type: inferredType,
    shortHash:
      typeof raw.shortHash === "string"
        ? raw.shortHash
        : context.shortHash,
    fullHash: sanitizeIpfsValue(context.fullHash) ?? context.fullHash,
    message:
      typeof raw.message === "string"
        ? raw.message
        : typeof raw.content === "string"
        ? raw.content
        : typeof raw.preview?.text === "string"
        ? raw.preview.text
        : undefined,
    previewText:
      typeof raw.preview === "string"
        ? raw.preview
        : typeof raw.preview?.text === "string"
        ? raw.preview.text
        : undefined,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : undefined
  };

  if (normalized.type === "file") {
    // Check for attachment nested object first (new format)
    const attachmentObj = raw.attachment || raw.fileMetadata;
    const previewObj = typeof raw.preview === "object" && raw.preview ? raw.preview : undefined;
    
    const ipfsHash =
      typeof raw.ipfs === "string"
        ? raw.ipfs
        : typeof raw.ipfsHash === "string"
        ? raw.ipfsHash
        : attachmentObj?.ipfsHash;
    normalized.ipfs = sanitizeIpfsValue(ipfsHash);
    normalized.hasAttachment = true;
    
    if (!normalized.previewText && typeof previewObj?.text === "string") {
      normalized.previewText = previewObj.text;
    }
    if (!normalized.thumbnail && typeof previewObj?.thumbnail === "string") {
      normalized.thumbnail = previewObj.thumbnail;
    }
    if (!normalized.dimensions) {
      const dims = previewObj?.dimensions ?? attachmentObj?.dimensions;
      if (dims && typeof dims.width === "number" && typeof dims.height === "number") {
        normalized.dimensions = { width: dims.width, height: dims.height };
      }
    }
    
    const fileName =
      typeof raw.name === "string"
        ? raw.name
        : typeof raw.fileName === "string"
        ? raw.fileName
        : attachmentObj?.fileName
        ? attachmentObj.fileName
        : undefined;
    normalized.name = fileName;

    const sizeValue =
      typeof raw.size === "number"
        ? raw.size
        : typeof raw.fileSize === "number"
        ? raw.fileSize
        : attachmentObj?.fileSize
        ? attachmentObj.fileSize
        : undefined;
    normalized.size =
      typeof sizeValue === "number" && Number.isFinite(sizeValue)
        ? sizeValue
        : undefined;

    const mimeType =
      typeof raw.mimeType === "string"
        ? raw.mimeType
        : typeof raw.fileType === "string"
        ? raw.fileType
        : attachmentObj?.mimeType
        ? attachmentObj.mimeType
        : undefined;
    normalized.mimeType = mimeType ?? "application/octet-stream";
  } else {
    normalized.mimeType =
      typeof raw.mimeType === "string"
        ? raw.mimeType
        : "text/plain; charset=utf-8";
    if (!normalized.message && typeof raw === "string") {
      normalized.message = raw;
    }
  }

  if (typeof raw.metadataKeccak === "string") {
    normalized.metadataKeccak = raw.metadataKeccak as `0x${string}`;
  } else if (typeof raw.keccak === "string") {
    normalized.metadataKeccak = raw.keccak as `0x${string}`;
  }

  return normalized;
};

interface EncryptedMetadataEnvelope {
  ciphertext: string;
  iv: string;
  authTag?: string;
  [key: string]: unknown;
}

const isEncryptedMetadataEnvelope = (value: unknown): value is EncryptedMetadataEnvelope => {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as any).ciphertext === "string" &&
    typeof (value as any).iv === "string"
  );
};

const decryptMetadataEnvelope = async (
  envelope: EncryptedMetadataEnvelope,
  sessionKey: Uint8Array
): Promise<{ parsed: any; plaintextJson: string; metadataKeccak?: `0x${string}` }> => {
  const cipherBytes = hexToBytes(envelope.ciphertext ?? "");
  const authTagBytes = hexToBytes(envelope.authTag ?? "");
  const ivBytes = hexToBytes(envelope.iv ?? "");

  if (cipherBytes.length === 0 || authTagBytes.length === 0 || ivBytes.length === 0) {
    throw new Error("Encrypted metadata envelope missing fields");
  }

  const plaintextJson = await aesGcmDecryptMessage(cipherBytes, authTagBytes, ivBytes, sessionKey);

  try {
    const parsed = JSON.parse(plaintextJson);
    let metadataKeccak: `0x${string}` | undefined;

    if (typeof envelope.keccak === "string") {
      metadataKeccak = envelope.keccak as `0x${string}`;
    } else {
      const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
      if (encoder) {
        metadataKeccak = keccak256(encoder.encode(plaintextJson)) as `0x${string}`;
      }
    }

    return { parsed, plaintextJson, metadataKeccak };
  } catch (err) {
    console.error("❌ Failed to parse decrypted metadata JSON:", err);
    throw err;
  }
};

const formatBigintContent = (value: bigint): string => {
  const bytes = new Uint8Array(32);
  let working = value;
  for (let cursor = bytes.length - 1; cursor >= 0; cursor--) {
    bytes[cursor] = Number(working & 0xffn);
    working >>= 8n;
  }
  const decoded = decodeAscii(bytes);
  if (decoded) {
    return decoded;
  }
  return `0x${value.toString(16).padStart(64, "0")}`;
};

const convertDecryptedValue = (payload: unknown, contentType?: number): string => {
  if (typeof payload === "bigint") {
    if (contentType === 1) {
      return `0x${payload.toString(16)}`;
    }
    const formatted = formatBigintContent(payload);
    
    // ✅ Try to parse as JSON (file metadata)
    try {
      const parsed = JSON.parse(formatted);
      if (parsed && typeof parsed === 'object' && parsed.type === 'file') {
        // Return as is - will be handled in component
        return formatted;
      }
    } catch {
      // Not JSON, return as text
    }
    
    return formatted;
  }
  if (typeof payload === "boolean") {
    return payload ? "true" : "false";
  }
  if (typeof payload === "string") {
    if (!payload) {
      return "";
    }
    if ((contentType === 0 || contentType === undefined) && payload.startsWith("0x")) {
      try {
        const ascii = decodeAscii(hexToBytes(payload));
        return ascii || payload;
      } catch {
        return payload;
      }
    }
    return payload;
  }
  if (payload == null) {
    return "";
  }
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
};

const formatFileSize = (size: bigint | null | undefined): string => {
  if (!size || size <= 0n) {
    return "Belirtilmedi";
  }
  let bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return `${size.toString()} B`;
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let unitIndex = 0;
  while (bytes >= 1024 && unitIndex < units.length - 1) {
    bytes /= 1024;
    unitIndex++;
  }
  const precision = unitIndex === 0 ? 0 : 2;
  return `${bytes.toFixed(precision)} ${units[unitIndex]}`;
};

const trimDecimalString = (raw: string): string => {
  if (!raw.includes(".")) {
    return raw;
  }
  return raw.replace(/(\.\d*?[1-9])0+$/u, "$1").replace(/\.0+$/u, "");
};

const formatPaymentAmount = (
  value: bigint | null | undefined,
  options?: { includeUnit?: boolean; zeroLabel?: string }
): string => {
  const includeUnit = options?.includeUnit ?? true;
  const zeroLabel = options?.zeroLabel ?? (includeUnit ? "Bedelsiz" : "0");

  if (!value || value === 0n) {
    return zeroLabel;
  }

  try {
    const formatted = trimDecimalString(formatUnits(value, 18));
    return includeUnit ? `${formatted} ETH` : formatted;
  } catch {
    const fallback = value.toString();
    return includeUnit ? `${fallback} wei` : fallback;
  }
};

const toBigIntSafe = (value: unknown): bigint => {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    return BigInt(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return BigInt(value);
  }
  if (value && typeof (value as { toString: () => string }).toString === "function") {
    const asString = (value as { toString: () => string }).toString();
    if (asString && asString.trim().length > 0 && asString !== "[object Object]") {
      try {
        return BigInt(asString);
      } catch {
        return 0n;
      }
    }
  }
  return 0n;
};

const toReadableError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
};

export function MessageCard({
  id,
  sender,
  receiver,
  unlockTime,
  unlockDate,
  unlocked,
  isRead,
  isSent,
  index,
  contractAddress: propsContractAddress, // ✅ Props'tan gelen (varsa)
  onMessageRead,
  onHide,
  requiredPayment,
  paidAmount,
  conditionType,
  createdAt,
  createdDate,
  transactionHash,
  paymentTxHash,
  contentType,
  fileMetadata,
  chainId: propsChainId,
  chainKey: propsChainKey
}: MessageCardProps) {
  const { address: userAddress } = useAccount();
  const { data: walletClient } = useWalletClient();
  const hookContractAddress = useContractAddress(); // Hook'tan gelen (current)
  const { chain } = useNetwork();
  const activeChainId = chain?.id;
  const messageChainId = propsChainId ?? activeChainId;
  const client = usePublicClient(
    typeof messageChainId === "number" && Number.isFinite(messageChainId)
      ? { chainId: messageChainId }
      : undefined
  );
  const messageChainConfig = useMemo(() => {
    if (typeof messageChainId !== "number" || !Number.isFinite(messageChainId)) {
      return undefined;
    }
    return getChainById(messageChainId);
  }, [messageChainId]);
  const messageChainKey = propsChainKey;
  const explorerBaseUrl = useMemo(() => {
    if (messageChainConfig?.blockExplorer) {
      return messageChainConfig.blockExplorer;
    }
    const explorerUrl = chain?.blockExplorers?.default?.url;
    return explorerUrl ?? appConfig.chain.explorerUrl ?? "";
  }, [chain, messageChainConfig]);
  const walletOnExpectedChain = useMemo(() => {
    if (typeof messageChainId !== "number" || !Number.isFinite(messageChainId)) {
      return true;
    }
    if (typeof activeChainId !== "number" || !Number.isFinite(activeChainId)) {
      return false;
    }
    return activeChainId === messageChainId;
  }, [activeChainId, messageChainId]);
  const encryptionReady = true;
  const encryptionLoading = false;
  const buildChainQuery = useCallback(() => {
    const params = new URLSearchParams();
    if (messageChainKey) {
      params.set("chainKey", messageChainKey);
    }
    if (typeof messageChainId === "number" && Number.isFinite(messageChainId)) {
      params.set("chainId", messageChainId.toString());
    }
    if (userAddress) {
      params.set("viewer", userAddress);
    }
    const query = params.toString();
    return query ? `?${query}` : "";
  }, [messageChainKey, messageChainId, userAddress]);
  const [prefetchedHandle, setPrefetchedHandle] = useState<unknown | null>(null);
  
  // ✅ Props'tan gelen varsa onu kullan, yoksa hook'tan gelenı kullan
  const resolvedContractAddress = useMemo(() => {
    if (propsContractAddress && propsContractAddress !== ZERO_ADDRESS) {
      return propsContractAddress as `0x${string}`;
    }
    const messageContract = messageChainConfig?.contractAddress;
    if (messageContract && messageContract !== ZERO_ADDRESS) {
      return messageContract as `0x${string}`;
    }
    if (hookContractAddress && hookContractAddress !== ZERO_ADDRESS) {
      return hookContractAddress;
    }
    return undefined;
  }, [propsContractAddress, messageChainConfig, hookContractAddress]);
  const contractAddress = resolvedContractAddress;
  
  // 🔑 Cache key: contract address bazlı (eski contract'larla karışmasın)
  const cacheKey = useMemo(() => {
    if (contractAddress) {
      const prefix = contractAddress.slice(0, 10);
      const chainSuffix = typeof messageChainId === "number" && Number.isFinite(messageChainId)
        ? `-${messageChainId}`
        : "";
      return `${prefix}-msg${chainSuffix}`;
    }
    return "msg";
  }, [contractAddress, messageChainId]);
  
  // localStorage'dan initial state yükle (basit key, sonra cacheKey ile güncellenecek)
  const [messageContent, setMessageContent] = useState<string | null>(null);
  const [activeSessionKey, setActiveSessionKey] = useState<Uint8Array | null>(null);
  const [fileMetadataState, setFileMetadataState] = useState<any>(null);
  const [useThumbnailFallback, setUseThumbnailFallback] = useState(false);
  const [useGatewayFallback, setUseGatewayFallback] = useState(false);
  const [isLoadingFileMetadata, setIsLoadingFileMetadata] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [localUnlocked, setLocalUnlocked] = useState(unlocked);
  const [localIsRead, setLocalIsRead] = useState(isRead);
  const [decryptError, setDecryptError] = useState<string | null>(null);

  useEffect(() => {
    setUseThumbnailFallback(false);
    setUseGatewayFallback(false);
  }, [fileMetadataState, localUnlocked]);

  const normalizedPreviewImageHash = useMemo(() => {
    if (!fileMetadataState) return null;
    const candidate = (
      fileMetadataState.ipfs ||
      fileMetadataState.previewImageHash ||
      fileMetadataState.fullHash ||
      null
    );
    if (!candidate) return null;
    return typeof candidate === 'string' ? candidate : String(candidate);
  }, [fileMetadataState]);

  const resolvedPrimaryImageSrc = normalizedPreviewImageHash
    ? normalizedPreviewImageHash.startsWith('data:')
      ? normalizedPreviewImageHash
      : useGatewayFallback
        ? `https://ipfs.io/ipfs/${normalizedPreviewImageHash}`
        : `/api/ipfs/${normalizedPreviewImageHash}`
    : null;
  const resolvedThumbnailSrc = fileMetadataState?.thumbnail
    ? typeof fileMetadataState.thumbnail === 'string'
      ? fileMetadataState.thumbnail
      : String(fileMetadataState.thumbnail)
    : null;
  const resolvedImageSrc =
    useThumbnailFallback && resolvedThumbnailSrc
      ? resolvedThumbnailSrc
      : resolvedPrimaryImageSrc ?? resolvedThumbnailSrc;
  const isImageAttachment = typeof fileMetadataState?.mimeType === 'string'
    ? fileMetadataState.mimeType.toLowerCase().startsWith('image/')
    : false;
  const downloadSourceHash = fileMetadataState?.ipfs
    ? (() => {
        const candidate = String(fileMetadataState.ipfs);
        return candidate.startsWith('data:') ? null : candidate;
      })()
    : normalizedPreviewImageHash && !normalizedPreviewImageHash.startsWith('data:')
      ? normalizedPreviewImageHash
      : null;
  const resolvedDownloadUrl = downloadSourceHash
    ? useGatewayFallback
      ? `https://ipfs.io/ipfs/${downloadSourceHash}`
      : `/api/ipfs/${downloadSourceHash}`
    : null;
  const trimmedMessageContent = useMemo(
    () => (typeof messageContent === 'string' ? messageContent.trim() : ''),
    [messageContent]
  );
  const canShowUnlockedPreview = Boolean(trimmedMessageContent) && !decryptError;
  
  // 📋 PREVIEW METADATA: Locked mesaj bilgileri
  const [previewMetadata, setPreviewMetadata] = useState<{
    fileName: string;
    fileSize: bigint;
    contentType: string;
    previewImageHash: string;
	thumbnail?: string; // 25×25 thumbnail (base64)
    dimensions?: { width: number; height: number }; // Original image dimensions
    hasAttachment?: boolean;
    previewText?: string;
    isImage?: boolean;
  } | null>(null);
  const [isLoadingPreviewMeta, setIsLoadingPreviewMeta] = useState(false);
  
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewPollAttempts, setPreviewPollAttempts] = useState(0);
  const [previewPollingDisabled, setPreviewPollingDisabled] = useState(false);
  const [sentPreviewInfo, setSentPreviewInfo] = useState<SentPreviewCache | null>(null);
  
  // ✅ YENİ: Payment bilgisi state
  const [requiredPaymentAmount, setRequiredPaymentAmount] = useState<bigint | null>(null);
  const [paidAmountOnchain, setPaidAmountOnchain] = useState<bigint | null>(null);

  // Keep track of metadata hashes we already tried to resolve to avoid repeated 404 spam
  const attemptedMetadataHashesRef = useRef<Set<string>>(new Set());
  const missingMetadataHashCacheKeyPrefix = 'metadata-hash-missing-';
  const missingMetadataHashRecheckMs = 6 * 60 * 60 * 1000; // 6 saat sonra tekrar dene
  const [conditionMask, setConditionMask] = useState<number>(0);
  const [metadataLoaded, setMetadataLoaded] = useState(false);
  const [isLoadingPaymentInfo, setIsLoadingPaymentInfo] = useState(false);
  const [manualPaymentHash, setManualPaymentHash] = useState<`0x${string}` | null>(null);
  const [isManualPaymentPending, setIsManualPaymentPending] = useState(false);
  const [onchainUnlocked, setOnchainUnlocked] = useState<boolean | null>(null);
  const metadataReadyRef = useRef(false);

  useEffect(() => {
    setConditionMask(0);
    setRequiredPaymentAmount(null);
    setMetadataLoaded(false);
    setOnchainUnlocked(null);
    setActiveSessionKey(null);
    metadataReadyRef.current = false;
  }, [id, contractAddress]);

  useEffect(() => {
    if (!isSent) {
      return;
    }

    const nextConditionMask = typeof conditionType === "number" ? conditionType : 0;
    const nextRequiredPayment = typeof requiredPayment === "bigint" ? requiredPayment : 0n;
    const nextPaidAmount = typeof paidAmount === "bigint" ? paidAmount : 0n;

    setConditionMask(nextConditionMask);
    setRequiredPaymentAmount(nextRequiredPayment);
    setPaidAmountOnchain(nextPaidAmount);
    setOnchainUnlocked(Boolean(unlocked));
    setMetadataLoaded(true);
    metadataReadyRef.current = true;
  }, [isSent, conditionType, requiredPayment, paidAmount, unlocked]);

  // 🔄 localStorage'dan cache'i yükle (cacheKey hazır olduğunda)
  useEffect(() => {
    if (typeof window === 'undefined' || !cacheKey) return;
    
  const legacyKey = `${cacheKey}-sent-preview-${id}`;
  const sentPreview = localStorage.getItem(legacyKey) ?? localStorage.getItem(`sent-preview-${id}`);
    if (sentPreview) {
      try {
        const parsed = JSON.parse(sentPreview) as SentPreviewCache;
          if (parsed && typeof parsed === 'object') {
            setSentPreviewInfo(parsed);
            if (parsed.fileMetadata) {
            const { fileName, fileSize, mimeType, thumbnail } = parsed.fileMetadata;
            const normalizedMimeType = typeof mimeType === 'string' ? mimeType : '';
            const isImageMime = normalizedMimeType.toLowerCase().startsWith('image/');
            setPreviewMetadata({
              fileName: fileName ?? '',
              fileSize: BigInt(Math.max(0, Math.floor(fileSize ?? 0))),
              contentType: normalizedMimeType,
              previewImageHash: '',
              thumbnail: isImageMime && typeof thumbnail === 'string' ? thumbnail : undefined,
              isImage: isImageMime
            });
          }
        }
      } catch (err) {
        console.warn('⚠️ Failed to parse sent preview cache', err);
      }
    }

    const cachedContent = localStorage.getItem(`${cacheKey}-content-${id}`);
    const cachedExpanded = localStorage.getItem(`${cacheKey}-expanded-${id}`) === 'true';
    const cachedRead = localStorage.getItem(`${cacheKey}-read-${id}`) === 'true';
    const cachedUnlocked = localStorage.getItem(`${cacheKey}-unlocked-${id}`) === 'true';
    
    if (cachedContent) setMessageContent(cachedContent);
    if (cachedExpanded) setIsExpanded(true);
    if (cachedRead) setLocalIsRead(true);
    if (cachedUnlocked) setLocalUnlocked(true);
  }, [cacheKey, id]);

  useEffect(() => {
    setPreviewPollAttempts(0);
    setPreviewPollingDisabled(false);
    setPreviewDataUrl(null);
    setPreviewError(null);
    setPreviewMetadata(null);
    setFileMetadataState(null);
  }, [id]);

  useEffect(() => {
    metadataReadyRef.current = metadataLoaded;
  }, [metadataLoaded, metadataReadyRef]);

  useEffect(() => {
    if (unlocked) {
      setLocalUnlocked(true);
    }
  }, [unlocked]);

  useEffect(() => {
    if (isRead) {
      setLocalIsRead(true);
    }
  }, [isRead]);

  const ensureOnchainUnlocked = useCallback(async (): Promise<boolean> => {
    if (!client || !contractAddress || isSent) {
      setMetadataLoaded(true);
      metadataReadyRef.current = true;
      return true;
    }

    if (!userAddress) {
      setMetadataLoaded(false);
      metadataReadyRef.current = false;
      return false;
    }

    const cachedUnlocked = typeof window !== 'undefined' && cacheKey
      ? localStorage.getItem(`${cacheKey}-unlocked-${id}`) === 'true'
      : false;

    try {
      const result = await client.readContract({
        address: contractAddress,
        abi: sealedMessageAbi as any,
        functionName: "getMessageFinancialView",
        args: [id],
        account: userAddress as `0x${string}`
      }) as any;

      // getMessageFinancialView returns a struct: { unlockTime, requiredPayment, paidAmount, conditionMask, isUnlocked }
      const metadata = result.viewData || result; // Handle both wrapped and unwrapped responses
      
      const metadataUnlockedRaw = Boolean(metadata.isUnlocked);
      const fetchedConditionMask = Number(metadata.conditionMask);
      const paymentAmount = toBigIntSafe(metadata.requiredPayment);
      const paidAmount = toBigIntSafe(metadata.paidAmount);

      const effectiveUnlocked = metadataUnlockedRaw || cachedUnlocked;

      setConditionMask(fetchedConditionMask);
      setRequiredPaymentAmount(paymentAmount);
      setPaidAmountOnchain(paidAmount);
      setMetadataLoaded(true);
      metadataReadyRef.current = true;
      setOnchainUnlocked(metadataUnlockedRaw);

      setLocalUnlocked((prev) => {
        const next = effectiveUnlocked || prev;
        if (next && typeof window !== 'undefined' && cacheKey) {
          localStorage.setItem(`${cacheKey}-unlocked-${id}`, 'true');
        }
        return next;
      });

      return effectiveUnlocked;
    } catch (err) {
      console.warn("⚠️ On-chain unlock check failed", err);
      if (cachedUnlocked) {
        setLocalUnlocked(true);
        setMetadataLoaded(true);
        metadataReadyRef.current = true;
        return true;
      }
      metadataReadyRef.current = false;
      return false;
    }
  }, [client, contractAddress, id, isSent, cacheKey]);

  useEffect(() => {
    if (isSent) {
      return;
    }

    const unlockSeconds = Number(unlockTime);
    if (!Number.isFinite(unlockSeconds) || unlockSeconds <= 0) {
      return;
    }

    const unlockMs = unlockSeconds * 1000;
    const triggerCheck = () => {
      void ensureOnchainUnlocked();
    };

    if (Date.now() >= unlockMs) {
      triggerCheck();
    }

    const msUntilUnlock = unlockMs - Date.now();
    const timeoutId = msUntilUnlock > 0 ? window.setTimeout(triggerCheck, msUntilUnlock) : undefined;
    const intervalId = window.setInterval(triggerCheck, 15000);

    return () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      clearInterval(intervalId);
    };
  }, [unlockTime, ensureOnchainUnlocked, isSent]);

  // ✅ Ödeme bilgisi artık getMessageFinancialView üzerinden geliyor; ayrı bir fetch yok
  useEffect(() => {
    if (!metadataLoaded) {
      setIsLoadingPaymentInfo(true);
      return;
    }
    if ((conditionMask & 0x02) === 0) {
      setIsLoadingPaymentInfo(false);
      return;
    }
    setIsLoadingPaymentInfo(requiredPaymentAmount == null || paidAmountOnchain == null);
  }, [metadataLoaded, conditionMask, requiredPaymentAmount, paidAmountOnchain]);

  // 📋 PREVIEW METADATA: Fetch file preview info from IPFS
  const fetchPreviewMetadata = useCallback(async () => {
    if (!client || !contractAddress || !userAddress) return;

    setIsLoadingPreviewMeta(true);
    try {
  const metadataCidKey = `${cacheKey}-metadata-cid-${id}`;
  const legacyMetadataKey = `metadata-cid-${id}`;
  const publicMetadataCidKey = `${cacheKey}-public-metadata-cid-${id}`;
  const legacyPublicMetadataKey = `public-metadata-cid-${id}`;

      const message = await client.readContract({
        address: contractAddress,
        abi: sealedMessageAbi,
        functionName: "getMessage",
        args: [id],
        account: userAddress as `0x${string}`
      }) as any;

      const uri = (message[2] ?? "") as string;
      const metadataHashRaw = (message[6] ?? "") as string;

      const zeroHash = "0x0000000000000000000000000000000000000000000000000000000000000000";
      const normalizedMetadataHash = typeof metadataHashRaw === "string" ? metadataHashRaw.toLowerCase() : "";
      const hasMetadataHash = Boolean(normalizedMetadataHash && normalizedMetadataHash !== zeroHash);

      const shortHashMatch = uri.includes("F:") ? uri.match(/F:([a-zA-Z0-9]{6,8})/) : null;
      const shortHashFromUri = shortHashMatch ? shortHashMatch[1] : null;

      const applyNormalizedMetadata = (normalized: NormalizedMetadata) => {
        const resolvedPreviewText = isSent
          ? normalized.message || normalized.previewText
          : undefined;

        setPreviewMetadata({
          fileName: normalized.name || "",
          fileSize: BigInt(normalized.size || 0),
          contentType: normalized.mimeType || "",
          previewImageHash: normalized.ipfs || normalized.fullHash || "",
          thumbnail: normalized.thumbnail,
          dimensions: normalized.dimensions,
          hasAttachment: normalized.hasAttachment ?? normalized.type === "file",
          previewText: resolvedPreviewText,
          isImage: typeof normalized.mimeType === "string" ? normalized.mimeType.toLowerCase().startsWith("image/") : undefined
        });

        if (typeof window !== "undefined" && cacheKey && normalized.shortHash) {
          try {
            window.localStorage.setItem(`${cacheKey}-metadata-${normalized.shortHash}`, JSON.stringify(normalized));
          } catch (cacheErr) {
            console.warn("⚠️ Failed to cache preview metadata:", cacheErr);
          }
        }
      };

      const fetchAndValidateMetadata = async (
        cid: string,
        options: { skipHashValidation?: boolean } = {}
      ): Promise<{ normalized: NormalizedMetadata | null; mismatch: boolean }> => {
        const { skipHashValidation = false } = options;
        const sanitizedCid = cid.replace(/^ipfs:\/\//i, "");
        try {
          const response = await fetch(`/api/ipfs/${sanitizedCid}`, { cache: "no-store" });
          if (!response.ok) {
            throw new Error(`API returned ${response.status}`);
          }

          const contentType = response.headers.get("content-type") || "";
          if (!contentType.includes("application/json") && !contentType.includes("text/")) {
            return { normalized: null, mismatch: false };
          }

          const rawText = await response.text();
          if (!rawText) {
            return { normalized: null, mismatch: false };
          }

          let parsed: unknown;
          try {
            parsed = JSON.parse(rawText);
          } catch {
            parsed = null;
          }

          if (!parsed || typeof parsed !== "object") {
            return { normalized: null, mismatch: false };
          }

          if (isEncryptedMetadataEnvelope(parsed)) {
            if (hasMetadataHash) {
              const keccakFromEnvelope = typeof parsed.keccak === "string" ? parsed.keccak.toLowerCase() : undefined;
              if (keccakFromEnvelope && keccakFromEnvelope !== normalizedMetadataHash) {
                console.warn(`⚠️ Encrypted metadata keccak mismatch for CID ${sanitizedCid}. Expected ${normalizedMetadataHash}, got ${keccakFromEnvelope}`);
                return { normalized: null, mismatch: true };
              }
            }

            if (!activeSessionKey) {
              return { normalized: null, mismatch: false };
            }

            try {
              const { parsed: decrypted, metadataKeccak } = await decryptMetadataEnvelope(parsed, activeSessionKey);
              const normalized = normaliseMetadataPayload(decrypted, {
                shortHash: shortHashFromUri ?? undefined,
                fullHash: sanitizedCid
              });
              if (metadataKeccak) {
                normalized.metadataKeccak = metadataKeccak;
              }
              return { normalized, mismatch: false };
            } catch (decryptErr) {
              console.error("❌ Failed to decrypt metadata envelope for preview:", decryptErr);
              return { normalized: null, mismatch: false };
            }
          }

          if (hasMetadataHash && !skipHashValidation) {
            const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
            if (!encoder) {
              console.warn("⚠️ TextEncoder unavailable, skipping metadata hash validation.");
            } else {
              const computedHash = keccak256(encoder.encode(rawText));
              if (computedHash.toLowerCase() !== normalizedMetadataHash) {
                console.warn(`⚠️ Metadata keccak mismatch for CID ${sanitizedCid}. Expected ${normalizedMetadataHash}, got ${computedHash}`);
                return { normalized: null, mismatch: true };
              }
            }
          }

          const normalized = normaliseMetadataPayload(parsed, {
            shortHash: shortHashFromUri ?? undefined,
            fullHash: sanitizedCid
          });

          return { normalized, mismatch: false };
        } catch (err) {
          console.warn("⚠️ API metadata fetch failed:", err instanceof Error ? err.message : err);
          return { normalized: null, mismatch: false };
        }
      };

      if (typeof window !== "undefined") {
        try {
          window.localStorage.removeItem(legacyMetadataKey);
        } catch (storageErr) {
          console.warn("⚠️ Failed to remove legacy metadata cache:", storageErr);
        }
        try {
          window.localStorage.removeItem(legacyPublicMetadataKey);
        } catch (storageErr) {
          console.warn("⚠️ Failed to remove legacy public metadata cache:", storageErr);
        }

        const cachedPublicCid = window.localStorage.getItem(publicMetadataCidKey);
        if (cachedPublicCid) {
          const { normalized } = await fetchAndValidateMetadata(cachedPublicCid, { skipHashValidation: true });
          if (normalized) {
            applyNormalizedMetadata(normalized);
            return;
          }
          window.localStorage.removeItem(publicMetadataCidKey);
        }

        const cachedCid = window.localStorage.getItem(metadataCidKey);
        if (cachedCid) {
          const { normalized, mismatch } = await fetchAndValidateMetadata(cachedCid);
          if (normalized) {
            applyNormalizedMetadata(normalized);
            return;
          }
          if (mismatch) {
            window.localStorage.removeItem(metadataCidKey);
          }
        }
      }

      let candidateCid: string | null = null;
      let publicCandidateCid: string | null = null;

      if (shortHashFromUri && typeof window !== "undefined") {
        try {
          const stored = window.localStorage.getItem(`file-public-metadata-${shortHashFromUri}`);
          if (stored) {
            publicCandidateCid = stored;
          }
        } catch (err) {
          console.warn("⚠️ Failed to read public metadata short-hash cache:", err);
        }
      }

      if (hasMetadataHash) {
        const attempts = attemptedMetadataHashesRef.current;

        if (typeof window !== "undefined") {
          try {
            const cacheEntryKey = `${missingMetadataHashCacheKeyPrefix}${normalizedMetadataHash}`;
            const cached = window.localStorage.getItem(cacheEntryKey);
            if (cached) {
              const parsed = JSON.parse(cached);
              const tsValue = typeof parsed?.ts === "number" ? parsed.ts : Number(parsed?.ts);
              if (Number.isFinite(tsValue)) {
                const age = Date.now() - tsValue;
                if (age < missingMetadataHashRecheckMs) {
                  console.debug("⏳ Skipping metadata hash lookup (recent 404 cache):", normalizedMetadataHash);
                  attempts.add(normalizedMetadataHash);
                }
              }
            }
          } catch (cacheErr) {
            console.warn("⚠️ Failed to read metadata hash 404 cache:", cacheErr);
          }
        }

        if (!attempts.has(normalizedMetadataHash)) {
          attempts.add(normalizedMetadataHash);

          try {
            const keccakRes = await fetch(`/api/metadata-mapping/by-metadata/${metadataHashRaw}`, { cache: "no-store" });
            if (keccakRes.ok) {
              const data = await keccakRes.json();
              const fullCid = data?.record?.fullHash;
              const publicCid = data?.record?.publicHash;
              if (fullCid) {
                candidateCid = String(fullCid);
              }
              if (publicCid) {
                publicCandidateCid = String(publicCid);
              }
            } else if (keccakRes.status === 404) {
              console.info("ℹ️ Metadata hash not found in mapping yet (404). Falling back to alternate resolution.");

              if (typeof window !== "undefined") {
                try {
                  const cacheEntryKey = `${missingMetadataHashCacheKeyPrefix}${normalizedMetadataHash}`;
                  const cachePayload = {
                    ts: Date.now(),
                    id: typeof id === "bigint" ? id.toString() : id ?? null
                  };
                  window.localStorage.setItem(cacheEntryKey, JSON.stringify(cachePayload));
                } catch (cacheErr) {
                  console.warn("⚠️ Failed to persist metadata hash 404 cache:", cacheErr);
                }
              }
            } else {
              console.warn("⚠️ Metadata hash resolution failed with status:", keccakRes.status);
            }
          } catch (err) {
            console.warn("⚠️ Failed to resolve metadata hash via API:", err);
          }
        } else {
          console.debug("🔁 Metadata hash resolution already attempted for this message. Skipping direct lookup.");
        }
      }

      if ((!candidateCid || !publicCandidateCid) && shortHashFromUri) {
        try {
          const mappingRes = await fetch(`/api/metadata-mapping/${shortHashFromUri}`, { cache: "no-store" });
          if (mappingRes.ok) {
            const data = await mappingRes.json();
            const fullCid = data?.record?.fullHash;
            const publicCid = data?.record?.publicHash;
            if (fullCid) {
              candidateCid = String(fullCid);
            }
            if (publicCid) {
              publicCandidateCid = String(publicCid);
            }

            if (fullCid && hasMetadataHash) {
              try {
                await fetch("/api/metadata-mapping", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    shortHash: shortHashFromUri,
                    fullHash: fullCid,
                    metadataKeccak: metadataHashRaw,
                    publicHash: publicCid ?? undefined
                  })
                });
              } catch (persistErr) {
                console.warn("⚠️ Failed to persist metadata keccak for short hash mapping:", persistErr);
              }
            }
          }
        } catch (err) {
          console.warn("⚠️ Failed to resolve short hash:", err);
        }
      }

      if (!publicCandidateCid && shortHashFromUri && typeof window !== "undefined") {
        try {
          const stored = window.localStorage.getItem(`file-public-metadata-${shortHashFromUri}`);
          if (stored) {
            publicCandidateCid = stored;
          }
        } catch (err) {}
      }

      if (!candidateCid) {
        candidateCid = uri.replace(/^ipfs:\/\//i, "");
      }

      if (publicCandidateCid) {
        const { normalized } = await fetchAndValidateMetadata(publicCandidateCid, { skipHashValidation: true });
        if (normalized) {
          applyNormalizedMetadata(normalized);
          if (typeof window !== "undefined") {
            try {
              window.localStorage.setItem(publicMetadataCidKey, publicCandidateCid);
            } catch (storageErr) {
              console.warn("⚠️ Failed to cache public metadata CID:", storageErr);
            }
            if (shortHashFromUri) {
              try {
                window.localStorage.setItem(`file-public-metadata-${shortHashFromUri}`, publicCandidateCid);
              } catch (storageErr) {
                console.warn("⚠️ Failed to cache public metadata short-hash mapping:", storageErr);
              }
            }
          }
          return;
        }
      }

      if (!candidateCid || candidateCid.length === 0 || candidateCid.toLowerCase().includes("stub")) {
        setPreviewMetadata(null);
        return;
      }

      const { normalized, mismatch } = await fetchAndValidateMetadata(candidateCid);

      if (normalized) {
        applyNormalizedMetadata(normalized);
        if (typeof window !== "undefined") {
          try {
            window.localStorage.setItem(metadataCidKey, candidateCid);
          } catch (storageErr) {
            console.warn("⚠️ Failed to cache metadata CID:", storageErr);
          }
        }
        return;
      }

      if (mismatch && typeof window !== "undefined") {
        window.localStorage.removeItem(metadataCidKey);
      }

      const sentCache = isSent && typeof window !== "undefined"
        ? (() => {
            const namespacedKey = `${cacheKey}-sent-preview-${id}`;
            const cached = window.localStorage.getItem(namespacedKey);
            if (!cached) {
              window.localStorage.removeItem(`sent-preview-${id}`);
            }
            return cached;
          })()
        : null;

      if (isSent && sentCache) {
        try {
          const parsed = JSON.parse(sentCache);
          if (parsed.fileMetadata) {
            const fallbackMime = typeof parsed.fileMetadata.mimeType === "string" ? parsed.fileMetadata.mimeType : "";
            const isImageMime = fallbackMime.toLowerCase().startsWith("image/");
            const fallbackThumbnail = isImageMime && typeof parsed.fileMetadata.thumbnail === "string"
              ? parsed.fileMetadata.thumbnail
              : undefined;
            const fallbackDimensions = isImageMime && parsed.fileMetadata.dimensions && typeof parsed.fileMetadata.dimensions.width === "number" && typeof parsed.fileMetadata.dimensions.height === "number"
              ? parsed.fileMetadata.dimensions
              : undefined;
            setPreviewMetadata({
              fileName: parsed.fileMetadata.fileName || "",
              fileSize: BigInt(parsed.fileMetadata.fileSize || 0),
              contentType: fallbackMime,
              previewImageHash: "",
              thumbnail: fallbackThumbnail,
              dimensions: fallbackDimensions,
              hasAttachment: true,
              previewText: typeof parsed.original === "string" ? parsed.original : undefined,
              isImage: isImageMime
            });
            return;
          }
        } catch (e) {
          console.warn("Failed to parse localStorage fallback:", e);
        }
      }

      setPreviewMetadata(null);
    } catch (err) {
      console.warn("⚠️ Failed to fetch preview metadata", err);
      setPreviewMetadata(null);
    } finally {
      setIsLoadingPreviewMeta(false);
    }
  }, [
    attemptedMetadataHashesRef,
    cacheKey,
    client,
    contractAddress,
    id,
    userAddress,
    missingMetadataHashCacheKeyPrefix,
    missingMetadataHashRecheckMs,
    activeSessionKey
  ]);

  // Preview metadata fetch et (mesaj card render edildiğinde)
  useEffect(() => {
    void fetchPreviewMetadata();
  }, [fetchPreviewMetadata]);

  // ✅ Component mount olduğunda metadata'yı hemen yükle
  useEffect(() => {
    if (isSent) return;
    void ensureOnchainUnlocked();
  }, [ensureOnchainUnlocked, isSent]);

  useEffect(() => {
    if (isSent || localUnlocked) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void ensureOnchainUnlocked();
    }, 12000);

    void ensureOnchainUnlocked();

    return () => {
      clearInterval(intervalId);
    };
  }, [ensureOnchainUnlocked, isSent, localUnlocked]);

  useEffect(() => {
    if (localUnlocked || isSent || previewDataUrl || previewPollingDisabled) {
      return;
    }

    if (!userAddress) {
      return;
    }

    let cancelled = false;
    let intervalId: number | undefined;

    const attemptFetch = async () => {
      if (cancelled) {
        return;
      }
      try {
        setIsLoadingPreview(true);
        setPreviewError(null);
  const previewUrl = `/api/message-preview/${id.toString()}${buildChainQuery()}`;
        const res = await fetch(previewUrl, { cache: "no-store" });
        if (!res.ok) {
          if (res.status === 404) {
            setPreviewPollAttempts((prev) => {
              const next = prev + 1;
              if (next >= 3) {
                setPreviewPollingDisabled(true);
              }
              return next;
            });
            return;
          }
          if (res.status === 401 || res.status === 403) {
            setPreviewError('Wallet not authorized to preview this message yet.');
            setPreviewPollingDisabled(true);
            return;
          }
          throw new Error(`Preview fetch failed with status ${res.status}`);
        }
        const json = await res.json();
        const record = (json?.record ?? json) as {
          previewDataUrl?: string;
          fileName?: string | null;
          mimeType?: string | null;
        } | undefined;
        const candidate = typeof record?.previewDataUrl === "string" ? record.previewDataUrl : undefined;
        if (record && (record.fileName || record.mimeType)) {
          setPreviewMetadata((current) => {
            const normalizedMime = typeof record.mimeType === "string" ? record.mimeType : current?.contentType ?? "";
            const lowerMime = normalizedMime.toLowerCase();
            const mimeIsImage = lowerMime.startsWith("image/");

            // Preserve existing metadata while filling gaps.
            return {
              fileName: record.fileName ?? current?.fileName ?? "",
              fileSize: current?.fileSize ?? 0n,
              contentType: normalizedMime,
              previewImageHash: mimeIsImage ? current?.previewImageHash ?? "" : "",
              thumbnail: mimeIsImage ? current?.thumbnail : undefined,
              dimensions: mimeIsImage ? current?.dimensions : undefined,
              hasAttachment: true,
              previewText: current?.previewText,
              isImage: current?.isImage ?? mimeIsImage
            };
          });
        }
        if (!cancelled && candidate) {
          setPreviewDataUrl(candidate);
          setPreviewError(null);
          setPreviewPollingDisabled(true);
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('Preview fetch failed', err);
          setPreviewError('Preview unavailable');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingPreview(false);
        }
      }
    };

    void attemptFetch();
    intervalId = window.setInterval(() => {
      if (!cancelled && !previewDataUrl && !previewPollingDisabled) {
        void attemptFetch();
      }
    }, 15000);

    return () => {
      cancelled = true;
      if (intervalId !== undefined) {
        clearInterval(intervalId);
      }
    };
  }, [id, localUnlocked, isSent, previewDataUrl, previewPollingDisabled, buildChainQuery, userAddress]);

  const decryptCiphertext = useCallback(async (handleValue: unknown) => {
    let currentDecryptOptions: DecryptOptions | undefined;

    const normalizeAddress = (value: unknown): string =>
      typeof value === 'string' ? value.toLowerCase() : '';

    const resolveReceiverPublicKeyBytes = async (receiverAddress: string): Promise<Uint8Array | null> => {
      if (typeof receiverAddress !== 'string' || !receiverAddress.startsWith('0x')) {
        return null;
      }

      let onchainKey: string | null = null;

      if (client && contractAddress) {
        try {
          onchainKey = await client.readContract({
            address: contractAddress,
            abi: sealedMessageAbi as any,
            functionName: "getEncryptionKey" as any,
            args: [receiverAddress as `0x${string}`]
          }) as unknown as string;

        } catch (err) {
          console.warn('⚠️ Failed to fetch receiver public key from contract:', err);
        }
      }

      if (onchainKey && onchainKey !== '0x' && onchainKey.length >= 66) {
        return hexToBytes(onchainKey);
      }

      try {
        const fallback = generateFallbackKeyPair(receiverAddress);
        return new Uint8Array(fallback.publicKey);
      } catch (fallbackErr) {
        console.warn('⚠️ Failed to derive fallback receiver key:', fallbackErr);
        return null;
      }
    };

    const processDecryptResponse = async (
      payload: {
        messageId?: string;
        uri?: string;
        iv?: string;
        authTag?: string;
        ciphertextHash?: string;
        escrowCiphertext?: string;
        escrowIv?: string;
        escrowAuthTag?: string;
        sessionKeyCommitment?: string;
        receiverEnvelopeHash?: string;
        escrowKeyVersion?: number;
      },
      debugInfo?: Record<string, unknown>
    ) => {
      const {
        messageId,
        uri,
        iv,
        authTag,
        ciphertextHash,
        escrowCiphertext,
        escrowIv,
        escrowAuthTag,
        sessionKeyCommitment,
        receiverEnvelopeHash,
        escrowKeyVersion
      } = payload;

      if (!uri) {
        throw new Error('Message URI missing');
      }

      if (!sessionKeyCommitment) {
        console.warn('⚠️ Session key commitment missing for escrow-protected message', {
          receiverEnvelopeHash,
          escrowKeyVersion,
          debugInfo
        });
        throw new Error('Session key commitment unavailable for decrypt request');
      }

      const decryptRequestPayload: Record<string, unknown> = {
        messageId: messageId ?? id.toString(),
        uri,
        iv,
        authTag,
        ciphertextHash,
        sessionKeyCommitment,
        receiverEnvelopeHash,
        escrowCiphertext,
        escrowIv,
        escrowAuthTag
      };

      if (typeof messageChainId === 'number' && Number.isFinite(messageChainId)) {
        decryptRequestPayload.chainId = messageChainId;
      }
      if (messageChainKey) {
        decryptRequestPayload.chainKey = messageChainKey;
      }
      if (userAddress) {
        decryptRequestPayload.viewerAddress = userAddress;
      }

      const response = await fetch('/api/decrypt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(decryptRequestPayload)
      });

      if (!response.ok) {
        const text = await response.text().catch(() => response.statusText);
        throw new Error(`Decrypt API error ${response.status}: ${text}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Decrypt API failed');
      }

      if (result.isStub && result.decrypted) {
        return result.decrypted as string;
      }

      if (result.ciphertextHashVerified === false) {
        console.warn('⚠️ Ciphertext hash mismatch reported by API');
      }

      const hasCiphertext = typeof result.ciphertext === 'string' && result.ciphertext.length > 2;
      const hasEnvelope = result.receiverEnvelope && typeof result.receiverEnvelope?.ciphertext === 'string';

      if (!hasCiphertext || !hasEnvelope) {
        const metadataSections: string[] = [];

        if (result.decrypted && typeof result.decrypted === 'string') {
          metadataSections.push(`Preview text:\n${result.decrypted}`);
        }

        if (typeof result.message === 'string' && result.message.trim().length > 0) {
          metadataSections.push(`API message: ${result.message}`);
        }

        if (result.metadata) {
          try {
            metadataSections.push(`Metadata JSON:\n${JSON.stringify(result.metadata, null, 2)}`);
          } catch {
            metadataSections.push('Metadata JSON: [unable to stringify]');
          }
        }

        if (result.note && typeof result.note === 'string') {
          metadataSections.push(`Note: ${result.note}`);
        }

        if (metadataSections.length) {
          return [
            '🔓 IPFS metadata retrieved (encryption pipeline not ready yet)',
            ...metadataSections
          ].join('\n\n');
        }

        throw new Error('Encrypted payload not available yet');
      }

      // Import crypto utilities for real decryption
      const { hexToBytes } = await import('@/lib/crypto');
      const { decryptMessage } = await import('@/lib/decryption');

      const ciphertextBytes = hexToBytes(result.ciphertext);
      const authTagBytes = hexToBytes(result.authTag ?? authTag ?? '');
      const ivBytes = hexToBytes(result.iv ?? iv ?? '');
      const senderPubKeyBytes = hexToBytes(result.senderPublicKey ?? '');
      const envelopeCipherBytes = hexToBytes(result.receiverEnvelope?.ciphertext ?? '');
      const envelopeIvBytes = hexToBytes(result.receiverEnvelope?.iv ?? '');
      const envelopeAuthTagBytes = hexToBytes(result.receiverEnvelope?.authTag ?? '');
      const sessionCommitmentHex = result.sessionKeyCommitment ?? sessionKeyCommitment ?? undefined;

      if (senderPubKeyBytes.length !== 33) {
        throw new Error('Sender public key missing in release payload');
      }

      if (envelopeCipherBytes.length === 0 || envelopeIvBytes.length === 0 || envelopeAuthTagBytes.length === 0) {
        throw new Error('Receiver envelope incomplete in release payload');
      }

      // Check if we have wallet access for decryption
      if (typeof window !== 'undefined' && (window as any).ethereum && userAddress) {
        try {
          const { ethers } = await import('ethers');
          const provider = new ethers.BrowserProvider((window as any).ethereum);
          const signer = await provider.getSigner();

          // Create wallet client wrapper
          const walletClient = {
            signMessage: async ({ message }: { account?: string; message: string }) => {
              return await signer.signMessage(message);
            }
          };

          const { plaintext: decrypted, sessionKey } = await decryptMessage({
            ciphertext: ciphertextBytes,
            authTag: authTagBytes,
            iv: ivBytes,
            senderPublicKey: senderPubKeyBytes,
            receiverEnvelope: {
              ciphertext: envelopeCipherBytes,
              iv: envelopeIvBytes,
              authTag: envelopeAuthTagBytes
            },
            sessionKeyCommitment: sessionCommitmentHex,
            walletClient,
            userAddress,
            options: currentDecryptOptions
          });

          setActiveSessionKey(sessionKey);

          // ✅ If decrypted content is a file pointer, resolve metadata immediately
          if (decrypted.startsWith('F:')) {
            const shortHash = decrypted.substring(2).trim();
            
            try {
              // Try localStorage first
              const mappingKey = `file-metadata-${shortHash}`;
              let fullHash = localStorage.getItem(mappingKey);
              
              // If not in localStorage, try backend API
              if (!fullHash) {
                const res = await fetch(`/api/metadata-mapping/${shortHash}`, { cache: 'no-store' });
                if (res.ok) {
                  const data = await res.json();
                  fullHash = data?.record?.fullHash;
                  if (fullHash) {
                    localStorage.setItem(mappingKey, fullHash);
                  }
                }
              }
              
              // Fetch actual metadata from IPFS
              if (fullHash) {
                const metaRes = await fetch(`/api/ipfs/${fullHash}`, { cache: 'no-store' });
                if (metaRes.ok) {
                  const metadata = await metaRes.json();

                  let normalized: NormalizedMetadata | null = null;
                  if (isEncryptedMetadataEnvelope(metadata)) {
                    try {
                      const { parsed, metadataKeccak } = await decryptMetadataEnvelope(metadata, sessionKey);
                      normalized = normaliseMetadataPayload(parsed, { shortHash, fullHash });
                      if (metadataKeccak) {
                        normalized.metadataKeccak = metadataKeccak;
                      }
                    } catch (envErr) {
                      console.error('❌ Failed to decrypt metadata envelope during read:', envErr);
                    }
                  } else {
                    normalized = normaliseMetadataPayload(metadata, { shortHash, fullHash });
                  }

                  if (normalized) {
                    setFileMetadataState(normalized);
                    try {
                      localStorage.setItem(`${cacheKey}-metadata-${shortHash}`, JSON.stringify(normalized));
                    } catch (cacheErr) {
                      console.warn('⚠️ Failed to cache metadata for decrypted message:', cacheErr);
                    }
                    // Keep original pointer token so downstream logic renders attachment UI
                    return `F:${shortHash}`;
                  }
                }
              }
              
              // Fallback if metadata couldn't be resolved
              console.warn('⚠️ Could not resolve metadata for:', shortHash);
              return decrypted;
              
            } catch (metaErr) {
              console.error('❌ Metadata resolution failed:', metaErr);
              return decrypted;
            }
          }
          
          return decrypted;

        } catch (decryptErr: any) {
          // Check if this is expected old format failure
          if (decryptErr.message && decryptErr.message.includes('Decryption failed')) {
            console.warn('⚠️ Old message format detected, decryption not supported');
            return `📜 Legacy Message Format\n\n` +
              `This message was created with an older encryption format.\n` +
              `Decryption is only available for messages sent with the current format.`;
          }
          
          console.error('❌ Client-side decryption failed:', decryptErr);
          return `❌ Decryption failed: ${decryptErr.message}\n\n` +
            `Please make sure you're using the correct wallet address.`;
        }
      }

      // Fallback: Show encrypted info if no wallet access
      return `✅ IPFS content fetched successfully!\n\n` +
        `📦 Ciphertext: ${ciphertextBytes.length} bytes\n` +
        `🧾 Envelope: ${envelopeCipherBytes.length} bytes\n` +
        `🔐 IV length: ${ivBytes.length} bytes\n\n` +
        `⚠️ Connect your wallet to decrypt this message.`;
    };

    // SealedMessage: getMessage returns tuple (array), not a struct
    if (Array.isArray(handleValue)) {
      const [
        sender,
        receiver,
        uri,
        iv,
        authTag,
        ciphertextHash,
        metadataHash,
        escrowCiphertext,
        escrowIv,
        escrowAuthTag,
        sessionKeyCommitment,
        receiverEnvelopeHash,
        escrowKeyVersion
      ] = handleValue;

      try {
        if (userAddress && typeof sender === 'string' && typeof receiver === 'string') {
          const viewer = normalizeAddress(userAddress);
          const senderLower = normalizeAddress(sender);
          const receiverLower = normalizeAddress(receiver);

          if (viewer === receiverLower) {
            currentDecryptOptions = { role: 'receiver' };
            try {
              const fallbackPair = generateFallbackKeyPair(receiver);
              currentDecryptOptions.fallbackPrivateKey = new Uint8Array(fallbackPair.privateKey);
            } catch (fallbackErr) {
              console.warn('⚠️ Failed to derive receiver fallback keypair', fallbackErr);
            }
          } else if (viewer === senderLower) {
            const receiverKeyBytes = await resolveReceiverPublicKeyBytes(receiver);
            if (!receiverKeyBytes || receiverKeyBytes.length === 0) {
              throw new Error('Receiver public key unavailable for sender-side decrypt');
            }
            currentDecryptOptions = { role: 'sender', peerPublicKey: receiverKeyBytes };
          } else {
            currentDecryptOptions = undefined;
          }

          // role resolved; decrypt path will use currentDecryptOptions
        }

        return await processDecryptResponse({
          messageId: id.toString(),
          uri,
          iv,
          authTag,
          ciphertextHash,
          escrowCiphertext,
          escrowIv,
          escrowAuthTag,
          sessionKeyCommitment,
          receiverEnvelopeHash,
          escrowKeyVersion
        }, {
          tupleSender: sender,
          tupleReceiver: receiver,
          ciphertextHash,
          metadataHash,
          ivLength: typeof iv === 'string' ? iv.length : undefined,
          authTagLength: typeof authTag === 'string' ? authTag.length : undefined,
          sessionKeyCommitment
        });
      } catch (apiErr: any) {
        console.error('❌ Decrypt failed:', apiErr);
        const metaDetails: string[] = [];
        if (typeof iv === 'string') metaDetails.push(`- IV length: ${iv.length} chars`);
        if (typeof authTag === 'string') metaDetails.push(`- AuthTag length: ${authTag.length} chars`);
        if (typeof sessionKeyCommitment === 'string') metaDetails.push(`- Session commitment: ${sessionKeyCommitment}`);
        const metadataBlock = metaDetails.length ? `\n\nMetadata:\n${metaDetails.join('\n')}` : '';
        return `🔐 Encrypted message at: ${uri}\n\n(Decryption failed: ${apiErr.message})${metadataBlock}`;
      }
    }

    // SealedMessage: getMessage can also return object, not a handle
    if (typeof handleValue === 'object' && handleValue !== null) {
      const message = handleValue as any;
      const {
        uri,
        iv,
        authTag,
        ciphertextHash,
        escrowCiphertext,
        escrowIv,
        escrowAuthTag,
        sessionKeyCommitment,
        receiverEnvelopeHash,
        escrowKeyVersion,
        senderPublicKey
      } = message;

      if (userAddress && typeof message.sender === 'string' && typeof message.receiver === 'string') {
        const viewer = normalizeAddress(userAddress);
        const senderLower = normalizeAddress(message.sender);
        const receiverLower = normalizeAddress(message.receiver);

        if (viewer === receiverLower) {
          currentDecryptOptions = { role: 'receiver' };
        } else if (viewer === senderLower) {
          const receiverKeyBytes = await resolveReceiverPublicKeyBytes(message.receiver);
          if (!receiverKeyBytes || receiverKeyBytes.length === 0) {
            throw new Error('Receiver public key unavailable for sender-side decrypt');
          }
          currentDecryptOptions = { role: 'sender', peerPublicKey: receiverKeyBytes };
        } else {
          currentDecryptOptions = undefined;
        }

        // role resolved; decrypt path will use currentDecryptOptions
      }

      try {
        return await processDecryptResponse({
          messageId: id.toString(),
          uri,
          iv,
          authTag,
          ciphertextHash,
          escrowCiphertext,
          escrowIv,
          escrowAuthTag,
          sessionKeyCommitment,
          receiverEnvelopeHash,
          escrowKeyVersion
        });
      } catch (apiErr: any) {
        console.error('❌ Decrypt failed:', apiErr);
        const metaDetails: string[] = [];
        if (typeof iv === 'string') metaDetails.push(`- IV length: ${iv.length} chars`);
        if (typeof authTag === 'string') metaDetails.push(`- AuthTag length: ${authTag.length} chars`);
        if (typeof sessionKeyCommitment === 'string') metaDetails.push(`- Session commitment: ${sessionKeyCommitment}`);
        const metadataBlock = metaDetails.length ? `\n\nMetadata:\n${metaDetails.join('\n')}` : '';
        return `🔐 Encrypted message at: ${uri}\n\n(Decryption failed: ${apiErr.message})${metadataBlock}`;
      }
    }

    // Fallback for hex string (legacy)
    if (typeof handleValue !== 'string') {
      throw new Error(`Expected object or string, got ${typeof handleValue}`);
    }

    const sanitized = stripHexPrefix(handleValue);
    if (!sanitized) {
      throw new Error("Ciphertext is empty");
    }

    throw new Error("Legacy ciphertext handles are no longer supported. Please request the sender to resend using the updated encryption flow.");
  }, [contentType, id]);

  // Helper: try resolving shortHash via backend, proxy, or Pinata keyvalue search
  const tryResolveShortHash = async (shortHash: string): Promise<string | null> => {
    const persistMapping = async (fullHash: string) => {
      try {
        await fetch('/api/metadata-mapping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shortHash, fullHash })
        });
      } catch (err) {
        console.warn('⚠️ Failed to persist mapping after resolve:', err);
      }
    };

    // 0) Backend mapping service
    try {
      const res = await fetch(`/api/metadata-mapping/${shortHash}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        const candidate = data?.record?.fullHash as string | undefined;
        if (candidate) {
          return candidate;
        }
      }
    } catch (err) {
      console.warn('Backend lookup failed:', err);
    }

    // 1) Try direct proxy fetch assuming the sender stored full metadata under same shortHash as filename
    try {
      const probeUrl = `/api/ipfs/${shortHash}`;
      const probe = await fetch(probeUrl);
          if (probe.ok) {
            try {
              const candidate = await probe.json();
              if (candidate?.ipfs) {
                const fullHash = candidate.ipfs as string;
                await persistMapping(fullHash);
                return fullHash;
              }
            } catch {}
      }
    } catch (e) {
      console.warn('Probe via proxy failed:', e);
    }

    // 2) Try Pinata keyvalue search (if keys present)
    try {
      const pinataApiKey = process.env.NEXT_PUBLIC_PINATA_API_KEY;
      const pinataSecretKey = process.env.NEXT_PUBLIC_PINATA_SECRET_KEY;
      if (!pinataApiKey || !pinataSecretKey) return null;

      const headers: Record<string, string> = {
        pinata_api_key: pinataApiKey,
        pinata_secret_api_key: pinataSecretKey,
        Accept: 'application/json'
      };

      const params = new URLSearchParams({ status: 'pinned', pageLimit: '5' });
      params.append('hashContains', shortHash);
      const res = await fetch(`https://api.pinata.cloud/data/pinList?${params.toString()}`, { headers });
      if (!res.ok) return null;
      const json = await res.json();
      const rows: any[] = json?.rows ?? [];
      const match = rows.find((r) => r?.metadata?.keyvalues?.shortHash === shortHash || (r?.metadata?.name || '').toLowerCase().includes('meta'));
      if (match?.ipfs_pin_hash) {
        const fullHash = match.ipfs_pin_hash as string;
        await persistMapping(fullHash);
        return fullHash;
      }
    } catch (e) {
      console.warn('Pinata search failed:', e);
    }

    return null;
  };
  
  // Fetch file metadata if messageContent starts with "F:"
  useEffect(() => {
    const fetchFileMetadata = async () => {
      if (!messageContent || !messageContent.startsWith('F:')) {
        return;
      }
      const pendingSessionKeyRetry = Boolean(fileMetadataState?.requiresSessionKey && activeSessionKey);
      if (fileMetadataState && !pendingSessionKeyRetry) return;

      if (pendingSessionKeyRetry) {
        setFileMetadataState(null);
      }

    // Extract full hash after "F:" prefix (could be 6-char short or full IPFS hash)
    const hashPart = messageContent.substring(2).trim();

      // Determine if it's a short hash (<=8 chars) or full IPFS hash (46+ chars)
      const isShortHash = hashPart.length <= 8;
      const shortHash = isShortHash ? hashPart : hashPart.substring(0, 6);
      const mappingKey = `file-metadata-${shortHash}`;
      const publicMappingKey = `file-public-metadata-${shortHash}`;
      let fullHash: string | null = null;
      let publicHash: string | null = null;
      try {
        fullHash = localStorage.getItem(mappingKey);
      } catch (err) {
        console.warn('⚠️ localStorage unavailable while resolving metadata hash:', err);
      }
      try {
        publicHash = localStorage.getItem(publicMappingKey);
      } catch (err) {
        console.warn('⚠️ localStorage unavailable while resolving public metadata hash:', err);
      }

      if (typeof window !== 'undefined' && cacheKey) {
        try {
          const cached = localStorage.getItem(`${cacheKey}-metadata-${shortHash}`);
          if (cached) {
            const parsed = JSON.parse(cached) as NormalizedMetadata;
            setFileMetadataState(parsed);
            setIsLoadingFileMetadata(false);
            return;
          }
        } catch (err) {
          console.warn('⚠️ Failed to parse cached decrypted metadata:', err);
        }
      }

      const fetchMappingFromServer = async (
        hash: string
      ): Promise<{ fullHash: string | null; publicHash: string | null }> => {
        try {
          const response = await fetch(`/api/metadata-mapping/${hash}`, { cache: 'no-store' });
          if (response.ok) {
            const data = await response.json();
            const candidate = data?.record?.fullHash as string | undefined;
            const publicCandidate = data?.record?.publicHash as string | undefined;
            return {
              fullHash: candidate ?? null,
              publicHash: publicCandidate ?? null
            };
          }
        } catch (err) {
          console.warn('⚠️ Failed to fetch mapping from backend:', err);
        }
        return { fullHash: null, publicHash: null };
      };

      const resolveMetadataHashFromNetwork = async (hashFragment: string): Promise<string | null> => {
        const pinataApiKey = process.env.NEXT_PUBLIC_PINATA_API_KEY;
        const pinataSecretKey = process.env.NEXT_PUBLIC_PINATA_SECRET_KEY;

        if (!pinataApiKey || !pinataSecretKey) {
          console.warn('⚠️ Pinata credentials missing; cannot resolve metadata hash for:', hashFragment);
          return null;
        }

        const headers: Record<string, string> = {
          pinata_api_key: pinataApiKey,
          pinata_secret_api_key: pinataSecretKey,
          Accept: 'application/json'
        };

        try {
          const params = new URLSearchParams({ status: 'pinned', pageLimit: '1' });
          const keyvalues = {
            shortHash: { value: hashFragment, op: 'eq' },
            type: { value: 'message-metadata', op: 'eq' }
          };
          params.append('metadata[keyvalues]', JSON.stringify(keyvalues));

          const primaryResponse = await fetch(`https://api.pinata.cloud/data/pinList?${params.toString()}`, {
            headers
          });

          if (primaryResponse.ok) {
            const json = await primaryResponse.json();
            const rows: any[] = json?.rows ?? [];
            const match = rows.find((row) => row?.metadata?.keyvalues?.shortHash === hashFragment);
            if (match?.ipfs_pin_hash) {
              return match.ipfs_pin_hash as string;
            }
          } else {
            console.warn('⚠️ Pinata keyvalue lookup failed:', primaryResponse.status, primaryResponse.statusText);
          }
        } catch (err) {
          console.error('❌ Pinata keyvalue lookup error:', err);
        }

        try {
          const fallbackParams = new URLSearchParams({ status: 'pinned', pageLimit: '5' });
          fallbackParams.append('hashContains', hashFragment);

          const fallbackResponse = await fetch(`https://api.pinata.cloud/data/pinList?${fallbackParams.toString()}`, {
            headers
          });

          if (fallbackResponse.ok) {
            const json = await fallbackResponse.json();
            const rows: any[] = json?.rows ?? [];
            const match = rows.find((row) => {
              if (!row?.ipfs_pin_hash) return false;
              if (row?.metadata?.keyvalues?.type === 'message-metadata') return true;
              const name = row?.metadata?.name as string | undefined;
              return typeof name === 'string' && name.toLowerCase().includes('metadata');
            });

            if (match?.ipfs_pin_hash) {
              return match.ipfs_pin_hash as string;
            }
          } else {
            console.warn('⚠️ Pinata fallback lookup failed:', fallbackResponse.status, fallbackResponse.statusText);
          }
        } catch (err) {
          console.error('❌ Pinata fallback lookup error:', err);
        }

        return null;
      };

      setIsLoadingFileMetadata(true);

      // If it's already a full IPFS hash, use it directly
      if (!isShortHash && hashPart.length >= 46) {
        fullHash = hashPart;
      }

      if ((!fullHash || !publicHash) && isShortHash) {
        const serverHashes = await fetchMappingFromServer(shortHash);
        if (serverHashes.fullHash) {
          fullHash = serverHashes.fullHash;
          try {
            localStorage.setItem(mappingKey, serverHashes.fullHash);
          } catch (err) {
            console.warn('⚠️ Failed to persist backend mapping to localStorage:', err);
          }
        }
        if (serverHashes.publicHash) {
          publicHash = serverHashes.publicHash;
          try {
            localStorage.setItem(publicMappingKey, serverHashes.publicHash);
          } catch (err) {
            console.warn('⚠️ Failed to persist backend public mapping to localStorage:', err);
          }
        }
      }

      if (!fullHash && isShortHash) {
        console.warn('⚠️ Metadata mapping missing locally and backend unavailable; attempting Pinata lookup for:', shortHash);
        fullHash = await resolveMetadataHashFromNetwork(shortHash);
        if (fullHash) {
          try {
            localStorage.setItem(mappingKey, fullHash);
          } catch (err) {
            console.warn('⚠️ Failed to persist Pinata mapping to localStorage:', err);
          }

          try {
            await fetch('/api/metadata-mapping', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ shortHash, fullHash })
            });
          } catch (err) {
            console.warn('⚠️ Failed to persist Pinata mapping to backend:', err);
          }
        }
      }

      if (publicHash) {
        try {
          const url = `/api/ipfs/${publicHash}`;
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`Public metadata fetch failed: ${response.status}`);
          }

          const data = await response.json();
          const normalized = normaliseMetadataPayload(data, {
            shortHash,
            fullHash: publicHash
          });

          setFileMetadataState(normalized);
          try {
            if (cacheKey) {
              localStorage.setItem(`${cacheKey}-metadata-${shortHash}`, JSON.stringify(normalized));
              localStorage.setItem(`${cacheKey}-public-metadata-cid-${id}`, publicHash);
            }
          } catch (cacheErr) {
            console.warn('⚠️ Failed to cache public metadata:', cacheErr);
          }
          setIsLoadingFileMetadata(false);
          return;
        } catch (err) {
          console.warn('⚠️ Failed to fetch public metadata for full hash:', err);
        }
      }

      if (fullHash) {
        try {
          const url = `/api/ipfs/${fullHash}`;
          const response = await fetch(url);
          if (!response.ok) {
            console.error('❌ Metadata fetch failed:', response.status, response.statusText);
            throw new Error('Metadata fetch failed');
          }
          const data = await response.json();

          let normalized: NormalizedMetadata | null = null;

          if (isEncryptedMetadataEnvelope(data)) {
            if (!activeSessionKey) {
              console.warn('⚠️ Session key not available yet; cannot decrypt metadata for', shortHash);
              setFileMetadataState({
                error: true,
                requiresSessionKey: true,
                message: 'Session anahtarı hazır değil. Mesajı tekrar açmayı deneyin.',
                shortHash
              });
              setIsLoadingFileMetadata(false);
              return;
            }

            const { parsed, metadataKeccak } = await decryptMetadataEnvelope(data, activeSessionKey);
            normalized = normaliseMetadataPayload(parsed, { shortHash, fullHash });
            if (metadataKeccak) {
              normalized.metadataKeccak = metadataKeccak;
            }
          } else {
            normalized = normaliseMetadataPayload(data, {
              shortHash,
              fullHash: fullHash ?? (isShortHash ? undefined : hashPart)
            });
          }

          if (normalized) {
            setFileMetadataState(normalized);
            try {
              if (cacheKey) {
                localStorage.setItem(`${cacheKey}-metadata-${shortHash}`, JSON.stringify(normalized));
              }
            } catch (cacheErr) {
              console.warn('⚠️ Failed to cache decrypted metadata:', cacheErr);
            }
          }
          setIsLoadingFileMetadata(false);
          return;
        } catch (err) {
          console.error('❌ Failed to fetch file metadata using full hash:', err);
          // fallthrough to interactive resolve UI
        }
      }

      // If we reach here, no fullHash was available or fetch failed. Provide interactive resolve options to the user.
      console.warn('⚠️ Full metadata hash not found for short hash:', shortHash);
      setFileMetadataState({ error: true, message: 'Metadata hash not found locally.', shortHash, hashPart, attempts: 0 });
      setIsLoadingFileMetadata(false);
    };

    fetchFileMetadata();
  }, [messageContent, fileMetadataState, activeSessionKey, cacheKey]);
  
  // Artık sadece Sealed kullanıyoruz
  const isSealedContract = true;
  
  // Sadece Sealed ABI kullan
  const selectedAbi = sealedMessageAbi;
  
  // Eğer mesaj zaten okunmuşsa (isRead: true), direkt içeriği yükle
  useEffect(() => {
    const loadContentIfRead = async () => {
      if (!isRead || isSent || !localUnlocked || !client || !userAddress || !contractAddress) return;
      
      // ✅ Cache'de varsa hiçbir şey yapma (state'te zaten yüklü)
      if (messageContent) {
        return;
      }

      setIsLoadingContent(true);
      setDecryptError(null);
      let ciphertext: unknown = null;
      try {
        const content = await client.readContract({
          address: contractAddress,
          abi: sealedMessageAbi as any,
          functionName: "getMessage" as any,
          args: [id],
          account: userAddress as `0x${string}`
        });

        ciphertext = content;
        const decrypted = await decryptCiphertext(content);
        setMessageContent(decrypted);
        setIsExpanded(true);
        setLocalUnlocked(true);
        setLocalIsRead(true);
        
        // ✅ localStorage'a kaydet
        localStorage.setItem(`${cacheKey}-content-${id}`, decrypted);
        localStorage.setItem(`${cacheKey}-read-${id}`, 'true');
        localStorage.setItem(`${cacheKey}-expanded-${id}`, 'true');
        localStorage.setItem(`${cacheKey}-unlocked-${id}`, 'true');
        // Debug: record received decrypted
        try {
          const entry = {
            ts: Date.now(),
            type: 'received-decrypted',
            id: id.toString(),
            decrypted,
            ciphertext: String((ciphertext as any)?.toString?.() ?? ciphertext)
          };
          const existing = JSON.parse(localStorage.getItem('msg-debug-log') || '[]');
          existing.push(entry);
          localStorage.setItem('msg-debug-log', JSON.stringify(existing));
        } catch (e) {
          console.warn('Failed to write debug log (received-decrypted):', e);
        }
      } catch (err) {
  console.error("❌ Content could not be loaded (isRead):", err);
  const fallback = ciphertext != null ? String((ciphertext as any)?.toString?.() ?? ciphertext) : "⚠️ Encrypted payload unavailable";
  setMessageContent(fallback);
        setDecryptError(`Unable to decrypt message: ${toReadableError(err)}`);
      } finally {
        setIsLoadingContent(false);
      }
    };
    
    loadContentIfRead();
  }, [isRead, isSent, localUnlocked, client, userAddress, id, messageContent, contractAddress, decryptCiphertext]);

  useEffect(() => {
    if (!isSent) {
      return;
    }

    setLocalUnlocked(true);
    setLocalIsRead(true);

    if (typeof window === 'undefined' || !cacheKey) {
      return;
    }

    try {
      localStorage.setItem(`${cacheKey}-unlocked-${id}`, 'true');
      localStorage.setItem(`${cacheKey}-read-${id}`, 'true');
    } catch (err) {
      console.warn('⚠️ Failed to persist sent message unlock state:', err);
    }
  }, [isSent, cacheKey, id]);

  const hasTimeCondition = metadataLoaded && (conditionMask & 0x01) !== 0;
  const paymentFlagIsSet = metadataLoaded && (conditionMask & 0x02) !== 0;
  const paymentAmountResolved = requiredPaymentAmount !== null;
  const paymentAmountValue = paymentAmountResolved ? (requiredPaymentAmount as bigint) : null;
  const paidAmountValue = paidAmountOnchain ?? 0n;
  const hasPaymentCondition = paymentFlagIsSet && paymentAmountValue !== null && paymentAmountValue > 0n;
  const outstandingPayment = hasPaymentCondition && paymentAmountValue !== null
    ? (paymentAmountValue > paidAmountValue ? paymentAmountValue - paidAmountValue : 0n)
    : 0n;
  const paymentSettled = hasPaymentCondition && outstandingPayment === 0n;
  const paymentReady = !paymentFlagIsSet || (paymentAmountResolved && paidAmountOnchain !== null);
  
  // ✅ Time condition check: ONLY check client time, don't rely on onchainUnlocked for time
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const unlockTimestamp = Number(unlockTime);
  const clientTimeReady = unlockTimestamp > 0 && currentTimestamp >= unlockTimestamp;
  
  // Time is ready if: NO time condition OR time has passed
  // Don't use onchainUnlocked for time check (it can be true even if time not ready)
  const timeReady = !hasTimeCondition || clientTimeReady;

  const unlockMoment = useMemo(() => {
    if (!metadataLoaded || !hasTimeCondition) {
      return null;
    }
    if (!Number.isFinite(unlockTimestamp) || unlockTimestamp <= 0) {
      return null;
    }
    const candidate = dayjs.unix(unlockTimestamp);
    return candidate.isValid() ? candidate : null;
  }, [metadataLoaded, hasTimeCondition, unlockTimestamp]);

  const timeRequirementLabel = useMemo(() => {
    if (!unlockMoment) {
      return null;
    }
    const formatted = unlockMoment.format("YYYY-MM-DD HH:mm");
    if (clientTimeReady) {
      return `Time lock satisfied (${unlockMoment.fromNow()}).`;
    }
    return `Unlocks at ${formatted} (${unlockMoment.fromNow()}).`;
  }, [unlockMoment, clientTimeReady]);
  
  const shouldAttachPayment = hasPaymentCondition && outstandingPayment > 0n;
  const canPrepareRead =
    !!contractAddress &&
    !!userAddress &&
    walletOnExpectedChain &&
    !isSent &&
    !messageContent &&
    metadataLoaded &&
    paymentReady &&
    timeReady &&
    !shouldAttachPayment;
  const paymentIsFree = !requiredPaymentAmount || requiredPaymentAmount === 0n;
  const paymentDisplay = metadataLoaded ? formatPaymentAmount(outstandingPayment, { includeUnit: true, zeroLabel: "0 ETH" }) : null;
  const paymentBadgeClass = metadataLoaded
    ? (paymentIsFree || paymentSettled ? "text-emerald-300" : "text-amber-300")
    : "text-slate-500 animate-pulse";
  const paymentRequirementLabel = shouldAttachPayment ? paymentDisplay : (paymentSettled ? "Paid" : null);
  const fallbackConditionMask = conditionType ?? 0;
  const fallbackHasTime = (fallbackConditionMask & 0x01) !== 0;
  const fallbackHasPayment = (fallbackConditionMask & 0x02) !== 0 && typeof requiredPayment === 'bigint' && requiredPayment > 0n;
  const canUnlockWithPayment = shouldAttachPayment && !!contractAddress && !!userAddress && walletOnExpectedChain && !isSent;
  const paymentValueToSend = canUnlockWithPayment ? outstandingPayment : undefined;

  const summaryPaymentBadgeValue =
    paymentDisplay ?? (metadataLoaded ? (paymentIsFree ? "0 ETH" : "Pending...") : "Loading...");
  const summaryPaymentDescription = metadataLoaded
    ? paymentIsFree
      ? (isSent
          ? "Receiver does not need to pay to read this message."
          : "No payment is required to read this message.")
      : (isSent
          ? `Receiver must pay ${paymentDisplay ?? "the required amount"} to open this message.`
          : `You must pay ${paymentDisplay ?? "the required amount"} to open this message.`)
    : "Loading payment info...";
  const messageSummaryTitle = isSent ? "Message Summary (Receiver View)" : "Message Summary";

  const { config: paymentConfig, error: preparePaymentError } = usePrepareContractWrite({
    address: contractAddress,
    abi: sealedMessageAbi as any,
    functionName: "payToUnlock",
    args: [id],
    value: paymentValueToSend,
    enabled: Boolean(canUnlockWithPayment && outstandingPayment > 0n),
  chainId: activeChainId,
    account: userAddress as `0x${string}` | undefined
  });

  const {
    data: paymentTxData,
    isLoading: isPaymentPending,
    write: unlockWithPayment,
    error: paymentWriteError
  } = useContractWrite(paymentConfig);

  const paymentHashToTrack = paymentTxData?.hash ?? manualPaymentHash ?? undefined;

  const {
    isLoading: isPaymentConfirming,
    isSuccess: isPaymentSuccess
  } = useWaitForTransaction({
    hash: paymentHashToTrack
  });

  const canSubmitPayment = useMemo(
    () => Boolean(canUnlockWithPayment && (unlockWithPayment || walletClient)),
    [canUnlockWithPayment, unlockWithPayment, walletClient]
  );

  const isPaymentActionPending = isPaymentPending || isManualPaymentPending || isPaymentConfirming;

  const handlePaymentClick = useCallback(async () => {
    if (!shouldAttachPayment) {
      return;
    }

    setDecryptError(null);

    if (!canUnlockWithPayment) {
      if (!userAddress) {
        setDecryptError("Please connect your wallet to unlock this message with a payment.");
      } else if (!contractAddress) {
        setDecryptError("Contract address is unavailable. Please refresh the page and try again.");
      } else if (!walletOnExpectedChain) {
        const expectedName = messageChainConfig?.name ?? "the correct network";
        setDecryptError(`Please switch your wallet to ${expectedName} to unlock this message.`);
      } else if (!activeChainId) {
        setDecryptError("Active network could not be detected. Reconnect your wallet and retry.");
      } else {
        setDecryptError("Payment details are still loading. Please wait a moment and try again.");
      }
      return;
    }

    if (isPaymentActionPending) {
      return;
    }

    if (unlockWithPayment) {
      try {
        unlockWithPayment();
        return;
      } catch (err) {
        setDecryptError(`Payment could not be initiated: ${toReadableError(err)}`);
        return;
      }
    }

    if (!walletClient || outstandingPayment <= 0n) {
      setDecryptError("Payment quote unavailable. Please wait for the payment info to load and retry.");
      return;
    }

    try {
      setIsManualPaymentPending(true);
      setManualPaymentHash(null);
      const txHash = await walletClient.writeContract({
        address: contractAddress,
        abi: sealedMessageAbi as any,
        functionName: "payToUnlock",
        args: [id],
        account: userAddress as `0x${string}`,
        value: outstandingPayment
      });

      if (txHash) {
        setManualPaymentHash(txHash);
      }
    } catch (err) {
      setDecryptError(`Payment failed: ${toReadableError(err)}`);
    } finally {
      setIsManualPaymentPending(false);
    }
  }, [
    shouldAttachPayment,
    canUnlockWithPayment,
    unlockWithPayment,
    walletClient,
    outstandingPayment,
    contractAddress,
    id,
    userAddress,
    activeChainId,
    isPaymentActionPending,
    walletOnExpectedChain,
    messageChainConfig?.name
  ]);

  useEffect(() => {
    if (preparePaymentError) {
      console.error("❌ payToUnlock prepare error:", toReadableError(preparePaymentError));
    }
  }, [preparePaymentError]);

  useEffect(() => {
    if (paymentWriteError) {
      const readable = toReadableError(paymentWriteError);
      console.error("❌ payToUnlock write error:", readable);
      setDecryptError((previous) => previous ?? `Payment could not be sent: ${readable}`);
    }
  }, [paymentWriteError]);

  useEffect(() => {
    if (isPaymentSuccess) {
      setManualPaymentHash(null);
    }
  }, [isPaymentSuccess]);

  const headerBadges = useMemo(() => {
    const badges: { key: string; label: string; className: string }[] = [];
    const timeBadge = {
      key: 'time',
      label: '⏰ Time Lock',
      className: 'bg-amber-500/20 text-amber-300 border border-amber-400/30'
    };
    const paymentBadge = paymentSettled
      ? {
          key: 'payment',
          label: '💰 Payment Complete',
          className: 'bg-emerald-600/20 text-emerald-300 border border-emerald-400/30'
        }
      : {
          key: 'payment',
          label: paymentRequirementLabel ? `💰 Payment · ${paymentRequirementLabel}` : '💰 Payment Required',
          className: 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/30'
        };
    const instantBadge = {
      key: 'instant',
      label: '⚡ Instant Access',
      className: 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30'
    };

    if (metadataLoaded) {
      if (hasTimeCondition) {
        badges.push(timeBadge);
      }
      if (hasPaymentCondition) {
        badges.push(paymentBadge);
      }
      if (!hasTimeCondition && !hasPaymentCondition) {
        badges.push(instantBadge);
      }
      return badges;
    }

    if (fallbackHasTime) {
      badges.push(timeBadge);
    }
    if (fallbackHasPayment) {
      badges.push(paymentBadge);
    }
    if (!fallbackHasTime && !fallbackHasPayment) {
      badges.push(instantBadge);
    }
    return badges;
  }, [metadataLoaded, hasTimeCondition, hasPaymentCondition, paymentFlagIsSet, conditionType, paymentRequirementLabel, fallbackHasTime, fallbackHasPayment]);
  const fileNameLabel = previewMetadata?.fileName?.trim() ? previewMetadata.fileName.trim() : null;
  const fileSizeLabel = previewMetadata && previewMetadata.fileSize > 0n ? formatFileSize(previewMetadata.fileSize) : null;
  const contentTypeLabel = previewMetadata?.contentType?.trim() ? previewMetadata.contentType.trim() : null;
  const previewMimeType = previewMetadata?.contentType?.trim().toLowerCase() ?? '';
  const previewIsImage = previewMetadata?.isImage ?? previewMimeType.startsWith('image/');
  const previewImageUrl = previewIsImage && previewMetadata?.previewImageHash
    ? `/api/ipfs/${previewMetadata.previewImageHash}`
    : null;
  const hasAnyPreviewInfo = Boolean(
    fileNameLabel ||
    fileSizeLabel ||
    contentTypeLabel ||
    (previewIsImage && (previewMetadata?.previewImageHash || previewDataUrl))
  );
  const previewInfoNotice = previewIsImage
  ? (localUnlocked
    ? (isSent
      ? "Receiver will see the high-resolution preview after opening the message."
      : "High-resolution preview is available below once the message is opened.")
    : (isSent
      ? "Receiver will unlock the full resolution after the time or payment conditions are met."
      : "Full resolution image will unlock after time/payment conditions are met."))
  : (localUnlocked
    ? (isSent
      ? "Receiver can download the attachment after opening the message."
      : "Attachment is ready to download once you open the message.")
    : (isSent
      ? "Receiver must meet the unlock conditions to download this attachment."
      : "Complete the unlock conditions to access the attachment."));
  const rawPreviewSnippet = (previewMetadata?.previewText ?? "").trim();
  const previewSnippetAvailable = rawPreviewSnippet.length > 0;
  const canRevealPreviewSnippet = previewSnippetAvailable && (localUnlocked || isSent);
  const snippetHeadingLabel = canRevealPreviewSnippet
    ? "Message snippet"
    : isSent
    ? "Message summary"
    : "Encrypted summary";
  const sentPreviewMime = typeof sentPreviewInfo?.fileMetadata?.mimeType === 'string'
  ? sentPreviewInfo.fileMetadata.mimeType.toLowerCase()
  : '';
  const sentPreviewIsImage = sentPreviewMime.startsWith('image/');
  const showLoadingPreview = isLoadingPreview && !previewDataUrl && !previewMetadata;
  const computedCreatedAt = useMemo(() => (typeof createdAt === 'bigint' ? createdAt : null), [createdAt]);
  const sentDateLabel = useMemo(() => {
    if (createdDate && createdDate.trim().length > 0) {
      return createdDate.trim();
    }
    if (computedCreatedAt && computedCreatedAt > 0n) {
      const seconds = Number(computedCreatedAt);
      if (!Number.isNaN(seconds) && Number.isFinite(seconds) && seconds > 0) {
        return dayjs.unix(seconds).format('YYYY-MM-DD HH:mm:ss');
      }
    }
    return null;
  }, [computedCreatedAt, createdDate]);
  const legacyAttachmentSummary = useMemo(() => {
    if (typeof window !== "undefined" && cacheKey) {
      try {
        const cached = localStorage.getItem(`${cacheKey}-content-${id}`);
        if (cached && cached.startsWith("FILE:")) {
          return (
            <div className="rounded-lg bg-purple-900/20 border border-purple-400/40 p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm text-purple-300">
                <span>📎</span>
                <span className="font-semibold">Attached File</span>
              </div>
              <p className="text-xs text-purple-200 italic">
                {isSent
                  ? "You attached a file to this message."
                  : "⚠️ This message includes a file. Confirm the sender before unlocking."
                }
              </p>
              {!isSent && (
                <div className="text-xs text-slate-300 space-y-1">
                  <div>
                    <span className="text-slate-500">Sender:</span>{" "}
                    <code className="font-mono text-purple-200">
                      {sender.substring(0, 10)}...{sender.substring(sender.length - 8)}
                    </code>
                  </div>
                </div>
              )}
            </div>
          );
        }
      } catch {
        // ignore localStorage lookup failures
      }
    }

    if (contentType === 1) {
      return (
        <div className="rounded-lg bg-purple-900/20 border border-purple-400/40 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm text-purple-300">
            <span>📎</span>
            <span className="font-semibold">File Attached</span>
          </div>
          <p className="text-xs text-purple-200 italic">
            ⚠️ This message contains a file. Verify the sender before unlocking and opening.
          </p>
          <div className="text-xs text-slate-300 space-y-1">
            <div>
              <span className="text-slate-500">Sender:</span>{" "}
              <code className="font-mono text-purple-200">
                {sender.substring(0, 10)}...{sender.substring(sender.length - 8)}
              </code>
            </div>
          </div>
        </div>
      );
    }

    return null;
  }, [cacheKey, contentType, id, isSent, sender]);
  const summarySection = (
    <div className="mb-4 rounded-lg border border-slate-800/40 bg-slate-900/40 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-slate-300 flex items-center gap-2">
          <span>📦</span>
          <span>{messageSummaryTitle}</span>
        </div>
        <div className={`text-sm font-semibold ${paymentBadgeClass}`}>
          {summaryPaymentBadgeValue}
        </div>
      </div>
      <div className="text-xs text-slate-400">
        {summaryPaymentDescription}
      </div>
      <div
        className="pt-2 border-t border-slate-800/60 space-y-3"
        style={!isSent && localUnlocked && localIsRead ? { display: "none" } : undefined}
      >
        {previewSnippetAvailable ? (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-400 flex items-center gap-2">
              <span>📝</span>
              <span>{snippetHeadingLabel}</span>
            </div>
            <div
              className={
                localUnlocked
                  ? "p-2 bg-slate-900/40 border border-slate-700/40 rounded"
                  : "p-2 bg-slate-900/25 border border-slate-800/60 rounded"
              }
            >
              {canRevealPreviewSnippet ? (
                <p className="leading-relaxed text-sm text-slate-200/90 break-words">
                  {rawPreviewSnippet}
                </p>
              ) : (
                <p className="leading-relaxed text-sm text-slate-200/70 break-words">
                  🔒 This summary is encrypted. Unlock the message to reveal it.
                </p>
              )}
              {!localUnlocked && !isSent && (
                <p className="mt-2 text-[11px] text-slate-400 flex items-start gap-1">
                  <span>ℹ️</span>
                  <span>
                    The summary remains hidden for the receiver until the unlock conditions are satisfied.
                  </span>
                </p>
              )}
            </div>
          </div>
        ) : null}

        <div className="text-xs font-semibold text-slate-400 flex items-center gap-2">
          <span>📎</span>
          <span>Attachment Preview</span>
        </div>

        {isLoadingPreviewMeta || showLoadingPreview ? (
          <p className="text-xs text-slate-500 animate-pulse">
            {isLoadingPreviewMeta ? "Loading attachment info..." : "Preparing preview..."}
          </p>
        ) : previewMetadata ? (
          <div className="space-y-3">
            {previewIsImage && previewMetadata.thumbnail ? (
              <div className="flex items-center gap-3 p-2 bg-purple-900/10 rounded border border-purple-500/20">
                <img
                  src={previewMetadata.thumbnail}
                  alt="25×25 preview"
                  className="w-12 h-12 rounded border-2 border-purple-500/40 object-cover"
                  style={{ imageRendering: "pixelated" }}
                  title="25×25 pixelated preview"
                />
                <div className="text-[10px] text-purple-300/70 space-y-0.5">
                  <div>25×25 preview</div>
                  <div className={localUnlocked ? "text-green-400" : "text-amber-300"}>
                    {localUnlocked ? "🔓 Unlock ready" : "🔒 Message locked"}
                  </div>
                </div>
              </div>
            ) : null}

            {previewMetadata.previewText && localUnlocked && canShowUnlockedPreview ? (
              <div className="p-2 bg-slate-900/40 border border-slate-700/40 rounded text-xs text-slate-200">
                <div className="font-semibold text-slate-300 mb-1 flex items-center gap-1">
                  <span>📝</span>
                  <span>Message snippet</span>
                </div>
                <p className="leading-relaxed text-slate-200/90 break-words">
                  {previewMetadata.previewText}
                </p>
              </div>
            ) : null}

            {!localUnlocked ? (
              <div className="p-2 bg-slate-900/20 border border-slate-700/40 rounded text-[11px] text-slate-300 flex items-start gap-2">
                <span>🔒</span>
                <span>{isSent ? "Receiver must complete the unlock conditions to reveal text." : "Message content remains encrypted. Complete the unlock conditions to reveal text."}</span>
              </div>
            ) : null}

            {localUnlocked && !canShowUnlockedPreview ? (
              <div className="p-2 bg-slate-900/20 border border-slate-700/40 rounded text-[11px] text-slate-300 flex items-start gap-2">
                <span>🗝️</span>
                <span>{isSent ? "Receiver can decrypt the message once unlock conditions are satisfied." : "Unlock conditions are satisfied. Select “Open Message” to decrypt and view the content."}</span>
              </div>
            ) : null}

            <div className="space-y-2 text-xs text-slate-300">
              {previewMetadata.fileName ? (
                <div className="flex items-start gap-2">
                  <span className="text-slate-500 min-w-[70px]">📝 File:</span>
                  <span className="break-all font-mono text-purple-200">{previewMetadata.fileName}</span>
                </div>
              ) : null}
              {previewMetadata.fileSize > 0n ? (
                <div className="flex items-start gap-2">
                  <span className="text-slate-500 min-w-[70px]">💾 Size:</span>
                  <span className="text-purple-200">{formatFileSize(previewMetadata.fileSize)}</span>
                </div>
              ) : null}
              {previewIsImage && previewMetadata.dimensions ? (
                <div className="flex items-start gap-2">
                  <span className="text-slate-500 min-w-[70px]">📐 Original:</span>
                  <span className="text-purple-200">{previewMetadata.dimensions.width} × {previewMetadata.dimensions.height} pixels</span>
                </div>
              ) : null}
              {previewMetadata.contentType ? (
                <div className="flex items-start gap-2">
                  <span className="text-slate-500 min-w-[70px]">🔖 Type:</span>
                  <span className="text-purple-200">{previewMetadata.contentType}</span>
                </div>
              ) : null}
            </div>

            {(localUnlocked || isSent) ? (
              <div className="p-2 bg-blue-900/20 border border-blue-500/30 rounded text-[11px] text-blue-200 flex items-start gap-2">
                <span className="text-blue-400">ℹ️</span>
                <span>{previewInfoNotice}</span>
              </div>
            ) : null}
          </div>
        ) : hasAnyPreviewInfo ? (
          <div className="space-y-2 text-sm text-slate-300">
            {fileNameLabel && (
              <div className="flex items-start gap-2">
                <span className="text-slate-500 min-w-[70px]">File name:</span>
                <span className="break-all">{fileNameLabel}</span>
              </div>
            )}
            {fileSizeLabel && (
              <div className="flex items-start gap-2">
                <span className="text-slate-500 min-w-[70px]">Size:</span>
                <span>{fileSizeLabel}</span>
              </div>
            )}
            {contentTypeLabel ? (
              <div className="flex items-start gap-2">
                <span className="text-slate-500 min-w-[70px]">Type:</span>
                <span className="break-all">{contentTypeLabel}</span>
              </div>
            ) : null}
            {localUnlocked && previewIsImage && (previewImageUrl || previewDataUrl) && (
              <div className="pt-2 border-t border-slate-800/60">
                <p className="text-xs text-slate-500 mb-2 flex items-center gap-1">
                  <span>🖼️</span>
                  <span>Preview</span>
                </p>
                <img
                  src={previewImageUrl ?? previewDataUrl ?? ""}
                  alt="Attachment preview"
                  className="max-w-full h-auto rounded-md border border-slate-700/60"
                  loading="lazy"
                />
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {legacyAttachmentSummary ?? (
              <div className="text-xs text-slate-400 space-y-1">
                <p className="flex items-center gap-2">
                  <span>📭</span>
                  <span>No attachment detected</span>
                </p>
                <p className="text-[11px] text-slate-500">This message contains only text content.</p>
              </div>
            )}
          </div>
        )}
        {!showLoadingPreview && !previewMetadata && !previewDataUrl && previewError && (
          <p className="text-[11px] text-slate-500 italic">{previewError}</p>
        )}
      </div>
    </div>
  );

  // ✅ getMessage transaction - payment desteği ile (usePrepareContractWrite)
  const { config: preparedReadConfig, error: prepareReadError, status: prepareReadStatus } = usePrepareContractWrite({
    address: contractAddress,
    abi: sealedMessageAbi,
    functionName: "getMessage" as any, // TODO: view function, write olmamalı
    args: [id],
    // Sealedn kilidi açılmışsa veya ödeme gereği varsa (ve miktar biliniyorsa) hazırlansın
    enabled: canPrepareRead,
    chainId: activeChainId,
    account: userAddress as `0x${string}` | undefined,
  });
  
  useEffect(() => {
    if (prepareReadError) {
      console.error("❌ readMessage prepare error:", prepareReadError);
    }
  }, [prepareReadError]);

  const { data: txData, isLoading: isReading, write: readMessage } = useContractWrite(preparedReadConfig);

  const { isLoading: isConfirming, isSuccess } = useWaitForTransaction({
    hash: txData?.hash
  });
  // Transaction başarılı olunca içeriği çek
  useEffect(() => {
    if (!isSuccess || !client || !userAddress || !contractAddress) return;
    const fetchContent = async () => {
      setIsLoadingContent(true);
      setDecryptError(null);
      // Kısa bekleme (ACL ve state)
  await new Promise((resolve) => setTimeout(resolve, 2000));
  await ensureOnchainUnlocked();

  let handleValue: unknown = prefetchedHandle;
      try {
        const needsPayment = (conditionMask & 0x02) !== 0;
        // Eğer ödeme gereksinimi varsa ve prefetched yoksa, yine de bir kez dene:
        // Ödeme "claimed" olduktan sonra sözleşme state’indeki engel kalkmış olabilir.
        if (handleValue == null) {
          const handle = await client.readContract({
            address: contractAddress,
            abi: sealedMessageAbi,
            functionName: "getMessage" as any,
            args: [id],
            account: userAddress as `0x${string}`
          });
          handleValue = handle;
        }

        const decrypted = await decryptCiphertext(handleValue);
        setMessageContent(decrypted);
        setIsExpanded(true);
        setLocalIsRead(true);
        setLocalUnlocked(true);
        
        // localStorage cache
        localStorage.setItem(`${cacheKey}-content-${id}`, decrypted);
        localStorage.setItem(`${cacheKey}-read-${id}`, 'true');
        localStorage.setItem(`${cacheKey}-expanded-${id}`, 'true');
        localStorage.setItem(`${cacheKey}-unlocked-${id}`, 'true');
        
        onMessageRead?.();
      } catch (err) {
        const fallback = handleValue != null ? String((handleValue as any)?.toString?.() ?? handleValue) : "⚠️ Content could not be loaded";
        setMessageContent(fallback);
        setDecryptError(`Unable to decrypt message: ${toReadableError(err)}`);
      } finally {
        setPrefetchedHandle(null);
        setIsLoadingContent(false);
      }
    };
    fetchContent();
  }, [isSuccess, client, id, onMessageRead, userAddress, contractAddress, decryptCiphertext, prefetchedHandle, cacheKey]);

  // Payment success olduğunda içeriği yükle
  useEffect(() => {
    const fetchContentAfterPayment = async () => {
  if (!isPaymentSuccess || !client || !userAddress || !contractAddress) return;
      
      // DEBUG: Log all conditions
      console.log(`[Payment Success] Message ${id}:`, {
        isPaymentSuccess,
        hasTimeCondition,
        timeReady,
        clientTimeReady,
        unlockTimestamp: Number(unlockTime),
        currentTimestamp: Math.floor(Date.now() / 1000),
        willUnlock: !hasTimeCondition || timeReady
      });
      
      // ⚠️ CRITICAL: Check time condition before auto-unlock
      // If time condition exists and not ready, don't auto-unlock
      if (hasTimeCondition && !timeReady) {
        console.log("⏰ Payment completed but time condition not satisfied yet. Waiting for unlock time...");
        return;
      }
      
      setIsLoadingContent(true);
      setDecryptError(null);
      setLocalUnlocked(true);
      setLocalIsRead(true);
      
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Re-sync payment metadata so outstandingPayment reflects the on-chain state
  await ensureOnchainUnlocked();

  let ciphertext: unknown = null;
      try {
        const content = await client.readContract({
          address: contractAddress,
          abi: sealedMessageAbi,
          functionName: "getMessage" as any,
          args: [id],
          account: userAddress as `0x${string}`
        });

        ciphertext = content;
        const decrypted = await decryptCiphertext(content);
        setMessageContent(decrypted);
        setIsExpanded(true);
        
        // localStorage cache (payment sonrası)
        localStorage.setItem(`${cacheKey}-content-${id}`, decrypted);
        localStorage.setItem(`${cacheKey}-read-${id}`, 'true');
        localStorage.setItem(`${cacheKey}-expanded-${id}`, 'true');
        localStorage.setItem(`${cacheKey}-unlocked-${id}`, 'true');
        
        onMessageRead?.(); // Parent'ı bilgilendir
      } catch (err) {
        console.error("❌ Content could not be fetched after payment:", err);
        const fallback = ciphertext != null ? String((ciphertext as any)?.toString?.() ?? ciphertext) : "⚠️ Content could not be loaded";
        setMessageContent(fallback);
        setDecryptError(`Unable to decrypt message: ${toReadableError(err)}`);
      } finally {
        setIsLoadingContent(false);
      }
    };

    fetchContentAfterPayment();
  }, [isPaymentSuccess, client, id, onMessageRead, userAddress, contractAddress, decryptCiphertext, ensureOnchainUnlocked, hasTimeCondition, timeReady]);

  const handleReadClick = async () => {
    if (isSent) {
      console.warn("❌ Cannot read own message");
      return;
    }
    if (!contractAddress) {
      console.error("❌ Contract address not available");
      return;
    }
    if (!encryptionReady) {
      setDecryptError("Encryption system is still loading. Please wait a moment and try again.");
      console.warn("⏳ Encryption layer not ready yet, isLoading:", encryptionLoading);
      return;
    }

    // ✅ Metadata yüklenmediyse, hemen yükle ve bekle
    if (!metadataReadyRef.current) {
      setDecryptError("Message info is loading...");
      const unlocked = await ensureOnchainUnlocked();
      if (!metadataReadyRef.current) {
        setDecryptError("Failed to load message metadata. Please try again.");
        return;
      }
      if (hasTimeCondition && !unlocked) {
        setDecryptError("Waiting for the next block to unlock this message. Please try again shortly.");
        return;
      }
    }

    if (!paymentReady) {
      setDecryptError("Payment info is still loading. Please try again in a moment.");
      console.warn("⏳ Payment metadata still loading for message", id.toString());
      return;
    }

    if (shouldAttachPayment) {
      setDecryptError(`Payment of ${formatPaymentAmount(outstandingPayment, { includeUnit: true, zeroLabel: "0 ETH" })} is required before decrypting. Please complete the payment first.`);
      return;
    }

    const preparedRequest = (preparedReadConfig as any)?.request;
    if (!preparedRequest) {
      const readableError = prepareReadError ? toReadableError(prepareReadError) : null;
      if (readableError) {
        if (readableError.includes('Time locked')) {
          setDecryptError('Time lock is still active. Please wait for the unlock time, then try again.');
        } else if (readableError.includes('Insufficient payment')) {
          setDecryptError('Payment value is missing. Please wait for the payment quote and retry.');
        } else {
          setDecryptError(`Unable to prepare transaction: ${readableError}`);
        }
  } else if (prepareReadStatus === 'pending') {
        setDecryptError('Transaction configuration is still being prepared. Please wait a moment and try again.');
      } else {
        setDecryptError('Transaction configuration unavailable. Please refresh and try again.');
      }
      console.error("❌ Prepared request unavailable", {
        preparedReadConfig,
        prepareReadStatus,
        prepareReadError
      });
      return;
    }

    if (!readMessage) {
      console.error("❌ readMessage function not available");
      console.error("❌ preparedConfig:", preparedReadConfig);
      console.error("❌ conditionMask:", conditionMask);
      console.error("❌ requiredPaymentAmount:", requiredPaymentAmount?.toString());
      return;
    }

    const isActuallyUnlocked = await ensureOnchainUnlocked();
    if (hasTimeCondition && !isActuallyUnlocked) {
      setDecryptError("Waiting for the next block to unlock this message. Please try again shortly.");
      return;
    }

    // Ödeme gerekiyorsa prepared value kontrolü
  const needsPayment = shouldAttachPayment;
    const preparedValue = preparedRequest?.value as bigint | undefined;
    if (needsPayment) {
  const paymentQuote = outstandingPayment;
      if (!preparedValue || preparedValue < paymentQuote) {
        setDecryptError("Payment value not attached yet. Please wait a second and retry.");
        console.error("❌ Prepared request has no/insufficient value", { preparedValue: preparedValue?.toString(), required: paymentQuote.toString() });
        return;
      }

      // ÖNCE simulate ile handle'ı al (state değişmeden, payment koşulu ile)
      try {
        if (!client || !userAddress || !contractAddress) throw new Error('Missing client/account/address');
        const sim = await client.simulateContract({
          address: contractAddress,
          abi: sealedMessageAbi as any,
          functionName: 'getMessage',
          args: [id],
          account: userAddress as `0x${string}`,
          value: paymentQuote
        });
        setPrefetchedHandle(sim.result as unknown);
      } catch (e) {
        const msg = toReadableError(e);
        console.error('❌ simulateContract failed:', e);
        if (msg.includes('Payment already claimed')) {
          setDecryptError('Payment was already claimed on-chain. You can only decrypt from the device that unlocked it. If needed, ask the sender to resend.');
          return;
        }
        if (msg.includes('Time locked')) {
          setDecryptError('Time lock is still active. Please wait for the unlock time, then try again.');
          return;
        }
        // One quick retry in case prepare state just updated
        await new Promise((r) => setTimeout(r, 1200));
        if (!client) {
          setDecryptError('Unable to access public client. Please reconnect your wallet and retry.');
          return;
        }

        try {
          const sim2 = await client.simulateContract({
            address: contractAddress,
            abi: sealedMessageAbi as any,
            functionName: 'getMessage',
            args: [id],
            account: userAddress as `0x${string}`,
            value: paymentQuote
          });
          setPrefetchedHandle(sim2.result as unknown);
        } catch (e2) {
          console.error('❌ simulateContract retry failed, aborting:', e2);
          setDecryptError(`Simulation failed: ${toReadableError(e2)}`);
          return;
        }
      }
    } else {
      setPrefetchedHandle(null);
    }

    setDecryptError(null);
    readMessage();
  };

  // Countdown Timer
  const CountdownTimer = () => {
    const [timeLeft, setTimeLeft] = useState<string>("");

    useEffect(() => {
      const updateTimer = () => {
        const now = Math.floor(Date.now() / 1000);
        const diff = Number(unlockTime) - now;

        if (diff <= 0) {
          setTimeLeft("0s");
          return;
        }

        const duration = dayjs.duration(diff, 'seconds');
        const minutes = Math.floor(duration.asMinutes());
        const seconds = duration.seconds();
        const hours = Math.floor(duration.asHours());
        const days = Math.floor(duration.asDays());

        if (days > 0) {
          const remHours = hours - days * 24;
          setTimeLeft(`${days}d ${remHours}h`);
          return;
        }

        if (hours > 0) {
          const remMinutes = minutes - hours * 60;
          setTimeLeft(`${hours}h ${remMinutes}m`);
          return;
        }

        setTimeLeft(`${minutes}m ${seconds}s`);
      };

      updateTimer();
      const interval = setInterval(updateTimer, 1000);
      return () => clearInterval(interval);
    }, []);

    return <span className="font-mono text-sm text-green-400">{timeLeft}</span>;
  };

  return (
    <div
      style={{ animationDelay: `${index * 50}ms` }}
      className={`
        animate-in fade-in slide-in-from-bottom duration-500
        rounded-xl border p-5 transition-all hover:scale-[1.02] hover:shadow-xl
        ${isSent 
          ? 'border-blue-600/50 bg-gradient-to-br from-blue-900/30 to-blue-800/10' 
          : localUnlocked
          ? 'border-green-600/50 bg-gradient-to-br from-green-900/30 to-emerald-800/10'
          : 'border-slate-700/50 bg-gradient-to-br from-slate-900/60 to-slate-800/30'
        }
      `}
    >
      <div className="space-y-3">
        {/* Başlık: Mesaj ID ve Koşul Tipi */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="text-xs font-mono text-slate-400">#{id.toString()}</div>
            {headerBadges.map((badge) => (
              <div
                key={badge.key}
                className={`px-2 py-0.5 rounded text-xs font-semibold ${badge.className}`}
              >
                {badge.label}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {!isSent && (
              <div className={`
                px-2 py-1 rounded-full text-xs font-semibold
                ${localUnlocked 
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                  : 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                }
              `}>
                {localUnlocked ? '🔓 Unlocked' : '🔒 Locked'}
              </div>
            )}
            {onHide && (
              <button
                onClick={onHide}
                className="p-1.5 rounded-lg bg-slate-800/50 hover:bg-slate-700 border border-slate-700 text-slate-400 hover:text-slate-200 transition-all text-xs"
                title="Hide message"
              >
                ✖️
              </button>
            )}
          </div>
        </div>
        
        {isSent ? (
          <div>
            <p className="text-sm font-semibold text-blue-300 mb-1">📤 Receiver</p>
            <p className="font-mono text-xs text-slate-300 break-all">{receiver}</p>
            
            {/* Dosya indicator - gönderici tarafı */}
            {(() => {
              try {
                const cached = localStorage.getItem(`${cacheKey}-content-${id}`);
                if (cached && cached.startsWith('F:')) {
                  // Short hash'ten full hash'i bul
                  const shortHash = cached.substring(2, 8);
                  const fullHash = localStorage.getItem(`file-metadata-${shortHash}`);
                  return (
                    <div className="mt-2 p-2 rounded-lg bg-purple-900/20 border border-purple-400/30">
                      <p className="text-xs text-purple-300 flex items-center gap-1">
                        <span>📎</span> File attached (hash: {shortHash}...)
                      </p>
                    </div>
                  );
                }
              } catch {}
              return null;
            })()}
            
            <p className="text-xs text-blue-200/60 mt-1">
              <span>🔒</span> Only receiver can view
            </p>

            {/* Decrypt edilen gerçek mesaj içeriği - gönderen de görebilir */}
            {isLoadingContent ? (
              <div className="mt-3 rounded-lg border border-blue-400/40 bg-blue-900/20 p-3">
                <div className="text-slate-400 italic flex items-center gap-2">
                  <span className="animate-spin">⟳</span> Loading your sent message...
                </div>
              </div>
            ) : messageContent ? (
              <div className="mt-3 rounded-lg border border-blue-400/40 bg-blue-900/20 p-3 space-y-2">
                <div className="text-xs font-semibold text-blue-200 flex items-center gap-2">
                  <span>✉️</span>
                  <span>Your decrypted message</span>
                </div>
                <p className="text-sm text-blue-100 whitespace-pre-wrap break-words">
                  {messageContent}
                </p>
                {decryptError && (
                  <div className="mt-2 p-2 bg-red-900/20 border border-red-500/30 rounded text-xs text-red-300">
                    <span>⚠️</span> {decryptError}
                  </div>
                )}
              </div>
            ) : sentPreviewInfo?.payload && (
              <div className="mt-3 rounded-lg border border-blue-400/40 bg-blue-900/20 p-3 space-y-2">
                <div className="text-xs font-semibold text-blue-200 flex items-center gap-2">
                  <span>✉️</span>
                  <span>Message preview (cached)</span>
                </div>
                <p className="text-sm text-blue-100 whitespace-pre-wrap break-words">
                  {sentPreviewInfo.original && sentPreviewInfo.original.trim().length > 0
                    ? sentPreviewInfo.original
                    : sentPreviewInfo.payload}
                </p>
                {sentPreviewInfo.truncated && (
                  <p className="text-xs text-amber-300/80">
                    ⚠️ Content truncated to 32 UTF-8 bytes for on-chain encryption.
                  </p>
                )}
                <p className="text-xs text-slate-400 break-words">
                  Encrypted payload stored as: {" "}
                  <code className="font-mono text-blue-200">{sentPreviewInfo.payload}</code>
                </p>
              </div>
            )}

            {sentPreviewInfo?.fileMetadata && (
              <div className="mt-3 rounded-lg border border-purple-500/40 bg-purple-900/20 p-3 space-y-3">
                <div className="text-xs font-semibold text-purple-200 flex items-center gap-2">
                  <span>📎</span>
                  <span>Attached file summary</span>
                </div>
                
                {/* Thumbnail preview if available */}
                {sentPreviewIsImage && sentPreviewInfo.fileMetadata.thumbnail && (
                  <div className="flex items-center gap-3">
                    <img
                      src={sentPreviewInfo.fileMetadata.thumbnail}
                      alt="25×25 thumbnail"
                      className="w-16 h-16 rounded border-2 border-purple-500/60 object-cover"
                      style={{ imageRendering: 'pixelated' }}
                      title="25×25 thumbnail preview"
                    />
                    <p className="text-[10px] text-purple-300/70">
                      25×25 pixelated preview<br/>
                      (visible to receiver before unlock)
                    </p>
                  </div>
                )}
                
                <div className="text-xs text-purple-200 space-y-1">
                  {sentPreviewInfo.fileMetadata.fileName && (
                    <div className="flex items-start gap-2">
                      <span className="text-purple-400/70 min-w-[70px]">Name:</span>
                      <span className="font-mono break-all">{sentPreviewInfo.fileMetadata.fileName}</span>
                    </div>
                  )}
                  {typeof sentPreviewInfo.fileMetadata.fileSize === 'number' && sentPreviewInfo.fileMetadata.fileSize > 0 && (
                    <div className="flex items-start gap-2">
                      <span className="text-purple-400/70 min-w-[70px]">Size:</span>
                      <span>{formatFileSize(BigInt(Math.max(0, Math.floor(sentPreviewInfo.fileMetadata.fileSize))))}</span>
                    </div>
                  )}
                  {sentPreviewIsImage && sentPreviewInfo.fileMetadata.dimensions && (
                    <div className="flex items-start gap-2">
                      <span className="text-purple-400/70 min-w-[70px]">Dimensions:</span>
                      <span>{sentPreviewInfo.fileMetadata.dimensions.width} × {sentPreviewInfo.fileMetadata.dimensions.height}</span>
                    </div>
                  )}
                  {sentPreviewInfo.fileMetadata.mimeType && (
                    <div className="flex items-start gap-2">
                      <span className="text-purple-400/70 min-w-[70px]">Type:</span>
                      <span>{sentPreviewInfo.fileMetadata.mimeType}</span>
                    </div>
                  )}
                </div>
                <p className="text-xs text-purple-300/70">
                  Store this info if you need to resend or audit the attachment later.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div>
            <p className="text-sm font-semibold text-slate-300 mb-1">📥 Sender</p>
            <p className="font-mono text-xs text-slate-400 break-all">{sender}</p>
          </div>
        )}
        
        <div className="border-t border-slate-700/50 pt-3">
          {sentDateLabel && (
            <div className="flex items-center justify-between text-sm pb-2">
              <span className="text-slate-400">Sent:</span>
              <span className="text-slate-300">{sentDateLabel}</span>
            </div>
          )}
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">Lock:</span>
            <span className="text-slate-300">{unlockDate}</span>
          </div>
          {!localUnlocked && !isSent && (
            <div className="flex items-center justify-between text-sm mt-2">
              <span className="text-slate-400">Time left:</span>
              <CountdownTimer />
            </div>
          )}
          
          {/* Unlock requirement summary */}
          {(metadataLoaded || conditionType !== undefined) && (
            <div className="mt-3 pt-3 border-t border-slate-700/50">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Unlock Requirements:</span>
                <span className="font-semibold text-slate-300">
                  {metadataLoaded
                    ? hasTimeCondition && hasPaymentCondition
                      ? 'Time lock + payment'
                      : hasTimeCondition
                        ? 'Time lock'
                        : hasPaymentCondition
                          ? 'Payment only'
                          : 'None'
                    : fallbackHasTime && fallbackHasPayment
                      ? 'Time lock + payment'
                      : fallbackHasTime
                        ? 'Time lock'
                        : fallbackHasPayment
                          ? 'Payment only'
                          : 'None'}
                </span>
              </div>
            </div>
          )}
          
          {/* Transaction Hash - Mesaj gönderimi */}
          {transactionHash && (
            <div className="mt-3 pt-3 border-t border-slate-700/50">
              <div className="flex items-start gap-2 text-xs">
                <span className="text-slate-500 shrink-0">📝 Sent TX:</span>
                <a 
                  href={(explorerBaseUrl || "https://etherscan.io") + `/tx/${transactionHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-blue-400 hover:text-blue-300 underline break-all"
                  title={transactionHash}
                >
                  {transactionHash.slice(0, 10)}...{transactionHash.slice(-8)}
                </a>
              </div>
            </div>
          )}
          
          {/* Payment Transaction Hash - Ödeme yapıldıysa */}
          {paymentTxHash && (
            <div className="mt-2 pt-2 border-t border-slate-700/50">
              <div className="flex items-start gap-2 text-xs">
                <span className="text-slate-500 shrink-0">💰 Payment TX:</span>
                <a 
                  href={(explorerBaseUrl || "https://etherscan.io") + `/tx/${paymentTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-green-400 hover:text-green-300 underline break-all"
                  title={paymentTxHash}
                >
                  {paymentTxHash.slice(0, 10)}...{paymentTxHash.slice(-8)}
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
      
      <div className={`
        mt-4 rounded-lg border p-4 text-sm
        ${isSent 
          ? 'border-blue-800/30 bg-blue-950/40' 
          : localUnlocked
          ? 'border-green-800/30 bg-green-950/40'
          : 'border-slate-800/30 bg-slate-950/60'
        }
      `}>
        {summarySection}
        
        {/* 🔐 Unlock Button - Kilitli mesajlar için */}
        {!isSent && !localUnlocked && (
          <div className="mb-4 space-y-2">
            {shouldAttachPayment ? (
              <>
                {!timeReady && !isSent && timeRequirementLabel && (
                  <div className="hidden text-xs text-slate-200 flex items-center gap-2 justify-center font-mono">
                    
                  </div>
                )}
                <button
                  onClick={handlePaymentClick}
                  disabled={isPaymentActionPending || !canSubmitPayment}
                  className="w-full px-4 py-3 rounded-lg bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 
                    text-white font-semibold transition-all flex items-center justify-center gap-2 shadow-lg
                    disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isPaymentActionPending ? (
                    <>
                      <span className="animate-spin">⟳</span>
                      {isPaymentPending || isManualPaymentPending ? "Waiting for wallet..." : "Processing payment..."}
                    </>
                  ) : (
                    <>
                      <span>💰</span>
                      Pay {formatPaymentAmount(outstandingPayment, { zeroLabel: "0 ETH" })} to Unlock
                    </>
                  )}
                </button>
                {(!canSubmitPayment && !isPaymentActionPending) && (
                  <p className="mt-2 text-xs text-amber-200">
                    Connect your wallet on the correct network to complete the payment.
                  </p>
                )}
              </>
            ) : (
              <div className="space-y-2">
                {!timeReady && !isSent && timeRequirementLabel && (
                  <div className="text-xs text-slate-200 flex items-center gap-2 justify-center font-mono">
                    <span>⏳</span>
                    <span>Time left: <CountdownTimer /></span>
                  </div>
                )}
                <button
                  onClick={() => {
                    if (readMessage && timeReady && paymentReady) {
                      readMessage();
                    } else {
                      handleReadClick();
                    }
                  }}
                  disabled={isReading || isConfirming || !encryptionReady || !timeReady}
                  className="w-full px-4 py-3 rounded-lg bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 
                    text-white font-semibold transition-all transform hover:scale-[1.02]
                    disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100
                    flex items-center justify-center gap-2 shadow-lg"
                >
                  {isReading || isConfirming ? (
                    <>
                      <span className="animate-spin">⟳</span>
                      {isReading ? "Preparing..." : "Awaiting confirmation..."}
                    </>
                  ) : !metadataLoaded ? (
                    <>
                      <span className="animate-pulse">⏳</span>
                      Loading metadata...
                    </>
                  ) : !timeReady ? (
                    <>
                      <span>⏳</span>
                      Time lock still active
                    </>
                  ) : (
                    <>
                      <span>🔓</span>
                      {paymentRequirementLabel
                        ? `Open Message (${paymentRequirementLabel})`
                        : "Open Message"}
                    </>
                  )}
                </button>
              </div>
            )}
            {timeRequirementLabel && (
              <p className="text-xs text-slate-300 flex items-start gap-2 mt-2">
                <span>⏳</span>
                <span>{timeRequirementLabel}</span>
              </p>
            )}
            {(decryptError || preparePaymentError) && (
              <p className="text-xs text-red-400">
                {decryptError ?? `Payment could not be prepared: ${toReadableError(preparePaymentError)}`}
              </p>
            )}
          </div>
        )}
        
        {isSent ? (
          <div>
            <p className="italic text-blue-300/70 flex items-center gap-2 mb-3">
              <span>🚫</span> You cannot view the message you sent.
            </p>
            
            {/* Dosya indicator - gönderici tarafı */}
            {(() => {
              try {
                const cached = localStorage.getItem(`${cacheKey}-content-${id}`);
                if (cached && cached.startsWith('F:')) {
                  // Short hash'ten full hash'i bul
                  const shortHash = cached.substring(2, 8);
                  const fullHash = localStorage.getItem(`file-metadata-${shortHash}`);
                  return (
                    <div className="mt-2 p-2 rounded-lg bg-purple-900/20 border border-purple-400/30">
                      <p className="text-xs text-purple-300 flex items-center gap-1">
                        <span>📎</span> File attached (hash: {shortHash}...)
                      </p>
                    </div>
                  );
                }
              } catch {}
              return null;
            })()}
          </div>
        ) : localUnlocked ? (
          <div className="space-y-2">
            {localIsRead && !messageContent && isLoadingContent ? (
              // Okunan mesaj yükleniyor
              <div className="text-slate-400 italic flex items-center gap-2">
                <span className="animate-spin">⟳</span> Loading content...
              </div>
            ) : !localIsRead ? (
              // Henüz okunmamış, uyarı + butonu göster
              <>
                {/* File warning - Unlocked but not read yet */}
                {contentType === 1 && (
                  <div className="mb-3 rounded-lg bg-purple-900/20 border border-purple-400/40 p-3">
                    <p className="text-xs text-purple-300 italic flex items-center gap-2">
                      <span>⚠️</span>
                      <span>Verify sender before opening the file. Sender: <code className="font-mono text-purple-200">{sender.substring(0, 10)}...{sender.substring(sender.length - 8)}</code></span>
                    </p>
                  </div>
                )}
                
                <button
                  onClick={handleReadClick}
                  disabled={isReading || isConfirming || isLoadingContent || !encryptionReady}
                  className="w-full text-left px-3 py-2 rounded-lg bg-green-600/20 hover:bg-green-600/30 
                    border border-green-500/30 text-green-300 transition-colors
                    disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isReading || isConfirming || isLoadingContent ? (
                    <span className="flex items-center gap-2">
                      <span className="animate-spin">⟳</span> 
                      {isLoadingContent ? "Loading content..." : "Reading..."}
                    </span>
                  ) : !encryptionReady ? (
                    <span className="flex items-center gap-2">
                      <span className="animate-pulse">⏳</span> 
                      Encryption system loading...
                    </span>
                  ) : (
                    <span className="flex flex-col sm:flex-row sm:items-center sm:gap-2 text-left">
                      <span className="flex items-center gap-2 text-sm">
                        <span>🔓</span>
                        Read Message
                      </span>
                      {paymentRequirementLabel ? (
                        <span className="text-xs text-green-200/80">
                          Requires {paymentRequirementLabel} to open.
                        </span>
                      ) : (
                        <span className="text-xs text-green-200/80">No payment required.</span>
                      )}
                    </span>
                  )}
                </button>
              </>
            ) : messageContent ? (
              // İçerik yüklenmiş, göster
              <div className="space-y-2">
                {messageContent.startsWith('FILE:') || messageContent.startsWith('F:') ? (
                  // Dosya metadata göster
                  isLoadingFileMetadata ? (
                    <div className="text-slate-400 italic flex items-center gap-2">
                      <span className="animate-spin">⟳</span> Loading file metadata...
                    </div>
                  ) : fileMetadataState?.error ? (
                    <div className="space-y-2">
                      <div className="rounded-lg bg-yellow-900/10 border border-yellow-400/20 p-3">
                        <p className="text-sm text-yellow-300">File metadata could not be found.</p>
                        <p className="text-xs text-yellow-400 font-mono break-all">Short: {fileMetadataState.shortHash ?? messageContent?.substring(2, 8)}</p>
                        <p className="text-xs text-yellow-400">If the sender&apos;s device does not have the mapping, try the options below.</p>
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={async () => {
                              setIsLoadingFileMetadata(true);
                              try {
                                const fallbackContent = messageContent ?? '';
                                const sh = fileMetadataState.shortHash ?? (fallbackContent.startsWith('F:') ? fallbackContent.substring(2).trim().substring(0, 6) : undefined);
                                if (!sh) {
                                  setFileMetadataState({ error: true, message: 'Short hash not available' });
                                  setIsLoadingFileMetadata(false);
                                  return;
                                }
                                const resolved = await tryResolveShortHash(sh);
                                if (resolved) {
                                  try { localStorage.setItem(`file-metadata-${sh}`, resolved); } catch {}
                                  const resp = await fetch(`/api/ipfs/${resolved}`);
                                  if (resp.ok) {
                                    const payload = await resp.json();
                                    let normalized: NormalizedMetadata | null = null;

                                    if (isEncryptedMetadataEnvelope(payload)) {
                                      if (!activeSessionKey) {
                                        setFileMetadataState({
                                          error: true,
                                          requiresSessionKey: true,
                                          message: 'Session anahtarı olmadan metadata çözülemedi.',
                                          shortHash: sh
                                        });
                                        setIsLoadingFileMetadata(false);
                                        return;
                                      }

                                      try {
                                        const { parsed, metadataKeccak } = await decryptMetadataEnvelope(payload, activeSessionKey);
                                        normalized = normaliseMetadataPayload(parsed, { shortHash: sh, fullHash: resolved });
                                        if (metadataKeccak) {
                                          normalized.metadataKeccak = metadataKeccak;
                                        }
                                      } catch (decryptErr) {
                                        console.error('❌ Manual resolve metadata decrypt failed:', decryptErr);
                                        setFileMetadataState({ error: true, message: 'Metadata decrypt failed', shortHash: sh });
                                        setIsLoadingFileMetadata(false);
                                        return;
                                      }
                                    } else {
                                      normalized = normaliseMetadataPayload(payload, { shortHash: sh, fullHash: resolved });
                                    }

                                    if (normalized) {
                                      setFileMetadataState(normalized);
                                      if (cacheKey) {
                                        try {
                                          localStorage.setItem(`${cacheKey}-metadata-${sh}`, JSON.stringify(normalized));
                                        } catch (cacheErr) {
                                          console.warn('⚠️ Failed to cache manually resolved metadata:', cacheErr);
                                        }
                                      }
                                    } else {
                                      setFileMetadataState({ error: true, message: 'Metadata boş döndü', shortHash: sh });
                                    }
                                  } else {
                                    setFileMetadataState({ error: true, message: 'Resolved but fetch failed' });
                                  }
                                } else {
                                  setFileMetadataState({ error: true, message: 'Could not resolve short hash' });
                                }
                              } catch (e) {
                                setFileMetadataState({ error: true, message: String(e) });
                              } finally {
                                setIsLoadingFileMetadata(false);
                              }
                            }}
                            className="px-3 py-2 rounded bg-yellow-600/10 border border-yellow-500/20 text-yellow-200 text-sm"
                          >
                            Try resolve
                          </button>
                          <a
                            href={`https://app.pinata.cloud/search?query=${encodeURIComponent(fileMetadataState.shortHash ?? messageContent?.substring(2,8) ?? '')}`}
                            target="_blank"
                            rel="noreferrer"
                            className="px-3 py-2 rounded bg-yellow-600/10 border border-yellow-500/20 text-yellow-200 text-sm"
                          >
                            Open Pinata
                          </a>
                        </div>
                        {fileMetadataState.message && (
                          <p className="text-xs text-yellow-300/70 mt-2">{fileMetadataState.message}</p>
                        )}
                      </div>
                    </div>
                  ) : fileMetadataState ? (
                    fileMetadataState.type === 'text' ? (
                      <div className="space-y-3">
                        <div className="rounded-lg bg-slate-800/50 border border-slate-600/30 p-3">
                          <p className="text-sm text-slate-300 whitespace-pre-wrap">
                            {fileMetadataState.message ?? 'No message content available.'}
                          </p>
                        </div>
                        <div className="rounded-lg bg-blue-900/20 border border-blue-400/40 p-3 text-xs text-blue-100 space-y-2">
                          <div>
                            <span className="font-semibold">Storage pattern:</span> Content stored via encrypted metadata.
                          </div>
                          <div className="flex flex-col gap-1">
                            <span>
                              Short hash:
                              <code className="ml-2 font-mono text-blue-200">{fileMetadataState.shortHash ?? messageContent?.substring(2, 8)}</code>
                            </span>
                            {fileMetadataState.fullHash && (
                              <span className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
                                <span>Metadata hash:</span>
                                <code className="font-mono text-blue-200 break-all">{fileMetadataState.fullHash}</code>
                              </span>
                            )}
                            {fileMetadataState.createdAt && dayjs(fileMetadataState.createdAt).isValid() && (
                              <span>
                                Uploaded:
                                <span className="ml-2">
                                  {dayjs(fileMetadataState.createdAt).format('YYYY-MM-DD HH:mm:ss')}
                                </span>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {fileMetadataState.message && (
                          <div className="rounded-lg bg-slate-800/50 border border-slate-600/30 p-3">
                            <p className="text-sm text-slate-300 whitespace-pre-wrap">{fileMetadataState.message}</p>
                          </div>
                        )}
                        
                        {/* Dosya Bilgileri */}
                        <div className="rounded-lg bg-purple-900/20 border border-purple-400/40 p-4 space-y-3">
                          <div className="flex items-center gap-2 text-sm text-purple-300 font-semibold">
                            <span>📎</span> Attached File
                          </div>
                          
                          <div className="space-y-2 text-xs">
                            <div className="flex items-start gap-2">
                              <span className="text-purple-400/70 min-w-[60px]">File name:</span>
                              <span className="text-purple-200 break-all font-mono">{fileMetadataState.name ?? 'Unknown'}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-purple-400/70 min-w-[60px]">Size:</span>
                              <span className="text-purple-200">
                                {typeof fileMetadataState.size === 'number' && Number.isFinite(fileMetadataState.size)
                                  ? `${(fileMetadataState.size / 1024 / 1024).toFixed(2)} MB`
                                  : 'Unknown'}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-purple-400/70 min-w-[60px]">Type:</span>
                              <span className="text-purple-200">{fileMetadataState.mimeType ?? 'Unknown'}</span>
                            </div>
                          </div>
                          
                          {/* Resim önizlemesi */}
                          {isImageAttachment ? (
                            resolvedImageSrc ? (
                              <div className="pt-3 border-t border-purple-400/30">
                                <p className="text-xs text-purple-400 mb-2">Preview:</p>
                                <img
                                  src={resolvedImageSrc}
                                  alt={fileMetadataState.name ?? 'Attachment preview'}
                                  className="max-w-full h-auto rounded border border-purple-400/30 max-h-64 object-contain"
                                  loading="lazy"
                                  onError={(e) => {
                                    if (!useGatewayFallback && normalizedPreviewImageHash && !normalizedPreviewImageHash.startsWith('data:')) {
                                      console.warn('❌ Proxy preview failed, retrying via public IPFS gateway');
                                      setUseGatewayFallback(true);
                                      return;
                                    }

                                    if (!useThumbnailFallback && resolvedThumbnailSrc) {
                                      console.warn('❌ Attachment preview failed on gateway, falling back to thumbnail');
                                      setUseThumbnailFallback(true);
                                      return;
                                    }

                                    console.error('❌ Image preview failed after all fallbacks', e);
                                  }}
                                />
                                {useThumbnailFallback && resolvedPrimaryImageSrc && resolvedThumbnailSrc && (
                                  <p className="text-[11px] text-purple-300/70 mt-2">
                                    ⚠️ High-resolution preview unavailable. Showing thumbnail copy instead.
                                  </p>
                                )}
                              </div>
                            ) : (
                              <div className="pt-3 border-t border-purple-400/30 text-xs text-purple-400">
                                ⚠️ Image preview is not ready yet.
                              </div>
                            )
                          ) : (
                            <div className="pt-3 border-t border-purple-400/30 text-xs text-purple-400">
                              {!downloadSourceHash ? '⚠️ IPFS hash not available' : '⚠️ Not an image type'}
                            </div>
                          )}
                          
                          {/* İndirme Butonu */}
                          <div className="pt-3 border-t border-purple-400/30">
                            {resolvedDownloadUrl ? (
                              <>
                                <a
                                  href={resolvedDownloadUrl}
                                  download={fileMetadataState.name}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="block w-full text-center px-4 py-2 rounded-lg bg-purple-600/20 hover:bg-purple-600/30 
                                border border-purple-500/30 text-purple-200 transition-colors text-sm"
                                >
                                  📥 Download File
                                </a>
<div className="rounded-lg bg-red-900/20 border border-red-400/40 p-3">
                          <p className="text-xs text-red-300 font-semibold flex items-center gap-2 mb-2">
                            <span>🛡️</span> Security Warning
                          </p>
                          <ul className="text-xs text-red-200 space-y-1">
                            <li>⚠️ <strong>Verify the sender address:</strong></li>
                            <li className="font-mono text-xs bg-red-950/40 px-2 py-1 rounded ml-4 break-all">
                              {sender}
                            </li>
                            <li>🦠 Scan the file for malware before downloading.</li>
                          </ul>
                        </div>
                              </>
                            ) : (
                              <p className="text-xs text-purple-300/70 text-center">
                                Unable to locate the file hash in metadata. Ask the sender to re-share the attachment.
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  ) : null
                ) : contentType === 1 ? (
                  <IPFSFileDisplay metadataHash={messageContent} />
                ) : (
                  <p className="text-slate-200 whitespace-pre-wrap">{messageContent}</p>
                )}
                {localIsRead && (
                  <p className="text-xs text-green-400 flex items-center gap-1">
                    <span>✓</span> Read
                  </p>
                )}
              </div>
            ) : null}
            {decryptError && (
              <div className="rounded-lg border border-red-500/30 bg-red-900/20 px-3 py-2 text-xs text-red-200">
                {decryptError}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
