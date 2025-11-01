"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState, useRef, useCallback } from "react";
import { ethers } from "ethers";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import relativeTime from "dayjs/plugin/relativeTime";
import { useAccount, usePrepareContractWrite, useContractWrite, useWaitForTransaction, useNetwork, usePublicClient } from "../lib/wagmiCompat";
import * as secp256k1 from "@noble/secp256k1";
import { sha256 } from "@noble/hashes/sha2.js";
import { sealedMessageAbi } from "../lib/sealedMessageAbi"; // ✅ v7: Metadata preview
import { appConfig } from "../lib/env";
import { decodeEventLog, isAddress, formatUnits, parseUnits } from "viem";
import { useContractAddress, useHasContract } from "../lib/useContractAddress";
import { AttachmentBadge } from "./MessagePreview";
import { aesGcmEncryptMessage, aesGcmEncryptBytes, bytesToHex, hexToBytes } from "../lib/encryption";
import { generateFallbackKeyPair } from "../lib/fallbackKey";
import { getOrCreateEncryptionKey } from "../lib/keyAgreement";
import { getChainById } from "../lib/chains";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(relativeTime);

const DEFAULT_RECEIVER = "" as const;
const EUINT256_BYTE_CAP = 32;
const utf8Encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : undefined;
const ZERO_BYTES32 = ("0x" + "00".repeat(32)) as `0x${string}`;
const MAX_ATTACHMENT_BYTES = 1 * 1024 * 1024; // 1 MB limit

type EncryptedPayload = {
  uri: string;
  iv: `0x${string}`;
  authTag: `0x${string}`;
  ciphertextHash: `0x${string}`;
  metadataCid?: string;
  metadataKeccak?: `0x${string}`;
  metadataShortHash?: string;
  receiverPublicKey: `0x${string}`;
  senderPublicKey: `0x${string}`;
  ciphertextBytes: number;
  sessionKeyCommitment: `0x${string}`;
  receiverEnvelopeHash: `0x${string}`;
  escrowCiphertext: `0x${string}`;
  escrowIv: `0x${string}`;
  escrowAuthTag: `0x${string}`;
  escrowKeyVersion: number;
  receiverEnvelope: {
    ciphertext: `0x${string}`;
    iv: `0x${string}`;
    authTag: `0x${string}`;
  };
};

const truncateToUtf8Bytes = (value: string, byteLimit: number) => {
  if (!value) {
    return { value: "", truncated: false } as const;
  }

  if (!utf8Encoder) {
    const fallback = value.slice(0, byteLimit);
    return { value: fallback, truncated: fallback.length < value.length } as const;
  }

  const encoded = utf8Encoder.encode(value);
  if (encoded.length <= byteLimit) {
    return { value, truncated: false } as const;
  }

  let total = 0;
  let result = "";
  for (const char of Array.from(value)) {
    const chunk = utf8Encoder.encode(char);
    if (total + chunk.length > byteLimit) {
      break;
    }
    result += char;
    total += chunk.length;
  }

  return { value: result, truncated: true } as const;
};

const SHORT_HASH_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const SHORT_HASH_LENGTH = 6;

const generateShortHash = () => {
  let result = "";
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const randomBytes = new Uint8Array(SHORT_HASH_LENGTH);
    crypto.getRandomValues(randomBytes);
    for (let i = 0; i < SHORT_HASH_LENGTH; i++) {
      const index = randomBytes[i] % SHORT_HASH_ALPHABET.length;
      result += SHORT_HASH_ALPHABET[index];
    }
  } else {
    for (let i = 0; i < SHORT_HASH_LENGTH; i++) {
      const index = Math.floor(Math.random() * SHORT_HASH_ALPHABET.length);
      result += SHORT_HASH_ALPHABET[index];
    }
  }
  return result;
};

const toHex = (input: string | Uint8Array | number[] | undefined): `0x${string}` => {
  if (!input) {
    return "0x" as `0x${string}`;
  }

  if (typeof input === "string") {
    return (input.startsWith("0x") ? input : `0x${input}`) as `0x${string}`;
  }

  const arrayLike = input instanceof Uint8Array ? input : Uint8Array.from(input);
  const hex = Array.from(arrayLike)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return (`0x${hex}`) as `0x${string}`;
};

interface MessageFormProps {
  onSubmitted?: () => void;
}

export function MessageForm({ onSubmitted }: MessageFormProps) {
  
  const { isConnected, address: userAddress } = useAccount();
  const { chain } = useNetwork();
  const publicClient = usePublicClient();
  const contractAddress = useContractAddress();
  const hasContract = useHasContract();
  const cacheKey = useMemo(() => {
    if (!contractAddress) {
      return null;
    }
    const prefix = contractAddress.slice(0, 10).toLowerCase();
    const chainId = chain?.id;
    const chainSuffix = typeof chainId === "number" && Number.isFinite(chainId)
      ? `-${chainId}`
      : "";
    return `${prefix}-msg${chainSuffix}`;
  }, [contractAddress, chain?.id]);

  const currentChainConfig = useMemo(() => {
    if (!chain?.id) {
      return undefined;
    }
    return getChainById(chain.id);
  }, [chain?.id]);

  const nativeSymbol = currentChainConfig?.nativeCurrency.symbol ?? chain?.nativeCurrency?.symbol ?? "ETH";
  const nativeDecimals = currentChainConfig?.nativeCurrency.decimals ?? chain?.nativeCurrency?.decimals ?? 18;
  const weiPlaceholder = useMemo(() => {
    try {
      return parseUnits("0.001", nativeDecimals).toString();
    } catch (err) {
      console.warn("⚠️ Failed to compute wei placeholder", err);
  return "1000000000000000"; // Fallback ~0.001 in 18-decimal base units
    }
  }, [nativeDecimals]);
  
  // AES-256-GCM only - No version switching needed
  const isSealedContract = true; // Always use Sealed
  const encryptionReady = true;

  const [receiver, setReceiver] = useState<string>(DEFAULT_RECEIVER);
  const [content, setContent] = useState("");
  const [unlockMode, setUnlockMode] = useState<"preset" | "custom">("preset");
  const [presetDuration, setPresetDuration] = useState<number>(30); // 30 seconds default
  const [unlock, setUnlock] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  
  // ⏰ Time condition (optional)
  const [timeConditionEnabled, setTimeConditionEnabled] = useState(true); // Default enabled
  
  // 💰 Payment condition (optional)
  const [paymentAmount, setPaymentAmount] = useState<string>(""); // In wei (internal)
  const [paymentEnabled, setPaymentEnabled] = useState(false);
  const [paymentInputMode, setPaymentInputMode] = useState<"native" | "wei">("native"); // User-friendly input
  const [paymentInputValue, setPaymentInputValue] = useState<string>(""); // Visible value
  const [receiverEncryptionKey, setReceiverEncryptionKey] = useState<string>("");
  const [receiverKeySource, setReceiverKeySource] = useState<"registered" | "fallback" | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false); // Prevent double submission
  const [isLoadingReceiverKey, setIsLoadingReceiverKey] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [successToast, setSuccessToast] = useState(false);
  const [userTimezone, setUserTimezone] = useState<string>("UTC");
  const [selectedTimezone, setSelectedTimezone] = useState<string>("Europe/Istanbul");
  const [isPresetsOpen, setIsPresetsOpen] = useState(false);
  
  // File attachment state (IPFS - to be used in future)
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [ipfsHash, setIpfsHash] = useState<string>("");
  const [uploadingFile, setUploadingFile] = useState(false);
  const [contentType, setContentType] = useState<0 | 1>(0); // 0=TEXT, 1=IPFS_HASH
  const [metadataHash, setMetadataHash] = useState<string>(""); // Full metadata IPFS hash
  const [metadataKeccak, setMetadataKeccak] = useState<`0x${string}` | null>(null);
  const [metadataShortHash, setMetadataShortHash] = useState<string>(""); // 6-char reference stored on-chain
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);
  const [attachmentPreviewMime, setAttachmentPreviewMime] = useState<string>("");
  const [previewIpfsHash, setPreviewIpfsHash] = useState<string>(""); // IPFS hash of preview image
  const [isUploadingPreview, setIsUploadingPreview] = useState(false);
  const [thumbnailData, setThumbnailData] = useState<string | null>(null); // Auto-generated thumbnail (5x5 or 50x50)
  const [attachmentMetadata, setAttachmentMetadata] = useState<{
    type: string;
    size: number;
    name: string;
    dimensions?: { width: number; height: number };
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastPersistedHashRef = useRef<string | null>(null);
  const lastSentPreviewRef = useRef<{ 
    payload: string; 
    truncated: boolean; 
    original?: string | null;
    fileMetadata?: {
      fileName?: string | null;
      fileSize?: number | null;
      mimeType?: string | null;
      thumbnail?: string | null;
      dimensions?: { width: number; height: number } | null;
    } | null;
  } | null>(null);
  const [plannedUnlockTimestamp, setPlannedUnlockTimestamp] = useState<number>(() => Math.floor(Date.now() / 1000) + 30); // 30 seconds default
  
  // AES-256-GCM state
  const [encryptedData, setEncryptedData] = useState<EncryptedPayload | null>(null);
  const [isEncrypting, setIsEncrypting] = useState(false);
  const [chainTimestamp, setChainTimestamp] = useState<number | null>(null);
  const [txUnlockTime, setTxUnlockTime] = useState<number | null>(null);
  const UNLOCK_BUFFER_SECONDS = 0; // No forced buffer - use user's exact time selection

  // Simple validation for auto-loaded receiver key
  const isReceiverKeyValid = useMemo(() => {
    if (!receiverEncryptionKey || receiverEncryptionKey.length < 66) return false;
    const cleaned = receiverEncryptionKey.replace("0x", "");
    return cleaned.length === 66 && /^[0-9a-fA-F]+$/.test(cleaned);
  }, [receiverEncryptionKey]);

  const computeSafeUnlockTime = (
    chainSeconds: number | null,
    desiredSeconds: number | null,
    options: { includeWallClock?: boolean } = {}
  ) => {
    const { includeWallClock = true } = options;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const chainBaseline = typeof chainSeconds === "number" && Number.isFinite(chainSeconds)
      ? chainSeconds
      : nowSeconds;
    const sanitizedDesired = typeof desiredSeconds === "number" && Number.isFinite(desiredSeconds)
      ? desiredSeconds
      : nowSeconds;
    const safetyBufferSeconds = 90;
    const minimumUnlock = Math.max(chainBaseline, includeWallClock ? nowSeconds : chainBaseline) + safetyBufferSeconds;
    return Math.max(sanitizedDesired, minimumUnlock);
  };
  
  // Form validation state
  const [isFormValid, setIsFormValid] = useState(false);

  // Prevent hydration mismatch & Set default time on client side
  useEffect(() => {
    setMounted(true);
    // Set default value with local timezone on client-side
    // datetime-local input expects value in browser's local time
    const localTime = new Date();
    // No time addition - show current time
    
    // Local time in YYYY-MM-DDTHH:mm format (don't convert to UTC!)
    const year = localTime.getFullYear();
    const month = String(localTime.getMonth() + 1).padStart(2, '0');
    const day = String(localTime.getDate()).padStart(2, '0');
    const hours = String(localTime.getHours()).padStart(2, '0');
    const minutes = String(localTime.getMinutes()).padStart(2, '0');
    const formatted = `${year}-${month}-${day}T${hours}:${minutes}`;
    
    setUnlock(formatted);
    setPlannedUnlockTimestamp(Math.floor(Date.now() / 1000) + presetDuration);
    // Get user's timezone
    setUserTimezone(dayjs.tz.guess());
  }, []);

  // Auto-load receiver encryption key from contract or generate fallback
  useEffect(() => {
    if (!mounted || !receiver || !isAddress(receiver) || !contractAddress || !publicClient) {
      setReceiverEncryptionKey("");
      setReceiverKeySource(null);
      return;
    }

    const loadReceiverKey = async () => {
      setIsLoadingReceiverKey(true);
      try {
        // Query contract for registered key
        const registeredKey = await publicClient.readContract({
          address: contractAddress as `0x${string}`,
          abi: sealedMessageAbi,
          functionName: "getEncryptionKey",
          args: [receiver as `0x${string}`]
        }) as `0x${string}`;

        if (registeredKey && registeredKey !== "0x" && registeredKey.length > 4) {
          // Registered key found
          setReceiverEncryptionKey(registeredKey);
          setReceiverKeySource("registered");
        } else {
          // No registered key, use fallback
          const fallbackPair = generateFallbackKeyPair(receiver);
          const fallbackKeyHex = bytesToHex(fallbackPair.publicKey) as `0x${string}`;
          setReceiverEncryptionKey(fallbackKeyHex);
          setReceiverKeySource("fallback");
        }
      } catch (err) {
        console.error("❌ Failed to load receiver key:", err);
        console.error("Full error details:", JSON.stringify(err, null, 2));
        // Use fallback on error
        const fallbackPair = generateFallbackKeyPair(receiver);
        const fallbackKeyHex = bytesToHex(fallbackPair.publicKey) as `0x${string}`;
        setReceiverEncryptionKey(fallbackKeyHex);
        setReceiverKeySource("fallback");
      } finally {
        setIsLoadingReceiverKey(false);
      }
    };

    loadReceiverKey();
  }, [mounted, receiver, contractAddress, publicClient]);

  // Refresh chain timestamp periodically to guard against client clock drift
  useEffect(() => {
    let cancelled = false;

    if (!publicClient) {
      return;
    }

    const updateTimestamp = async () => {
      try {
        const latestBlock = await publicClient.getBlock({ blockTag: 'latest' });
        if (!cancelled) {
          setChainTimestamp(Number(latestBlock.timestamp));
        }
      } catch (err) {
        console.error("⚠️ Chain timestamp fetch failed", err);
      }
    };

    updateTimestamp();
    const intervalId = setInterval(updateTimestamp, 30_000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [publicClient]);

  // Encrypt content on-demand (when user clicks send) - EMELMARKET PATTERN
  const encryptContent = async () => {
    if (!contractAddress || !userAddress) {
      throw new Error("Missing contract or user address");
    }

    if (!isReceiverKeyValid || !receiverEncryptionKey) {
      throw new Error("Receiver encryption key required");
    }

    const receiverKeyNormalized = receiverEncryptionKey.startsWith("0x")
      ? receiverEncryptionKey
      : `0x${receiverEncryptionKey}`;
    const receiverKeyBytes = hexToBytes(receiverKeyNormalized);
    if (receiverKeyBytes.length !== 33) {
      throw new Error("Receiver encryption key must be a compressed secp256k1 public key (33-byte hex)");
    }

    let dataToEncrypt = "";
    let uploadedMetadataCid: string | null = null;
    let uploadedMetadataKeccak: `0x${string}` | null = null;
    let resolvedShortHash = metadataShortHash || null;
  let metadataPayload: Record<string, unknown> | null = null;
  let publicMetadataPayload: Record<string, unknown> | null = null;
    let metadataOptions:
      | {
          label?: string;
          fileInfo?: {
            fileName?: string | null;
            fileSize?: number | null;
            mimeType?: string | null;
            dimensions?: { width: number; height: number } | null;
          };
          debugType?: string;
          explicitKeccak?: `0x${string}`;
        }
      | undefined;

    const uploadMetadataJson = async (
      payload: Record<string, unknown>,
      shortHash: string,
      options: {
        label?: string;
        fileInfo?: { fileName?: string | null; fileSize?: number | null; mimeType?: string | null; dimensions?: { width: number; height: number } | null };
        debugType?: string;
        explicitKeccak?: `0x${string}`;
      } = {},
      extraMapping?: { publicHash?: string | null }
    ): Promise<{ cid: string; keccak: `0x${string}`; json: string; storedKeccak?: `0x${string}` }> => {
      const label = options.label ?? "message-meta";
      const payloadType = typeof (payload as any)?.type === "string" ? (payload as any).type : label;

      const metadataJson = JSON.stringify(payload);
      const metadataKeccak = ethers.keccak256(ethers.toUtf8Bytes(metadataJson)) as `0x${string}`;
      const keccakForMapping = options.explicitKeccak ?? metadataKeccak;
      const metadataBlob = new Blob([metadataJson], { type: "application/json" });
      const metadataFile = new File([metadataBlob], `${label}.json`, { type: "application/json" });

      const formData = new FormData();
      formData.append("file", metadataFile);
      formData.append(
        "pinataMetadata",
        JSON.stringify({
          name: `${label}-${shortHash}`,
          keyvalues: {
            shortHash,
            type: "message-metadata",
            category: payloadType
          }
        })
      );

      const pinataApiKey = process.env.NEXT_PUBLIC_PINATA_API_KEY;
      const pinataSecretKey = process.env.NEXT_PUBLIC_PINATA_SECRET_KEY;

      if (!pinataApiKey || !pinataSecretKey) {
        throw new Error("IPFS credentials not configured");
      }

      const response = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
        method: "POST",
        headers: {
          pinata_api_key: pinataApiKey,
          pinata_secret_api_key: pinataSecretKey
        },
        body: formData
      });

      if (!response.ok) {
        throw new Error("Metadata upload failed");
      }

      const data = await response.json();
      const metadataHashValue = data.IpfsHash as string;

      const mappingKey = `file-metadata-${shortHash}`;
      try {
        localStorage.setItem(mappingKey, metadataHashValue);
      } catch (err) {
        console.warn("⚠️ Failed to save metadata mapping to localStorage:", err);
      }

      try {
        const response = await fetch("/api/metadata-mapping", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shortHash,
            fullHash: metadataHashValue,
            metadataKeccak: keccakForMapping ?? undefined,
            fileName: options.fileInfo?.fileName ?? undefined,
            fileSize: options.fileInfo?.fileSize ?? undefined,
            mimeType: options.fileInfo?.mimeType ?? undefined,
            publicHash: extraMapping?.publicHash ?? undefined
          })
        });

        if (!response.ok) {
          console.warn("⚠️ Backend mapping POST failed:", response.status, response.statusText);
        }
      } catch (err) {
        console.warn("⚠️ Failed to call metadata mapping API:", err);
      }

      try {
      } catch (e) {
        console.warn("Failed to write metadata mapping cache:", e);
      }

      return {
        cid: metadataHashValue,
        keccak: metadataKeccak,
        json: metadataJson,
        storedKeccak: keccakForMapping
      };
    };

    const uploadPublicMetadataJson = async (
      payload: Record<string, unknown>,
      shortHash: string
    ): Promise<{ cid: string; keccak: `0x${string}`; json: string }> => {
      const label = "message-public";
      const metadataJson = JSON.stringify(payload);
      const metadataKeccak = ethers.keccak256(ethers.toUtf8Bytes(metadataJson)) as `0x${string}`;
      const metadataBlob = new Blob([metadataJson], { type: "application/json" });
      const metadataFile = new File([metadataBlob], `${label}-${shortHash}.json`, { type: "application/json" });

      const formData = new FormData();
      formData.append("file", metadataFile);
      formData.append(
        "pinataMetadata",
        JSON.stringify({
          name: `${label}-${shortHash}`,
          keyvalues: {
            shortHash,
            type: "message-public"
          }
        })
      );

      const pinataApiKey = process.env.NEXT_PUBLIC_PINATA_API_KEY;
      const pinataSecretKey = process.env.NEXT_PUBLIC_PINATA_SECRET_KEY;

      if (!pinataApiKey || !pinataSecretKey) {
        throw new Error("IPFS credentials not configured");
      }

      const response = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
        method: "POST",
        headers: {
          pinata_api_key: pinataApiKey,
          pinata_secret_api_key: pinataSecretKey
        },
        body: formData
      });

      if (!response.ok) {
        throw new Error("Public metadata upload failed");
      }

      const data = await response.json();
      const metadataHashValue = data.IpfsHash as string;

      try {
        localStorage.setItem(`file-public-metadata-${shortHash}`, metadataHashValue);
      } catch (err) {
        console.warn("⚠️ Failed to save public metadata mapping to localStorage:", err);
      }

      return { cid: metadataHashValue, keccak: metadataKeccak, json: metadataJson };
    };

    const uploadCiphertextBinary = async (
      bytes: Uint8Array,
      shortHash: string | null
    ): Promise<{ cid: string; uri: string }> => {
      const pinataApiKey = process.env.NEXT_PUBLIC_PINATA_API_KEY;
      const pinataSecretKey = process.env.NEXT_PUBLIC_PINATA_SECRET_KEY;

      if (!pinataApiKey || !pinataSecretKey) {
        throw new Error("IPFS credentials not configured");
      }

    const fileName = shortHash ? `cipher-${shortHash}.bin` : `cipher-${Date.now()}.bin`;
    const arrayBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(arrayBuffer).set(bytes);
    const blob = new Blob([arrayBuffer], { type: "application/octet-stream" });
      const file = new File([blob], fileName, { type: "application/octet-stream" });

      const formData = new FormData();
      formData.append("file", file);
      formData.append(
        "pinataMetadata",
        JSON.stringify({
          name: fileName,
          keyvalues: {
            shortHash: shortHash ?? undefined,
            type: "sealed-ciphertext"
          }
        })
      );

      const response = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
        method: "POST",
        headers: {
          pinata_api_key: pinataApiKey,
          pinata_secret_api_key: pinataSecretKey
        },
        body: formData
      });

      if (!response.ok) {
        throw new Error("Ciphertext upload failed");
      }

    const data = await response.json();
    const cid = data.IpfsHash as string;

      if (shortHash) {
        try {
          localStorage.setItem(`ciphertext-${shortHash}`, cid);
        } catch (err) {
          console.warn("⚠️ Failed to cache ciphertext mapping:", err);
        }
      }

      return { cid, uri: `ipfs://${cid}` };
    };

    if (ipfsHash && attachedFile) {
      let shortHash = metadataShortHash;
      if (!shortHash) {
        shortHash = generateShortHash();
        setMetadataShortHash(shortHash);
      }
      resolvedShortHash = shortHash;

      const sanitizedNote = content.trim();
      const fileData = {
        type: "file",
        version: 1,
        shortHash,
        hasAttachment: true,
        message: sanitizedNote || null,
        attachment: {
          ipfsHash,
          fileName: attachedFile.name,
          fileSize: attachedFile.size,
          mimeType: attachedFile.type,
          dimensions: attachmentMetadata?.dimensions ?? null
        },
        preview: {
          text: sanitizedNote ? sanitizedNote.slice(0, 160) : null,
          encrypted: true,
          fileName: attachedFile.name,
          fileSize: attachedFile.size,
          mimeType: attachedFile.type,
          thumbnail: thumbnailData || null,
          ipfsHash: previewIpfsHash || null,
          dimensions: attachmentMetadata?.dimensions ?? null
        },
        createdAt: new Date().toISOString()
      };

      metadataPayload = fileData;
      publicMetadataPayload = {
        type: "file",
        version: 1,
        shortHash,
        hasAttachment: true,
        attachment: {
          fileName: attachedFile.name,
          fileSize: attachedFile.size,
          mimeType: attachedFile.type,
          dimensions: attachmentMetadata?.dimensions ?? null
        },
        preview: {
          thumbnail: thumbnailData || null,
          mimeType: attachedFile.type || null,
          ipfsHash: previewIpfsHash || null,
          containsNote: Boolean(sanitizedNote)
        },
        createdAt: new Date().toISOString()
      };
      metadataOptions = {
        label: "message-meta",
        fileInfo: {
          fileName: attachedFile.name,
          fileSize: attachedFile.size,
          mimeType: attachedFile.type,
          dimensions: attachmentMetadata?.dimensions ?? null
        },
        debugType: "sent-metadata-upload"
      };

      dataToEncrypt = `F:${shortHash}`;
      lastSentPreviewRef.current = {
        payload: dataToEncrypt,
        truncated: false,
        original: sanitizedNote || attachedFile?.name || null,
        fileMetadata: {
          fileName: attachedFile.name,
          fileSize: attachedFile.size,
          mimeType: attachedFile.type,
          thumbnail: thumbnailData || null,
          dimensions: attachmentMetadata?.dimensions || null
        }
      };
      
    } else {
      const plainText = content.trim();
      if (!plainText) {
        throw new Error("Message content cannot be empty");
      }

      const encoderInstance = utf8Encoder ?? new TextEncoder();
      const plainBytes = encoderInstance.encode(plainText);

      if (plainBytes.length > EUINT256_BYTE_CAP) {
        let shortHash = metadataShortHash;
        if (!shortHash) {
          shortHash = generateShortHash();
          setMetadataShortHash(shortHash);
        }
        resolvedShortHash = shortHash;

        const textMetadata = {
          type: "text",
          version: 1,
          shortHash,
          hasAttachment: false,
          length: plainBytes.length,
          message: plainText,
          preview: {
            encrypted: true,
            text: plainText.slice(0, 160)
          },
          createdAt: new Date().toISOString()
        };

        metadataPayload = textMetadata;
        publicMetadataPayload = {
          type: "text",
          version: 1,
          shortHash,
          hasAttachment: false,
          contentType: "text",
          preview: {
            encrypted: true,
            hasMessage: true
          },
          createdAt: new Date().toISOString()
        };
        metadataOptions = {
          label: "message-text",
          fileInfo: {
            fileName: `${shortHash}.txt`,
            fileSize: plainBytes.length,
            mimeType: "text/plain; charset=utf-8"
          },
          debugType: "sent-text-metadata-upload"
        };

        dataToEncrypt = `F:${shortHash}`;
        lastSentPreviewRef.current = {
          payload: dataToEncrypt,
          truncated: false,
          original: plainText
        };
        
      } else {
        let shortHash = metadataShortHash;
        if (!shortHash) {
          shortHash = generateShortHash();
          setMetadataShortHash(shortHash);
        }
        resolvedShortHash = shortHash;
        const { value: truncatedContent, truncated: wasTruncated } = truncateToUtf8Bytes(plainText, EUINT256_BYTE_CAP);
        if (wasTruncated) {
          console.warn("⚠️ Message truncated unexpectedly despite length check");
        }
        dataToEncrypt = truncatedContent;
        lastSentPreviewRef.current = {
          payload: truncatedContent,
          truncated: wasTruncated,
          original: plainText
        };
        const inlineMetadata = {
          type: "text-inline",
          version: 1,
          shortHash,
          hasAttachment: false,
          length: plainText.length,
          message: plainText,
          createdAt: new Date().toISOString()
        };

        metadataPayload = inlineMetadata;
        publicMetadataPayload = {
          type: "text-inline",
          version: 1,
          shortHash,
          hasAttachment: false,
          contentType: "text-inline",
          preview: {
            encrypted: true,
            hasMessage: true
          },
          createdAt: new Date().toISOString()
        };
        metadataOptions = {
          label: "message-inline",
          fileInfo: {
            fileName: `${shortHash}.meta.json`,
            fileSize: plainText.length,
            mimeType: "application/json"
          },
          debugType: "sent-inline-metadata-upload"
        };
      }
    }
    
    if (!dataToEncrypt) {
      throw new Error("No content to encrypt");
    }

    const sessionKey = crypto.getRandomValues(new Uint8Array(32));
    const sessionKeyHex = bytesToHex(sessionKey) as `0x${string}`;
    const sessionKeyCommitment = ethers.keccak256(sessionKey) as `0x${string}`;

    // Create wallet client for signature
    const provider = new ethers.BrowserProvider((window as any).ethereum);
    const signer = await provider.getSigner();
    const walletClient = {
      signMessage: async ({ message }: { account?: string; message: string }) => {
        return await signer.signMessage(message);
      }
    };

    // Derive sender's encryption keypair from wallet signature (NOT random!)
  const senderKeyPair = await getOrCreateEncryptionKey(walletClient, userAddress!);
    
    // Compute ECDH shared secret
    const sharedSecret = secp256k1.getSharedSecret(senderKeyPair.privateKey, receiverKeyBytes, true);
  const derivedKey = sharedSecret.slice(1, 33); // Skip prefix byte (0x02/0x03), take next 32 bytes

    const encryptionResult = await aesGcmEncryptMessage(dataToEncrypt, { key: sessionKey });
    const combinedCiphertext = new Uint8Array(encryptionResult.ciphertext.length + encryptionResult.authTag.length);
    combinedCiphertext.set(encryptionResult.ciphertext);
    combinedCiphertext.set(encryptionResult.authTag, encryptionResult.ciphertext.length);

    const ciphertextHash = ethers.keccak256(combinedCiphertext) as `0x${string}`;
    const cipherUpload = await uploadCiphertextBinary(combinedCiphertext, resolvedShortHash);

    let metadataPlaintextJson: string | null = null;
    let metadataPlaintextKeccak: `0x${string}` | null = null;
    let encryptedMetadataEnvelope: Record<string, unknown> | null = null;
    let publicMetadataCid: string | null = null;

    if (publicMetadataPayload && resolvedShortHash) {
      try {
        const publicUpload = await uploadPublicMetadataJson(publicMetadataPayload, resolvedShortHash);
        publicMetadataCid = publicUpload.cid;
      } catch (publicErr) {
        console.warn("⚠️ Public metadata upload failed, continuing without public summary:", publicErr);
      }
    }

    if (metadataPayload && resolvedShortHash) {
      metadataPlaintextJson = JSON.stringify(metadataPayload);
      metadataPlaintextKeccak = ethers.keccak256(ethers.toUtf8Bytes(metadataPlaintextJson)) as `0x${string}`;

      const encryptedMetadata = await aesGcmEncryptMessage(metadataPlaintextJson, {
        key: sessionKey
      });

      encryptedMetadataEnvelope = {
        version: 1,
        type: "encrypted-metadata",
        shortHash: resolvedShortHash,
        encoding: "aes-256-gcm",
        ciphertext: bytesToHex(encryptedMetadata.ciphertext),
        iv: bytesToHex(encryptedMetadata.iv),
        authTag: bytesToHex(encryptedMetadata.authTag),
        length: metadataPlaintextJson.length,
        keccak: metadataPlaintextKeccak,
        createdAt: new Date().toISOString(),
        hasAttachment: Boolean((metadataPayload as any).hasAttachment),
        payloadType: (metadataPayload as any)?.type ?? metadataOptions?.label ?? "unknown"
      };
    }

    if (encryptedMetadataEnvelope && resolvedShortHash) {
      const metadataUploadOptions = {
        ...(metadataOptions ?? {}),
        explicitKeccak: metadataPlaintextKeccak ?? undefined
      };

      const metadataUpload = await uploadMetadataJson(
        encryptedMetadataEnvelope,
        resolvedShortHash,
        metadataUploadOptions,
        { publicHash: publicMetadataCid }
      );

      if (metadataUpload) {
        setMetadataHash(metadataUpload.cid);
        setMetadataKeccak(metadataPlaintextKeccak ?? metadataUpload.keccak);
        uploadedMetadataCid = metadataUpload.cid;
        uploadedMetadataKeccak = metadataPlaintextKeccak ?? metadataUpload.keccak;
      }
    }

    const ivHex = bytesToHex(encryptionResult.iv) as `0x${string}`;
    const authTagHex = bytesToHex(encryptionResult.authTag) as `0x${string}`;
    const senderPublicKeyHex = bytesToHex(senderKeyPair.publicKey) as `0x${string}`;

    const receiverSessionWrap = await aesGcmEncryptBytes(sessionKey, { key: derivedKey });
    const receiverEnvelopeCipherHex = bytesToHex(receiverSessionWrap.ciphertext) as `0x${string}`;
    const receiverEnvelopeIvHex = bytesToHex(receiverSessionWrap.iv) as `0x${string}`;
    const receiverEnvelopeTagHex = bytesToHex(receiverSessionWrap.authTag) as `0x${string}`;
  const receiverEnvelopeHash = ethers.keccak256(
      ethers.concat([
        receiverSessionWrap.ciphertext,
        receiverSessionWrap.iv,
        receiverSessionWrap.authTag,
        senderKeyPair.publicKey
      ])
    ) as `0x${string}`;

    const wrapResponse = await fetch("/api/escrow/wrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionKeyHex,
        sessionKeyCommitment,
        metadataShortHash: resolvedShortHash ?? null
      })
    });

    if (!wrapResponse.ok) {
      const text = await wrapResponse.text();
      throw new Error(`Escrow wrap failed: ${wrapResponse.status} ${text}`);
    }

    const wrapJson = await wrapResponse.json();
    if (!wrapJson?.ok || !wrapJson?.wrap) {
      throw new Error("Escrow wrap response missing payload");
    }

    const escrowCiphertextHex = wrapJson.wrap.ciphertext as string;
    const escrowIvHex = wrapJson.wrap.iv as string;
    const escrowAuthTagHex = wrapJson.wrap.authTag as string;
    const escrowKeyVersion = Number(wrapJson.wrap.keyVersion ?? 1);

    if (!escrowCiphertextHex || !escrowIvHex || !escrowAuthTagHex) {
      throw new Error("Escrow wrap returned incomplete data");
    }

    const escrowCipherBytes = ethers.getBytes(escrowCiphertextHex);
    const escrowIvBytes = ethers.getBytes(escrowIvHex);
    const escrowAuthTagBytes = ethers.getBytes(escrowAuthTagHex);
    if (escrowCipherBytes.length !== 32 || escrowIvBytes.length !== 12 || escrowAuthTagBytes.length !== 16) {
      throw new Error("Escrow wrap lengths are invalid");
    }

    const envelopeResponse = await fetch("/api/escrow/envelope", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        commitment: sessionKeyCommitment,
        receiverEnvelopeHash,
        ciphertextHash,
        metadataShortHash: resolvedShortHash ?? null,
        metadataKeccak: uploadedMetadataKeccak ?? null,
        senderPublicKey: senderPublicKeyHex,
        envelope: {
          ciphertext: receiverEnvelopeCipherHex,
          iv: receiverEnvelopeIvHex,
          authTag: receiverEnvelopeTagHex
        }
      })
    });

    if (!envelopeResponse.ok) {
      const text = await envelopeResponse.text();
      throw new Error(`Failed to persist receiver envelope: ${envelopeResponse.status} ${text}`);
    }

    const envelopeJson = await envelopeResponse.json();
    if (!envelopeJson?.ok) {
      throw new Error("Receiver envelope persistence failed");
    }


    const payload: EncryptedPayload = {
      uri: cipherUpload.uri,
      iv: ivHex,
      authTag: authTagHex,
      ciphertextHash,
      metadataCid: uploadedMetadataCid ?? undefined,
      metadataKeccak: uploadedMetadataKeccak ?? undefined,
      metadataShortHash: resolvedShortHash ?? undefined,
      receiverPublicKey: receiverKeyNormalized as `0x${string}`,
      senderPublicKey: senderPublicKeyHex,
      ciphertextBytes: combinedCiphertext.length,
      sessionKeyCommitment,
      receiverEnvelopeHash,
      escrowCiphertext: escrowCiphertextHex as `0x${string}`,
      escrowIv: escrowIvHex as `0x${string}`,
      escrowAuthTag: escrowAuthTagHex as `0x${string}`,
      escrowKeyVersion,
      receiverEnvelope: {
        ciphertext: receiverEnvelopeCipherHex,
        iv: receiverEnvelopeIvHex,
        authTag: receiverEnvelopeTagHex
      }
    };

    return payload;
  };

  // Form validation
  useEffect(() => {
    let valid = false;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const customValid = unlockMode === "custom"
      ? (() => {
          try {
            const parsed = dayjs.tz(unlock, selectedTimezone);
            return parsed.isValid() && parsed.unix() > nowSeconds;
          } catch {
            return false;
          }
        })()
      : true;

    // Base validations - NO encryption check (will encrypt on submit)
    // Time validation only required if time condition is enabled
    const timeValid = !timeConditionEnabled || (plannedUnlockTimestamp > nowSeconds && customValid);
    
    // At least one condition must be enabled (time or payment)
    const hasCondition = timeConditionEnabled || paymentEnabled;
    
    valid = isConnected &&
      !!receiver &&
      isAddress(receiver) &&
      receiver.toLowerCase() !== userAddress?.toLowerCase() &&
      (content.trim().length > 0 || ipfsHash.length > 0) && // Message OR file must exist
      isReceiverKeyValid &&
      timeValid &&
      hasCondition; // At least one condition required
    
    setIsFormValid(valid);
  }, [
    isConnected,
    receiver,
    userAddress,
    content,
    ipfsHash,
    isReceiverKeyValid,
    plannedUnlockTimestamp,
    unlockMode,
    unlock,
    selectedTimezone,
    timeConditionEnabled,
    paymentEnabled
  ]);
  
  const generateAttachmentPreview = useCallback((file: File): Promise<string | null> => {
    if (!file.type.startsWith("image/")) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onerror = () => resolve(null);
      reader.onload = () => {
        resolve(reader.result as string);
      };
      reader.readAsDataURL(file);
    });
  }, []);
  
  useEffect(() => {
    if (unlockMode !== "custom") {
      return;
    }
    if (!unlock) {
      return;
    }

    try {
      const parsed = dayjs.tz(unlock, selectedTimezone);
      if (!parsed.isValid()) {
        return;
      }
      const unix = parsed.unix();
      if (unix !== plannedUnlockTimestamp) {
        setPlannedUnlockTimestamp(unix);
      }
    } catch (err) {
      console.warn("⚠️ Unable to parse custom unlock", err);
    }
  }, [unlockMode, unlock, selectedTimezone, plannedUnlockTimestamp]);
  
  // File upload function (IPFS - not currently in use)
  const handleFileSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // File size check (max 1MB)
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setError(`❌ File too large! Maximum: 1MB (Selected: ${(file.size / 1024 / 1024).toFixed(2)}MB)`);
      return;
    }

    // SECURITY: Supported file types (whitelist)
    const allowedTypes: Record<string, string[]> = {
      // Images
      "image/png": [".png"],
      "image/jpeg": [".jpg", ".jpeg"],
      "image/gif": [".gif"],
      "image/webp": [".webp"],
      "image/svg+xml": [".svg"],
      // Documents
      "application/pdf": [".pdf"],
      "application/msword": [".doc"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      "application/vnd.ms-excel": [".xls"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.ms-powerpoint": [".ppt"],
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
      "text/plain": [".txt", ".log"],
      "application/json": [".json"],
      // Archives
      "application/zip": [".zip"],
      "application/x-zip-compressed": [".zip"],
      "application/x-rar-compressed": [".rar"],
      "application/vnd.rar": [".rar"],
      "application/x-7z-compressed": [".7z"],
      // Video (for small sizes)
      "video/mp4": [".mp4"],
      "video/webm": [".webm"]
      // NOTE: Executable formats excluded for security reasons
    };

    // SECURITY: File extension and MIME type check
    const fileExtension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] || "";
    const extensionWhitelist = new Set<string>();
    for (const extList of Object.values(allowedTypes)) {
      for (const ext of extList) {
        extensionWhitelist.add(ext);
      }
    }

    const mimeExtensions = allowedTypes[file.type] ?? null;
    const isExtensionAllowed = fileExtension ? extensionWhitelist.has(fileExtension) : false;

    if (!mimeExtensions && !isExtensionAllowed) {
      const allowedFormats = Array.from(extensionWhitelist).sort().join(", ");
      setError(`❌ Unsupported file type!\n\n✅ Allowed formats:\n${allowedFormats}\n\n⚠️ Only these formats are accepted for security reasons.`);
      return;
    }

    // Extension validation (MIME type spoofing prevention)
    if (mimeExtensions && fileExtension && !mimeExtensions.includes(fileExtension)) {
      setError(`⚠️ File extension (${fileExtension}) doesn't match MIME type (${file.type || "unknown"})! Potential security risk.`);
      return;
    }
    
  const generatedShortHash = generateShortHash();
  setMetadataShortHash(generatedShortHash);
    setAttachedFile(file);
    setError(null);

    // Store attachment metadata
    setAttachmentMetadata({
      type: file.type,
      size: file.size,
      name: file.name
    });

    // Auto-generate thumbnails for images
    if (file.type.startsWith('image/')) {
      try {
        // Generate preview (for display in form)
        const preview = await generateAttachmentPreview(file);
        if (preview) {
          const mime = file.type || "image/*";
          setAttachmentPreview(preview);
          setAttachmentPreviewMime(mime);
          
          // Upload preview to IPFS
          await uploadPreviewToIPFS(preview, mime);
        }

  // Auto-generate small thumbnail (25×25) for message list
        const { generateThumbnail } = await import('@/types/message');
    const thumbnail = await generateThumbnail(file, 25);
    setThumbnailData(thumbnail);

        // Get image dimensions
        const img = new Image();
        img.onload = () => {
          setAttachmentMetadata(prev => ({
            ...prev!,
            dimensions: { width: img.width, height: img.height }
          }));
        };
        img.src = preview || '';

      } catch (err) {
        console.warn("⚠️ Unable to generate preview/thumbnail", err);
        setAttachmentPreview(null);
        setThumbnailData(null);
      }
    } else {
      // Non-image files: no thumbnail
      setAttachmentPreview(null);
      setAttachmentPreviewMime("");
      setThumbnailData(null);
    }

    // IPFS'e yükle
    await uploadToIPFS(file);
  };
  
  // 📤 Upload preview image to IPFS
  const uploadPreviewToIPFS = async (base64Data: string, mimeType?: string) => {
    setIsUploadingPreview(true);
    try {
      // Base64'ü blob'a çevir
      const response = await fetch(base64Data);
      const blob = await response.blob();
      const inferredType = mimeType || blob.type || "image/png";
      const extension = inferredType.includes("png")
        ? "png"
        : inferredType.includes("jpeg") || inferredType.includes("jpg")
        ? "jpg"
        : inferredType.includes("gif")
        ? "gif"
        : inferredType.includes("webp")
        ? "webp"
        : inferredType.includes("svg")
        ? "svg"
        : "img";
      const fileName = `preview.${extension}`;
      const file = new File([blob], fileName, { type: inferredType });
      
      const formData = new FormData();
      formData.append("file", file);
      
      const pinataApiKey = process.env.NEXT_PUBLIC_PINATA_API_KEY;
      const pinataSecretKey = process.env.NEXT_PUBLIC_PINATA_SECRET_KEY;
      
      if (!pinataApiKey || !pinataSecretKey) {
        console.warn("⚠️ IPFS credentials not configured, preview won't be uploaded");
        return;
      }
      
      const uploadResponse = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
        method: "POST",
        headers: {
          pinata_api_key: pinataApiKey,
          pinata_secret_api_key: pinataSecretKey,
        },
        body: formData,
      });
      
      if (!uploadResponse.ok) {
        throw new Error(`Preview upload failed: ${uploadResponse.statusText}`);
      }

      const data = await uploadResponse.json();
      const hash = data.IpfsHash;

      setPreviewIpfsHash(hash);
    } catch (err) {
      console.warn("⚠️ Preview upload failed:", err);
    } finally {
      setIsUploadingPreview(false);
    }
  };
  
  const uploadToIPFS = async (file: File) => {
    setUploadingFile(true);
    setError(null);
    
    try {
      // Pinata ücretsiz IPFS servisi
      const formData = new FormData();
      formData.append("file", file);
      
      // Use public Pinata gateway for demo (add your own API key in production)
      // NOTE: This is for demo purposes, add to .env.local for production:
      // NEXT_PUBLIC_PINATA_API_KEY=your_key
      // NEXT_PUBLIC_PINATA_SECRET_KEY=your_secret
      
      const pinataApiKey = process.env.NEXT_PUBLIC_PINATA_API_KEY;
      const pinataSecretKey = process.env.NEXT_PUBLIC_PINATA_SECRET_KEY;
      
      if (!pinataApiKey || !pinataSecretKey) {
        throw new Error("⚠️ IPFS credentials not configured. Please add NEXT_PUBLIC_PINATA_API_KEY and NEXT_PUBLIC_PINATA_SECRET_KEY to .env.local");
      }
      
      const response = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
        method: "POST",
        headers: {
          pinata_api_key: pinataApiKey,
          pinata_secret_api_key: pinataSecretKey,
        },
        body: formData,
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Upload failed: ${errorData.error || response.statusText}`);
      }

      const data = await response.json();
      const hash = data.IpfsHash;

      setIpfsHash(hash);
      setContentType(1); // IPFS_HASH
      
      // NOTE: Don't clear message! Store IPFS hash in separate state
      // Allow user to send both message and file
      
    } catch (err) {
      console.error("❌ IPFS upload error:", err);
      const errorMsg = err instanceof Error ? err.message : "Upload failed";
      setError(`IPFS Upload Error: ${errorMsg}`);
      setAttachedFile(null);
      setMetadataShortHash("");
      setIpfsHash("");
      setAttachmentPreview(null);
      setAttachmentPreviewMime("");
    } finally {
      setUploadingFile(false);
    }
  };
  
  const removeAttachment = () => {
    setAttachedFile(null);
    setMetadataShortHash("");
    setMetadataHash("");
    setIpfsHash("");
    setPreviewIpfsHash("");
    setMetadataKeccak(null);
    setContentType(0); // TEXT
    setContent(""); // İçeriği temizle
    setAttachmentPreview(null);
    setAttachmentPreviewMime("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Prepare contract write with proper parameters
  const basePrepareReady = isFormValid && !!contractAddress;
  const preparedUnlockTime = useMemo(() => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    
    // If time condition is disabled, use current time (payment-only message)
    if (!timeConditionEnabled) {
      return nowSeconds;
    }
    
    // If time condition enabled, use txUnlockTime if available, otherwise use plannedUnlockTimestamp
    const timeToUse = txUnlockTime !== null ? txUnlockTime : plannedUnlockTimestamp;
    
    const computed = computeSafeUnlockTime(chainTimestamp, timeToUse, { includeWallClock: false });
    
    // If computed time is in past or very near future, use current time
    if (computed <= nowSeconds + 60) {
      return nowSeconds;
    }
    
    return computed;
  }, [timeConditionEnabled, chainTimestamp, txUnlockTime, plannedUnlockTimestamp]);

  const hasEncryptionPayload = useMemo(() => {
    if (!encryptedData) return false;
    return Boolean(
      encryptedData.uri &&
      encryptedData.iv &&
      encryptedData.authTag &&
      encryptedData.ciphertextHash &&
      encryptedData.escrowCiphertext &&
      encryptedData.escrowIv &&
      encryptedData.escrowAuthTag &&
      encryptedData.sessionKeyCommitment &&
      encryptedData.receiverEnvelopeHash
    );
  }, [encryptedData]);

  const shouldPrepare = basePrepareReady && hasEncryptionPayload && !isEncrypting && preparedUnlockTime !== null;
  
  // Calculate mask: 0x01=time, 0x02=payment, 0x03=both
  const conditionMask = useMemo(() => {
    let mask = 0;
    const nowSeconds = Math.floor(Date.now() / 1000);
    
    // Time condition: Checkbox enabled AND time is in future
    if (timeConditionEnabled && preparedUnlockTime && preparedUnlockTime > nowSeconds + 60) {
      mask |= 0x01; // Time condition active
    }
    
    // Payment condition: Checkbox enabled and amount > 0
    if (paymentEnabled && paymentAmount && BigInt(paymentAmount) > 0n) {
      mask |= 0x02; // Payment condition active
    }
    
    // If no conditions selected (shouldn't happen due to validation), default to time-only
    // Otherwise return the actual mask (0x01=time, 0x02=payment, 0x03=both)
    if (mask === 0) {
      console.warn("⚠️ No conditions selected, defaulting to time-only");
      return 0x01;
    }
    
    return mask;
  }, [timeConditionEnabled, preparedUnlockTime, paymentEnabled, paymentAmount]);
  
  // Sealed Contract Write - AES-256-GCM encrypted with payment support
  const { config: configSealed, error: prepareError } = usePrepareContractWrite({
    address: contractAddress as `0x${string}`,
    abi: sealedMessageAbi, // ✅ SealedMessage ABI
    functionName: "sendMessage",
    args: encryptedData && isSealedContract && preparedUnlockTime !== null
      ? [
          receiver as `0x${string}`,                                           // receiver
          encryptedData.uri,                                                   // uri (ciphertext location)
          encryptedData.iv,                                                    // iv (12 bytes)
          encryptedData.authTag,                                               // authTag (16 bytes)
          encryptedData.ciphertextHash,                                        // ciphertext hash
          (encryptedData.metadataKeccak ?? ZERO_BYTES32),                      // metadata keccak (optional)
          encryptedData.escrowCiphertext,                                      // escrow ciphertext (wrapped session key)
          encryptedData.escrowIv,                                              // escrow IV
          encryptedData.escrowAuthTag,                                         // escrow auth tag
          encryptedData.sessionKeyCommitment,                                  // commitment of session key
          encryptedData.receiverEnvelopeHash,                                  // receiver envelope hash (ECDH)
          encryptedData.escrowKeyVersion,                                      // escrow key version
          BigInt(preparedUnlockTime),                                          // unlockTime
          BigInt(paymentAmount || '0'),                                        // requiredPayment
          conditionMask                                                         // conditionMask
        ]
      : undefined,
    enabled: shouldPrepare && isSealedContract
  });

  // Log prepareError if it exists
  useEffect(() => {
    if (prepareError) {
      console.error("❌❌❌ PREPARE ERROR DETECTED:", prepareError);
      console.error("Error shortMessage:", (prepareError as any).shortMessage);
      console.error("Error details:", (prepareError as any).details);
      console.error("Error metaMessages:", (prepareError as any).metaMessages);
      const shortMessage = (prepareError as any).shortMessage || prepareError.message;
      setError(
        shortMessage
          ? `⛔ On-chain simülasyon başarısız: ${shortMessage}`
          : "⛔ On-chain simulation failed. Please try again in a few seconds."
      );
    }
  }, [prepareError]);
  
  // Sealed write hook
  const contractWrite = useContractWrite(configSealed);
  const { data, isLoading: isPending, write, error: writeError } = contractWrite;
  const isWriteReady = Boolean(configSealed.request);

  const { isLoading: isConfirming, isSuccess } = useWaitForTransaction({ 
    hash: data?.hash 
  });

  // UTC ve local time gösterimi
  const unlockTimeDisplay = useMemo(() => {
    if (!mounted) return { local: "", utc: "", relative: "", selected: "" };
    
    try {
      const activeUnlock = txUnlockTime ?? plannedUnlockTimestamp;
      const timestamp = activeUnlock * 1000;
      const localTime = dayjs(timestamp).format("DD MMM YYYY, HH:mm");
      const utcTime = dayjs(timestamp).utc().format("DD MMM YYYY, HH:mm");
      const selectedTime = dayjs(timestamp).tz(selectedTimezone).format("DD MMM YYYY, HH:mm");
      const relative = dayjs(timestamp).fromNow();
      
      return { local: localTime, utc: utcTime, selected: selectedTime, relative };
    } catch (err) {
  console.error("Date display error:", err);
      return { local: "---", utc: "---", selected: "---", relative: "---" };
    }
  }, [plannedUnlockTimestamp, mounted, selectedTimezone, txUnlockTime]);

  useEffect(() => {
    if (!isSuccess) {
      return;
    }

    const txHash = data?.hash ?? null;
    if (txHash && lastPersistedHashRef.current === txHash) {
      return;
    }
    if (txHash) {
      lastPersistedHashRef.current = txHash;
    }

    let cancelled = false;

    const persistAndReset = async () => {
      const cidToSave = encryptedData?.metadataCid || metadataHash;
      const shortHashToSave = encryptedData?.metadataShortHash || metadataShortHash || (cidToSave ? cidToSave.substring(0, 6) : "");
      if (cidToSave && shortHashToSave) {
        const mappingKey = `file-metadata-${shortHashToSave}`;
        localStorage.setItem(mappingKey, cidToSave);
      }

      const latestAttachment = attachedFile;
      const latestShortHash = encryptedData?.metadataShortHash || metadataShortHash;

      let resolvedMessageId: string | undefined;
      if (publicClient && txHash) {
        try {
          const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
          for (const log of receipt.logs) {
            if (contractAddress && log.address?.toLowerCase() !== contractAddress.toLowerCase()) {
              continue;
            }
            try {
              const decoded = decodeEventLog({
                abi: sealedMessageAbi,
                data: log.data,
                topics: log.topics
              });
              if (decoded.eventName === "MessageStored") {
                const rawId = decoded.args?.messageId as bigint | string | undefined;
                if (rawId !== undefined && rawId !== null) {
                  resolvedMessageId = typeof rawId === "bigint" ? rawId.toString() : String(rawId);
                  break;
                }
              }
            } catch (err) {
              // Ignore logs that do not match the event shape we expect
            }
          }

          if (resolvedMessageId && attachmentPreview) {
            const previewPayload = {
              messageId: resolvedMessageId,
              previewDataUrl: attachmentPreview,
              mimeType: attachmentPreviewMime,
              shortHash: latestShortHash ?? null,
              fileName: latestAttachment?.name ?? null
            };

            const response = await fetch("/api/message-preview", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(previewPayload)
            });
            if (!response.ok) {
              console.warn("⚠️ Preview store responded with", response.status, response.statusText);
            }
          }
        } catch (err) {
          console.warn("⚠️ Failed to load transaction receipt for preview", err);
        }
      }

      try {
        const previewPayload = lastSentPreviewRef.current;
        if (previewPayload && resolvedMessageId) {
          const storageKey = cacheKey
            ? `${cacheKey}-sent-preview-${resolvedMessageId}`
            : `sent-preview-${resolvedMessageId}`;
          const payloadToStore = {
            payload: previewPayload.payload,
            truncated: previewPayload.truncated,
            original: previewPayload.original,
            fileMetadata: previewPayload.fileMetadata || (latestAttachment
              ? {
                  fileName: latestAttachment.name,
                  fileSize: latestAttachment.size,
                  mimeType: latestAttachment.type,
                  thumbnail: thumbnailData || null,
                  dimensions: attachmentMetadata?.dimensions || null
                }
              : null)
          };
          const serialized = JSON.stringify(payloadToStore);
          localStorage.setItem(storageKey, serialized);
          if (contractAddress) {
            const legacyKey = `${contractAddress.slice(0, 10)}-msg-sent-preview-${resolvedMessageId}`;
            localStorage.setItem(legacyKey, serialized);
          }
          if (cacheKey) {
            localStorage.removeItem(`sent-preview-${resolvedMessageId}`);
          }
        }
      } catch (err) {
        console.warn('⚠️ Failed to write sent preview cache', err);
      }
      lastSentPreviewRef.current = null;

      if (cancelled) {
        return;
      }

      setReceiver(DEFAULT_RECEIVER);
      setContent("");
      setAttachedFile(null);
      setAttachmentPreview(null);
      setAttachmentPreviewMime("");
      setIpfsHash("");
      setMetadataHash("");
      setMetadataKeccak(null);
      setMetadataShortHash("");
      setPreviewIpfsHash("");
      setContentType(0);
      setPresetDuration(300);
      setUnlockMode("preset");
      setIsPresetsOpen(false);
      const resetLocal = new Date();
      const resetYear = resetLocal.getFullYear();
      const resetMonth = String(resetLocal.getMonth() + 1).padStart(2, '0');
      const resetDay = String(resetLocal.getDate()).padStart(2, '0');
      const resetHours = String(resetLocal.getHours()).padStart(2, '0');
      const resetMinutes = String(resetLocal.getMinutes()).padStart(2, '0');
      const resetFormatted = `${resetYear}-${resetMonth}-${resetDay}T${resetHours}:${resetMinutes}`;
      setUnlock(resetFormatted);
      const defaultPlanned = Math.floor(Date.now() / 1000) + 300;
      setPlannedUnlockTimestamp(defaultPlanned);
      setEncryptedData(null);
      setTxUnlockTime(null);
      setError(null);
      setSuccessToast(true);
      setTimeout(() => setSuccessToast(false), 5000);
      setTimeout(() => {
        onSubmitted?.();
      }, 100);
    };

    void persistAndReset();

    return () => {
      cancelled = true;
    };
  }, [
    isSuccess,
    encryptedData,
    metadataHash,
    metadataShortHash,
    attachmentPreview,
    attachmentPreviewMime,
    publicClient,
    data?.hash,
    contractAddress,
    cacheKey,
    attachedFile,
    onSubmitted
  ]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    // Prevent double submission
    if (isSubmitting) {
      return;
    }
    
    if (!isConnected) {
      setError("Connect your wallet first.");
      return;
    }
    if (!receiver || !isAddress(receiver)) {
      setError("Enter a valid recipient address.");
      return;
    }
    if (receiver.toLowerCase() === userAddress?.toLowerCase()) {
      setError("❌ You cannot send a message to yourself. Please enter a different recipient address.");
      return;
    }
    if (content.trim().length === 0) {
      setError("Message content cannot be empty.");
      return;
    }
    if (!isReceiverKeyValid || !receiverEncryptionKey) {
      setError("Receiver encryption key is required.");
      return;
    }
    
    // At least one condition must be selected
    if (!timeConditionEnabled && !paymentEnabled) {
      setError("❌ Please enable at least one unlock condition (Time or Payment).");
      return;
    }
    
    const nowSeconds = Math.floor(Date.now() / 1000);
    let desiredUnlock = nowSeconds; // Default to current time (for payment-only)

    // Only process time if time condition is enabled
    if (timeConditionEnabled) {
      if (unlockMode === "preset") {
        desiredUnlock = nowSeconds + presetDuration;
        setPlannedUnlockTimestamp(desiredUnlock);
      } else {
        try {
          const parsed = dayjs.tz(unlock, selectedTimezone);
          if (!parsed.isValid()) {
            setError("Please select a valid date.");
            return;
          }
          desiredUnlock = parsed.unix();
          setPlannedUnlockTimestamp(desiredUnlock);
        } catch (err) {
          console.warn("Invalid custom date", err);
          setError("Please select a valid date.");
          return;
        }
      }

      // Validate future time only if time condition is enabled
      if (desiredUnlock <= nowSeconds) {
        setError("Unlock time must be in the future.");
        return;
      }
    }

    setError(null);
    
    // Set submitting flag
    setIsSubmitting(true);
    
    // Encrypt content
    setIsEncrypting(true);
    
    try {
      let latestChainTimestamp = chainTimestamp;
      if (publicClient) {
        try {
          const latestBlock = await publicClient.getBlock({ blockTag: 'latest' });
          latestChainTimestamp = Number(latestBlock.timestamp);
          setChainTimestamp(latestChainTimestamp);
        } catch (blockErr) {
          console.warn("⚠️ Unable to refresh chain timestamp before send", blockErr);
        }
      }

      // Calculate safe unlock time based on whether time condition is enabled
      let safeUnlockForTx: number;
      if (timeConditionEnabled) {
        safeUnlockForTx = computeSafeUnlockTime(latestChainTimestamp ?? chainTimestamp, desiredUnlock);
      } else {
        // Payment-only: Use current time (no time lock)
        safeUnlockForTx = Math.floor(Date.now() / 1000);
      }
      setTxUnlockTime(safeUnlockForTx);

      // Initialize encryption if not already initialized
      // Encrypt content
      const encrypted = await encryptContent();
      setEncryptedData(encrypted);

      // If file exists, also save metadata hash
      if (encrypted.metadataCid) {
        setMetadataHash(encrypted.metadataCid);
      }
      if (encrypted.metadataKeccak) {
        setMetadataKeccak(encrypted.metadataKeccak);
      }
      if (encrypted.metadataShortHash) {
        setMetadataShortHash(encrypted.metadataShortHash);
      }
      
      setIsEncrypting(false);

      // Send transaction directly with ethers instead of waiting for wagmi hooks
      try {
        if (!contractAddress) {
          throw new Error("Contract address not available");
        }
        
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const signer = await provider.getSigner();
        const contract = new ethers.Contract(contractAddress as string, sealedMessageAbi, signer);

        const tx = await contract.sendMessage(
          receiver as `0x${string}`,
          encrypted.uri,
          encrypted.iv,
          encrypted.authTag,
          encrypted.ciphertextHash,
          encrypted.metadataKeccak ?? ethers.ZeroHash,
          encrypted.escrowCiphertext,
          encrypted.escrowIv,
          encrypted.escrowAuthTag,
          encrypted.sessionKeyCommitment,
          encrypted.receiverEnvelopeHash,
          encrypted.escrowKeyVersion,
          BigInt(safeUnlockForTx),
          BigInt(paymentAmount || '0'),
          conditionMask
        );
        setError(`⏳ Transaction sent: ${tx.hash.slice(0, 10)}...`);
        
        const receipt = await tx.wait();
        // Extract message ID from MessageSealed event and save metadata CID
        try {
          const iface = new ethers.Interface(sealedMessageAbi);
          const messageSealedEvent = receipt.logs
            .map((log: any) => {
              try {
                return iface.parseLog(log);
              } catch {
                return null;
              }
            })
            .find((parsed: any) => parsed?.name === 'MessageSealed');
          
          if (messageSealedEvent && encrypted.metadataCid) {
            const messageId = messageSealedEvent.args[0]?.toString();
            if (messageId) {
              const metadataCidKey = `metadata-cid-${messageId}`;
              localStorage.setItem(metadataCidKey, encrypted.metadataCid);
            }
          }
        } catch (err) {
          console.warn('⚠️ Failed to extract message ID or save metadata CID:', err);
        }
        
        setError(null);
        
        // Reset form
        setContent("");
        setEncryptedData(null);
        setMetadataHash("");
        setMetadataKeccak(null);
        setMetadataShortHash("");
        setIsSubmitting(false); // Reset flag
        
        if (onSubmitted) {
          onSubmitted();
        }
        
      } catch (txErr: any) {
        console.error("❌ Transaction error:", txErr);
        setError(`Transaction failed: ${txErr.message || 'Unknown error'}`);
        setIsSubmitting(false); // Reset flag on error
      }
      
    } catch (err) {
      console.error("❌ Error:", err);
      setError(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setIsEncrypting(false);
      setIsSubmitting(false); // Reset flag on error
    }
  };

  // Prevent hydration mismatch
  if (!mounted) {
    return (
      <div className="space-y-4 rounded-xl border border-cyber-blue/30 bg-midnight/80 p-6 shadow-glow-blue">
        <p className="text-sm text-text-light/60">Loading...</p>
      </div>
    );
  }

  // Connect your wallet
  if (!isConnected) {
    return (
      <div className="space-y-4 rounded-xl border border-cyber-blue/30 bg-midnight/80 p-6 shadow-glow-blue">
        <p className="text-sm text-text-light/60">Connect your wallet...</p>
      </div>
    );
  }

  // Show warning if no contract
  if (!hasContract || !contractAddress) {
    return (
      <div className="space-y-4 rounded-xl border border-orange-700/50 bg-orange-900/20 p-6 shadow-lg backdrop-blur">
        <div className="flex items-start gap-3">
          <span className="text-2xl">⚠️</span>
          <div>
            <h3 className="font-semibold text-orange-300">No Contract on This Network</h3>
            <p className="mt-2 text-sm text-orange-200/80">
              SealedMessage is not deployed on this network yet. Please select one of the supported networks:
            </p>
            <ul className="mt-2 space-y-1 text-sm text-orange-200/80">
              <li>✅ Sepolia Testnet</li>
              <li>✅ Base Sepolia</li>
              <li>✅ Monad Testnet</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Success Toast */}
      {successToast && (
        <div className="fixed top-4 right-4 z-50 animate-in slide-in-from-right duration-300">
          <div className="rounded-lg border border-green-500/50 bg-green-900/80 px-4 py-3 shadow-lg">
            <p className="text-green-100 flex items-center gap-2">
              <span>✅</span> Message sent successfully!
            </p>
          </div>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-xl border border-cyber-blue/30 bg-midnight/80 p-6 shadow-glow-blue"
      >
      {contractAddress && (
        <div className="rounded-lg border border-cyber-blue/40 bg-cyber-blue/10 px-4 py-2 text-xs text-cyber-blue">
          <p>
            Active contract: <span className="font-semibold">AES-256-GCM 🔐</span>
            {" "}
            (<span className="font-mono">{`${contractAddress.slice(0, 6)}…${contractAddress.slice(-4)}`}</span>)
          </p>
        </div>
      )}
      <div className="hidden rounded-lg border border-amber-400/50 bg-amber-900/20 px-4 py-2 text-xs text-amber-200">
        <p className="font-semibold">Heads-up: Sealed relayer fees</p>
        <p className="mt-1 leading-relaxed">
          Proof validation, decrypt, and bridge operations consume relayer credits. Decide whether the app, the relayer, or end users cover these costs before going live.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="receiver" className="text-sm font-semibold uppercase tracking-wide text-cyber-blue">
          Receiver Address
        </label>
        <input
          id="receiver"
          type="text"
          value={receiver}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setReceiver(event.target.value)}
          placeholder="0x..."
          className={`rounded-lg border px-4 py-3 font-mono text-sm text-text-light outline-none transition focus:ring-2 ${
            receiver && receiver.toLowerCase() === userAddress?.toLowerCase()
              ? 'border-red-500 bg-red-950/30 focus:border-red-500 focus:ring-red-500/60'
              : 'border-cyber-blue/40 bg-midnight/60 focus:border-cyber-blue focus:ring-cyber-blue/60'
          }`}
        />
        {receiver && receiver.toLowerCase() === userAddress?.toLowerCase() ? (
          <p className="text-xs text-red-400">
            ⚠️ This is your address! You cannot send a message to yourself.
          </p>
        ) : (
          <p className="text-xs text-text-light/60">
            🔒 Only this address can read the message (not even the sender!)
          </p>
        )}
      </div>

      {/* Receiver Encryption Key Status - Auto-loaded */}
      {receiver && isAddress(receiver) && (
        <div className="rounded-lg border border-cyber-blue/30 bg-cyber-blue/5 p-4">
          <div className="flex items-start gap-3">
            {isLoadingReceiverKey ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-cyber-blue border-t-transparent" />
                <div>
                  <p className="text-sm font-medium text-cyber-blue">Loading encryption key...</p>
                  <p className="text-xs text-text-light/60 mt-1">Querying contract for receiver&apos;s registered key</p>
                </div>
              </>
            ) : receiverKeySource === "registered" ? (
              <>
                <span className="text-2xl">✅</span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-emerald-400">Receiver has registered encryption key</p>
                  <p className="text-xs text-text-light/60 mt-1">
                    Using receiver&apos;s on-chain registered public key for ECDH encryption
                  </p>
                  <code className="mt-2 block text-xs font-mono text-emerald-300/80 break-all">
                    {receiverEncryptionKey.slice(0, 20)}...{receiverEncryptionKey.slice(-20)}
                  </code>
                </div>
              </>
            ) : receiverKeySource === "fallback" ? (
              <>
                <span className="text-2xl">⚠️</span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-amber-400">Using fallback encryption</p>
                  <p className="text-xs text-text-light/60 mt-1">
                    Receiver hasn&apos;t registered yet. Using deterministic fallback key derived from their address.
                  </p>
                  <p className="text-xs text-amber-300/80 mt-2">
                    💡 Message stays fully encrypted with Sealed's fallback key. Ask the receiver to connect once and register their key for stronger forward secrecy.
                  </p>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor="content" className="text-sm font-semibold uppercase tracking-wide text-cyber-blue">
          Message {content.length > 0 && <span className="text-xs text-gray-400 ml-2">({content.length} characters)</span>}
        </label>
        <textarea
          id="content"
          value={content}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setContent(event.target.value)}
          placeholder="Write and Seal"
          disabled={!!attachedFile} // Cannot write message when file attached
          className="min-h-[120px] rounded-lg border border-cyber-blue/40 bg-midnight/60 px-4 py-3 text-text-light outline-none transition focus:border-cyber-blue focus:ring-2 focus:ring-cyber-blue/60 disabled:opacity-50 disabled:cursor-not-allowed"
        />
        
        {/* File Attachment Button */}
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf,text/plain,.log,application/json,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/zip,application/x-zip-compressed,application/x-rar-compressed,application/vnd.rar,application/x-7z-compressed,video/mp4,video/webm"
            onChange={handleFileSelect}
            className="hidden"
          />
          
          {!attachedFile ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingFile}
              className="flex items-center gap-2 rounded-lg border border-purple-500/40 bg-purple-900/20 px-4 py-2 text-sm font-medium text-purple-300 transition hover:bg-purple-900/30 hover:border-purple-500/60 disabled:opacity-50"
            >
              <span>📎</span>
              {uploadingFile ? "Uploading..." : "Attach File"}
            </button>
          ) : (
            <div className="space-y-2">
              <AttachmentBadge
                fileName={attachedFile.name}
                fileSize={attachedFile.size}
                mimeType={attachedFile.type}
                thumbnail={thumbnailData || attachmentPreview || undefined}
                onRemove={removeAttachment}
              />
              
              {/* Additional metadata info */}
              <div className="flex items-center gap-3 text-xs text-green-400/80">
                {ipfsHash && (
                  <span className="font-mono">
                    ✅ IPFS: {ipfsHash.slice(0, 8)}...{ipfsHash.slice(-6)}
                  </span>
                )}
                {attachmentMetadata?.dimensions && (
                  <span>
                    📐 {attachmentMetadata.dimensions.width}×{attachmentMetadata.dimensions.height}
                  </span>
                )}
                {thumbnailData && (
                  <span>
                    🖼️ Thumbnail ready (25×25)
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
        
        <p className="text-xs text-text-light/60">
          {attachedFile 
            ? "📎 The attached file is uploaded to IPFS and recorded on-chain with your message."
            : "💡 Optional: You can add an image, document, archive, or small video attachment (max 1 MB)."
          }
        </p>
      </div>
      
      {/* Condition Type Selection - Tab Buttons */}
      <div className="flex flex-col">
        <div className="flex items-center gap-2 mb-3">
          <input
            type="checkbox"
            id="timeConditionEnabled"
            checked={timeConditionEnabled}
            onChange={(e) => setTimeConditionEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-cyber-blue/40 bg-midnight/60 text-green-500 focus:ring-2 focus:ring-green-500/60"
          />
          <label htmlFor="timeConditionEnabled" className="text-sm font-semibold uppercase tracking-wide text-text-light/80">
            ⏰ Unlock Time (Optional)
          </label>
        </div>
        
        {/* Unlock Time Form */}
        {timeConditionEnabled && (
        <div className="rounded-lg border-2 border-neon-green bg-neon-green/10 p-4">
          <div className="flex flex-col gap-3">
            {/* Mode Selection */}
            <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setUnlockMode("preset");
              setIsPresetsOpen(!isPresetsOpen);
              setPlannedUnlockTimestamp(Math.floor(Date.now() / 1000) + presetDuration);
            }}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition ${
              unlockMode === "preset"
                ? "bg-aurora/20 border-2 border-aurora text-aurora"
                : "bg-midnight/40 border border-cyber-blue/30 text-text-light/60 hover:text-text-light"
            }`}
          >
            ⚡ Quick Select {unlockMode === "preset" && (isPresetsOpen ? "▼" : "▶")}
          </button>
          <button
            type="button"
            onClick={() => {
              setUnlockMode("custom");
              setIsPresetsOpen(false); // Custom'a geçince preset'leri kapat
            }}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition ${
              unlockMode === "custom"
                ? "bg-aurora/20 border-2 border-aurora text-aurora"
                : "bg-midnight/40 border border-cyber-blue/30 text-text-light/60 hover:text-text-light"
            }`}
          >
            📅 Custom Date
          </button>
        </div>

        {/* Preset Durations */}
        {unlockMode === "preset" && isPresetsOpen && (
          <div className="grid grid-cols-3 gap-2 animate-in slide-in-from-top duration-200">
            {[
              { label: "⚡ Now (10s)", value: 10 },
              { label: "30 seconds", value: 30 },
              { label: "1 minute", value: 60 },
              { label: "5 minutes", value: 300 },
              { label: "15 minutes", value: 900 },
              { label: "1 hour", value: 3600 },
              { label: "2 hours", value: 7200 },
              { label: "6 hours", value: 21600 },
              { label: "1 day", value: 86400 },
              { label: "3 days", value: 259200 },
              { label: "1 week", value: 604800 },
              { label: "1 month", value: 2592000 }
            ].map(({ label, value }) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setPresetDuration(value);
                  setPlannedUnlockTimestamp(Math.floor(Date.now() / 1000) + value);
                  setIsPresetsOpen(false); // Dropdown'ı kapat
                }}
                className={`rounded-lg px-3 py-2 text-sm transition ${
                  presetDuration === value
                    ? "bg-neon-orange/20 border-2 border-neon-orange text-neon-orange shadow-glow-orange"
                    : "bg-midnight/40 border border-cyber-blue/30 text-text-light hover:border-cyber-blue/60"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Custom Date Picker */}
        {unlockMode === "custom" && (
          <div className="space-y-3">
            <input
              id="unlock"
              type="datetime-local"
              value={unlock}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setUnlock(event.target.value)}
              className="w-full rounded-lg border border-cyber-blue/40 bg-midnight/60 px-4 py-3 text-text-light outline-none transition focus:border-neon-orange focus:ring-2 focus:ring-neon-orange/60"
            />
            
            {/* Timezone Seçici */}
            <div className="flex flex-col gap-2">
              <label htmlFor="timezone" className="text-xs font-medium text-text-light/60">
                🌐 Saat Dilimi (Timezone)
              </label>
              <select
                id="timezone"
                value={selectedTimezone}
                onChange={(e) => setSelectedTimezone(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950/70 px-4 py-2 text-sm text-slate-100 outline-none transition focus:border-neon-orange focus:ring-2 focus:ring-neon-orange/60"
              >
                <optgroup label="🇹🇷 Turkey">
                  <option value="Europe/Istanbul">İstanbul (UTC+3)</option>
                </optgroup>
                <optgroup label="🇪🇺 Avrupa">
                  <option value="Europe/London">London (UTC+0)</option>
                  <option value="Europe/Paris">Paris (UTC+1)</option>
                  <option value="Europe/Berlin">Berlin (UTC+1)</option>
                  <option value="Europe/Moscow">Moscow (UTC+3)</option>
                </optgroup>
                <optgroup label="🇺🇸 Amerika">
                  <option value="America/New_York">New York (UTC-5)</option>
                  <option value="America/Chicago">Chicago (UTC-6)</option>
                  <option value="America/Denver">Denver (UTC-7)</option>
                  <option value="America/Los_Angeles">Los Angeles (UTC-8)</option>
                </optgroup>
                <optgroup label="🌏 Asya">
                  <option value="Asia/Dubai">Dubai (UTC+4)</option>
                  <option value="Asia/Kolkata">Kolkata (UTC+5:30)</option>
                  <option value="Asia/Singapore">Singapore (UTC+8)</option>
                  <option value="Asia/Tokyo">Tokyo (UTC+9)</option>
                  <option value="Asia/Shanghai">Shanghai (UTC+8)</option>
                </optgroup>
                <optgroup label="🌍 Other">
                  <option value="UTC">UTC (Universal Time)</option>
                  <option value="Australia/Sydney">Sydney (UTC+10)</option>
                </optgroup>
              </select>
              <p className="text-xs text-text-light/50 italic">
                💡 The date/time you enter will be interpreted in this timezone
              </p>
            </div>
          </div>
        )}

        {/* Time Display */}
        {mounted && (
          <div className="rounded-lg bg-midnight/40 border border-cyber-blue/30 p-3 space-y-2 text-xs">
            {unlockMode === "custom" && (
              <div className="flex items-center justify-between">
                <span className="text-text-light/60">🕒 Selected Timezone:</span>
                <span className="text-sunset font-mono font-semibold">{unlockTimeDisplay.selected}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-text-light/60">🌍 Your Time:</span>
              <span className="text-slate-200 font-mono">{unlockTimeDisplay.local}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-light/60">🌐 Universal Time (UTC):</span>
              <span className="text-slate-200 font-mono">{unlockTimeDisplay.utc}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-light/60">⏱️ Time Remaining:</span>
              <span className="text-green-400 font-semibold">{unlockTimeDisplay.relative}</span>
            </div>
            <div className="pt-2 border-t border-slate-700">
              <p className="text-text-light/50 italic">
                ℹ️ Blockchain uses UTC time. The message will unlock at this UTC time regardless of the recipient&apos;s location.
              </p>
            </div>
          </div>
        )}
          </div>
        </div>
        )}
      </div>
      
      {/* 💰 Payment Condition (Optional) */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="paymentEnabled"
            checked={paymentEnabled}
            onChange={(e) => setPaymentEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-cyber-blue/40 bg-midnight/60 text-purple-500 focus:ring-2 focus:ring-purple-500/60"
          />
          <label htmlFor="paymentEnabled" className="text-sm font-semibold uppercase tracking-wide text-purple-400">
            💰 Require Payment to Unlock (Optional)
          </label>
        </div>
        
        {paymentEnabled && (
          <div className="rounded-lg border-2 border-purple-500/40 bg-purple-900/10 p-4 space-y-3 animate-in slide-in-from-top duration-200">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label htmlFor="paymentAmount" className="text-xs font-medium text-purple-300">
                  💵 Required Payment Amount
                </label>
                {/* Native/Wei Toggle */}
                <div className="flex gap-1 rounded-lg bg-midnight/60 p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setPaymentInputMode("native");
                      // Convert current Wei/base units to native units
                      if (paymentAmount && paymentAmount !== "0") {
                        try {
                          const nativeValue = formatUnits(BigInt(paymentAmount), nativeDecimals);
                          setPaymentInputValue(nativeValue);
                          return;
                        } catch (convertErr) {
                          console.warn("⚠️ Failed to convert payment amount to native units", convertErr);
                        }
                      }
                      setPaymentInputValue("0");
                    }}
                    className={`px-3 py-1 text-xs font-medium rounded transition ${
                      paymentInputMode === "native"
                        ? "bg-purple-500 text-white"
                        : "text-purple-300 hover:text-purple-200"
                    }`}
                  >
                    {nativeSymbol}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPaymentInputMode("wei");
                      // Show current Wei value
                      setPaymentInputValue(paymentAmount || "0");
                    }}
                    className={`px-3 py-1 text-xs font-medium rounded transition ${
                      paymentInputMode === "wei"
                        ? "bg-purple-500 text-white"
                        : "text-purple-300 hover:text-purple-200"
                    }`}
                  >
                    Wei
                  </button>
                </div>
              </div>
              
              <input
                id="paymentAmount"
                type="text"
                value={paymentInputValue}
                onChange={(e) => {
                  const value = e.target.value;
                  
                  if (paymentInputMode === "native") {
                    // Allow decimal numbers for the native unit
                    if (value === '' || /^\d*\.?\d*$/.test(value)) {
                      setPaymentInputValue(value);
                      
                      // Convert to base units
                      if (value && value !== '.') {
                        try {
                          const weiValue = parseUnits(value, nativeDecimals).toString();
                          setPaymentAmount(weiValue);
                        } catch (convertErr) {
                          console.warn("⚠️ Failed to parse native value", convertErr);
                          setPaymentAmount('0');
                        }
                      } else {
                        setPaymentAmount('0');
                      }
                    }
                  } else {
                    // Wei mode: only integers
                    if (value === '' || /^\d+$/.test(value)) {
                      setPaymentInputValue(value);
                      setPaymentAmount(value || '0');
                    }
                  }
                }}
                placeholder={paymentInputMode === "native" ? "0.001" : weiPlaceholder}
                className="rounded-lg border border-purple-500/40 bg-midnight/60 px-4 py-3 font-mono text-sm text-text-light outline-none transition focus:border-purple-500 focus:ring-2 focus:ring-purple-500/60"
              />
              
              {/* Helper Text */}
              <p className="text-xs text-purple-300/60">
                {paymentInputMode === "native" 
                  ? `💡 Example: 0.001 ${nativeSymbol} (decimals allowed)`
                  : `💡 Example: ${weiPlaceholder} Wei (1 ${nativeSymbol} = 10^${nativeDecimals} Wei)`
                }
              </p>
              
              {/* Preview Box */}
              {paymentAmount && paymentAmount !== '0' && (
                <div className="rounded-lg bg-purple-500/10 border border-purple-500/30 p-3 space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-purple-300/80">{nativeSymbol}:</span>
                    <span className="font-mono text-purple-200">
                      {formatUnits(BigInt(paymentAmount), nativeDecimals)} {nativeSymbol}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-purple-300/80">Wei:</span>
                    <span className="font-mono text-purple-200 text-[10px]">
                      {paymentAmount}
                    </span>
                  </div>
                </div>
              )}
            </div>
            <p className="text-xs text-purple-300/80 italic">
              🔒 Receiver will pay this amount to read the message. Payment automatically transferred to you (sender).
            </p>
          </div>
        )}
        
        {!paymentEnabled && (
          <p className="text-xs text-text-light/60">
            💡 Optional: You can add payment condition for reading the message
          </p>
        )}
      </div>
      
      {/* AES-256-GCM encryption status */}
      {isEncrypting && (
        <div className="rounded-lg bg-neon-green/10 border border-neon-green/40 p-3 text-sm text-neon-green flex items-center gap-2">
          <span className="animate-spin">⟳</span>
          <span>🔐 Encrypting message with AES-256-GCM...</span>
        </div>
      )}
      {encryptedData && !isEncrypting && !isWriteReady && (
        <div className="rounded-lg bg-gradient-to-r from-green-500/10 to-blue-500/10 border border-green-400/40 p-3 text-sm flex items-center gap-2">
          <span className="text-green-300">✅ Message encrypted!</span>
          <span className="text-blue-300 animate-pulse">Preparing transaction...</span>
        </div>
      )}
      {encryptedData && !isEncrypting && isWriteReady && (
        <div className="rounded-lg bg-green-500/10 border border-green-400/40 p-3 text-sm text-green-300">
          ✅ Message encrypted successfully with AES-256-GCM
        </div>
      )}
      
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {/* Encryption System Loading Indicator */}
      {!encryptionReady && (
        <div className="text-sm text-yellow-400 mb-2">
          ⏳ Loading encryption system...
        </div>
      )}
      
      <button
        type="submit"
  disabled={!encryptionReady || isPending || isConfirming || isEncrypting || isSubmitting || (!!encryptedData && !isWriteReady)}
        className="w-full rounded-lg bg-gradient-to-r from-aurora via-sky-500 to-sunset px-4 py-3 text-center text-sm font-semibold uppercase tracking-widest text-slate-900 transition hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {!encryptionReady
          ? "⏳ Preparing..."
          : isSubmitting
          ? "⏳ Processing..."
          : isEncrypting 
          ? "🔐 Encrypting..." 
          : isPending || isConfirming 
            ? "📤 Sending transaction..." 
            : encryptedData && !write
              ? "⏳ Preparing transaction..."
              : "🔐 Send Message"}
      </button>
      {data?.hash ? (
        <p className="text-xs text-text-light/60">
          Transaction hash: {data.hash.slice(0, 10)}...{data.hash.slice(-6)}
        </p>
      ) : null}
    </form>
    </>
  );
}
