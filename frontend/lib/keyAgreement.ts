import * as secp256k1 from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes, bytesToHex } from './encryption';
import { ethers } from 'ethers';

const STORAGE_PREFIX = 'sealed-message:encryption-signature:';
const PUBLIC_CACHE_PREFIX = 'sealed-message:encryption-pub:';
const KEY_MESSAGE_PREFIX = 'SealedMessage|EncryptionKey|v1';
const CURVE_ORDER = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');

export interface DerivedKeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  signature: string;
  message: string;
}

export interface FallbackKeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  isFallback: true;
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function normalizeAddress(address: string): string {
  return address?.toLowerCase() ?? '';
}

export function buildKeyAgreementMessage(address: string): string {
  return `${KEY_MESSAGE_PREFIX}\nAddress:${normalizeAddress(address)}`;
}

function deriveKeyPairFromSignature(signature: string) {
  const normalized = signature.startsWith('0x') ? signature : `0x${signature}`;
  const signatureBytes = hexToBytes(normalized);
  const hashed = sha256(signatureBytes);
  const hashHex = bytesToHex(hashed).slice(2);
  let keyBigInt = BigInt(`0x${hashHex}`) % CURVE_ORDER;
  if (keyBigInt === 0n) {
    keyBigInt = 1n;
  }
  const privateKeyHex = keyBigInt.toString(16).padStart(64, '0');
  const privateKey = hexToBytes(`0x${privateKeyHex}`);
  const publicKey = secp256k1.getPublicKey(privateKey, true);
  return { privateKey, publicKey };
}

export function getStoredEncryptionKey(address: string): DerivedKeyPair | null {
  const storage = getStorage();
  if (!storage) return null;
  const key = `${STORAGE_PREFIX}${normalizeAddress(address)}`;
  const cachedSignature = storage.getItem(key);
  if (!cachedSignature) return null;
  const message = buildKeyAgreementMessage(address);
  const { privateKey, publicKey } = deriveKeyPairFromSignature(cachedSignature);
  return {
    privateKey,
    publicKey,
    signature: cachedSignature,
    message
  };
}

export async function getOrCreateEncryptionKey(walletClient: any, account: string): Promise<DerivedKeyPair> {
  const normalized = normalizeAddress(account);
  const cached = getStoredEncryptionKey(normalized);
  if (cached) {
    return cached;
  }
  if (!walletClient) {
    throw new Error('Wallet client unavailable for encryption key derivation');
  }
  const message = buildKeyAgreementMessage(normalized);
  const signature = await walletClient.signMessage({ account, message });
  const { privateKey, publicKey } = deriveKeyPairFromSignature(signature);
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(`${STORAGE_PREFIX}${normalized}`, signature);
      storage.setItem(`${PUBLIC_CACHE_PREFIX}${normalized}`, bytesToHex(publicKey));
    } catch (err) {
      console.warn('Failed to persist encryption key signature:', err);
    }
  }
  return {
    privateKey,
    publicKey,
    signature,
    message
  };
}

export function getCachedPublicKey(address: string): string | null {
  const storage = getStorage();
  if (!storage) return null;
  const cached = storage.getItem(`${PUBLIC_CACHE_PREFIX}${normalizeAddress(address)}`);
  return cached ?? null;
}

export function clearStoredEncryptionKey(address: string) {
  const storage = getStorage();
  if (!storage) return;
  const normalized = normalizeAddress(address);
  storage.removeItem(`${STORAGE_PREFIX}${normalized}`);
  storage.removeItem(`${PUBLIC_CACHE_PREFIX}${normalized}`);
}

export function generateFallbackKeyPair(receiverAddress: string): FallbackKeyPair {
  const seed = process.env.NEXT_PUBLIC_FALLBACK_SEED || 'default-fallback-seed';
  const normalized = normalizeAddress(receiverAddress);
  const combined = `${seed}|${normalized}|fallback-v1`;
  const hash = ethers.keccak256(ethers.toUtf8Bytes(combined));
  const hashBytes = hexToBytes(hash);
  const hashed = sha256(hashBytes);
  const hashHex = bytesToHex(hashed).slice(2);
  let keyBigInt = BigInt(`0x${hashHex}`) % CURVE_ORDER;
  if (keyBigInt === 0n) {
    keyBigInt = 1n;
  }
  const privateKeyHex = keyBigInt.toString(16).padStart(64, '0');
  const privateKey = hexToBytes(`0x${privateKeyHex}`);
  const publicKey = secp256k1.getPublicKey(privateKey, true);
  return {
    privateKey,
    publicKey,
    isFallback: true
  };
}
