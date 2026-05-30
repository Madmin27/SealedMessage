import { aesGcmDecryptBytes, aesGcmEncryptBytes, bytesToHex, hexToBytes } from "./encryption";
import { ethers } from "ethers";

export type EncryptedEnvelope = {
  version: 1;
  algorithm: "aes-256-gcm";
  ciphertext: string;
  iv: string;
  authTag: string;
};

export function generateMessageKey(): Uint8Array {
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  return key;
}

export function splitMessageKey(messageKey: Uint8Array): [bigint, bigint, bigint, bigint] {
  if (messageKey.length !== 32) {
    throw new Error("Message key must be 32 bytes");
  }

  const parts: bigint[] = [];
  for (let offset = 0; offset < 32; offset += 8) {
    const view = messageKey.slice(offset, offset + 8);
    parts.push(BigInt(`0x${bytesToHex(view).slice(2)}`));
  }

  return parts as [bigint, bigint, bigint, bigint];
}

export function combineMessageKey(parts: [bigint, bigint, bigint, bigint]): Uint8Array {
  const key = new Uint8Array(32);

  parts.forEach((part, index) => {
    const hex = part.toString(16).padStart(16, "0");
    key.set(hexToBytes(`0x${hex}`), index * 8);
  });

  return key;
}

export async function encryptJsonEnvelope(payload: unknown, key: Uint8Array): Promise<EncryptedEnvelope> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = await aesGcmEncryptBytes(bytes, { key });

  return {
    version: 1,
    algorithm: "aes-256-gcm",
    ciphertext: bytesToHex(encrypted.ciphertext),
    iv: bytesToHex(encrypted.iv),
    authTag: bytesToHex(encrypted.authTag),
  };
}

export async function decryptJsonEnvelope<T>(envelope: EncryptedEnvelope, key: Uint8Array): Promise<T> {
  const plaintext = await aesGcmDecryptBytes(
    hexToBytes(envelope.ciphertext),
    hexToBytes(envelope.authTag),
    hexToBytes(envelope.iv),
    key
  );

  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

export async function encryptBytesEnvelope(bytes: Uint8Array, key: Uint8Array): Promise<EncryptedEnvelope> {
  const encrypted = await aesGcmEncryptBytes(bytes, { key });
  return {
    version: 1,
    algorithm: "aes-256-gcm",
    ciphertext: bytesToHex(encrypted.ciphertext),
    iv: bytesToHex(encrypted.iv),
    authTag: bytesToHex(encrypted.authTag),
  };
}

export async function decryptBytesEnvelope(envelope: EncryptedEnvelope, key: Uint8Array): Promise<Uint8Array> {
  return aesGcmDecryptBytes(
    hexToBytes(envelope.ciphertext),
    hexToBytes(envelope.authTag),
    hexToBytes(envelope.iv),
    key
  );
}

export async function computeKeccakFromString(value: string): Promise<`0x${string}`> {
  return ethers.keccak256(ethers.toUtf8Bytes(value)) as `0x${string}`;
}
