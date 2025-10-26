export interface EncryptionResult {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  authTag: Uint8Array;
  key: Uint8Array;
}

type EncryptOptions = {
  key?: Uint8Array;
  iv?: Uint8Array;
};

export async function generateAesKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  ) as Promise<CryptoKey>;
}

export async function exportKeyRaw(key: CryptoKey): Promise<Uint8Array> {
  const buffer = await crypto.subtle.exportKey('raw', key);
  return new Uint8Array(buffer);
}

export function generateIv(): Uint8Array {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return bytes;
}

export async function aesGcmEncryptMessage(plaintext: string, options: EncryptOptions = {}): Promise<EncryptionResult> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);

  return aesGcmEncryptBytes(data, options);
}

export async function aesGcmEncryptBytes(plaintext: Uint8Array, options: EncryptOptions = {}): Promise<EncryptionResult> {
  if (!(plaintext instanceof Uint8Array)) {
    throw new TypeError("Plaintext must be a Uint8Array");
  }

  let rawKey: Uint8Array;
  let cryptoKey: CryptoKey;

  if (options.key && options.key.length > 0) {
    rawKey = new Uint8Array(options.key);
    const keyBuffer = rawKey.buffer.slice(rawKey.byteOffset, rawKey.byteOffset + rawKey.byteLength) as ArrayBuffer;
    cryptoKey = await crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  } else {
    cryptoKey = await generateAesKey();
    rawKey = await exportKeyRaw(cryptoKey);
  }

  const iv = options.iv && options.iv.length === 12 ? new Uint8Array(options.iv) : generateIv();
  const ivBuffer = iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer;

  const normalized = plaintext.byteOffset === 0 && plaintext.byteLength === plaintext.buffer.byteLength
    ? plaintext
    : plaintext.slice();

  const dataBuffer = normalized.byteOffset === 0 && normalized.byteLength === normalized.buffer.byteLength
    ? normalized.buffer
    : normalized.buffer.slice(normalized.byteOffset, normalized.byteOffset + normalized.byteLength);

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ivBuffer },
    cryptoKey,
    dataBuffer as ArrayBuffer
  );

  const ciphertextBytes = new Uint8Array(ciphertextBuffer);
  const authTag = ciphertextBytes.slice(ciphertextBytes.length - 16);
  const ciphertext = ciphertextBytes.slice(0, -16);

  return {
    ciphertext,
    iv,
    authTag,
    key: rawKey
  };
}

export async function aesGcmDecryptBytes(
  ciphertext: Uint8Array,
  authTag: Uint8Array,
  iv: Uint8Array,
  keyBytes: Uint8Array
): Promise<Uint8Array> {
  const keyBuffer = keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer;
  const key = await crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, ['decrypt']);
  const combined = new Uint8Array(ciphertext.length + authTag.length);
  combined.set(ciphertext);
  combined.set(authTag, ciphertext.length);
  const ivBuffer = iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer;
  const combinedBuffer = combined.buffer.slice(combined.byteOffset, combined.byteOffset + combined.byteLength) as ArrayBuffer;

  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBuffer }, key, combinedBuffer);
  return new Uint8Array(decrypted);
}

export async function aesGcmDecryptMessage(
  ciphertext: Uint8Array,
  authTag: Uint8Array,
  iv: Uint8Array,
  keyBytes: Uint8Array
): Promise<string> {
  const keyBuffer = keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer;
  const key = await crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, ['decrypt']);
  const combined = new Uint8Array(ciphertext.length + authTag.length);
  combined.set(ciphertext);
  combined.set(authTag, ciphertext.length);
  const ivBuffer = iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer;
  const combinedBuffer = combined.buffer.slice(combined.byteOffset, combined.byteOffset + combined.byteLength) as ArrayBuffer;

  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBuffer }, key, combinedBuffer);
  return new TextDecoder().decode(decrypted);
}

export function bytesToHex(bytes: Uint8Array): string {
  return '0x' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex: string | null | undefined): Uint8Array {
  if (!hex) return new Uint8Array();
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
