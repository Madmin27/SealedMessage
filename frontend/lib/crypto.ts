import * as secp256k1 from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha2.js';

/**
 * Derive ECDH shared secret from sender's public key and receiver's private key
 */
export async function deriveSharedSecret(
  senderPublicKey: Uint8Array,
  receiverPrivateKey: Uint8Array
): Promise<Uint8Array> {
  // ECDH: shared_secret = receiver_private_key * sender_public_key
  const sharedPoint = secp256k1.getSharedSecret(receiverPrivateKey, senderPublicKey, true);
  
  // Use x-coordinate of shared point as symmetric key material
  // Hash it to get 256-bit AES key
  const sharedSecret = sha256(sharedPoint);
  
  return sharedSecret;
}

/**
 * Decrypt data using AES-256-GCM with Web Crypto API
 */
export async function aesGcmDecrypt(
  encryptedData: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
  authTag: Uint8Array
): Promise<string> {
  // Import key for AES-GCM
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key.buffer as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  // Concatenate encrypted data + auth tag (Web Crypto expects them together)
  const ciphertext = new Uint8Array(encryptedData.length + authTag.length);
  ciphertext.set(encryptedData);
  ciphertext.set(authTag, encryptedData.length);

  // Decrypt
  const decryptedBuffer = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv.buffer as ArrayBuffer,
      tagLength: authTag.length * 8 // in bits
    },
    cryptoKey,
    ciphertext.buffer as ArrayBuffer
  );

  // Convert to string
  const decoder = new TextDecoder();
  return decoder.decode(decryptedBuffer);
}

/**
 * Get private key from wallet (for ECDH)
 * Note: This requires user permission to export private key
 */
export async function getWalletPrivateKey(walletClient: any, address: string): Promise<Uint8Array> {
  // WARNING: This is a simplified approach
  // In production, use proper wallet integration that doesn't expose private keys
  
  // For MetaMask, we can't directly access the private key
  // Instead, we should use eth_signTypedData_v4 to sign a message
  // and derive a deterministic key from the signature
  
  throw new Error('Direct private key access not supported. Use signature-based key derivation.');
}

/**
 * Derive encryption key from wallet signature (safer than exposing private key)
 */
export async function deriveKeyFromSignature(
  walletClient: any,
  address: string,
  messageId: string
): Promise<Uint8Array> {
  // Sign a deterministic message
  const message = `Decrypt message ${messageId}`;
  
  const signature = await walletClient.signMessage({
    account: address,
    message
  });

  // Hash signature to get 256-bit key material
  const sigBytes = hexToBytes(signature);
  const keyMaterial = sha256(sigBytes);
  
  return keyMaterial;
}

// Helper functions
export function hexToBytes(hex: string): Uint8Array {
  if (!hex) return new Uint8Array(0);
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substr(i, 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
