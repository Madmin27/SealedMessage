// FHEVM SDK Helper — Zama FHE (Sepolia Zama FHEVM)
// Uses dynamic import (browser-only module, doesn't work in SSR).
export interface FHEEncryptedInput {
  value: `0x${string}`;
  proof: `0x${string}`;
}

const ZAMA_RELAYER_URL =
  process.env.NEXT_PUBLIC_ZAMA_RELAYER_URL || 'https://relayer.testnet.zama.cloud';

// Lazy-loaded createInstance factory
let _fhevmCreateInstance: any = null;

async function getCreateInstance(): Promise<any> {
  if (typeof window === 'undefined') {
    throw new Error('FHEVM is browser-only');
  }
  if (_fhevmCreateInstance) return _fhevmCreateInstance;
  const { createInstance } = await import('@zama-fhe/relayer-sdk/web');
  _fhevmCreateInstance = createInstance;
  return _fhevmCreateInstance;
}

/**
 * FHE encrypt a value (as euint64).
 * @param value Value to encrypt (number | bigint)
 * @returns encrypted input (value + proof)
 */
export async function encryptEuint64(value: bigint | number): Promise<FHEEncryptedInput> {
  const createInstance = await getCreateInstance();
  const instance = await createInstance({
    rpcUrl: ZAMA_RELAYER_URL,
    chainId: 11155111, // Sepolia
  });
  const result = await instance.encrypt64(BigInt(value));
  return {
    value: `0x${result.hex}` as `0x${string}`,
    proof: `0x${result.proof}` as `0x${string}`,
  };
}

/**
 * FHE encrypt a value (as euint256).
 * @param value Bytes32 value to encrypt (hex)
 * @returns encrypted input (value + proof)
 */
export async function encryptEuint256(value: `0x${string}`): Promise<FHEEncryptedInput> {
  const createInstance = await getCreateInstance();
  const instance = await createInstance({
    rpcUrl: ZAMA_RELAYER_URL,
    chainId: 11155111, // Sepolia
  });
  const result = await instance.encrypt256(value);
  return {
    value: `0x${result.hex}` as `0x${string}`,
    proof: `0x${result.proof}` as `0x${string}`,
  };
}

/**
 * Decrypt an FHE-encrypted value (via relayer).
 * @param encryptedHandle Handle returned from smart contract (bytes32)
 * @returns Decrypted value (bigint)
 */
export async function decryptToBigInt(encryptedHandle: `0x${string}`): Promise<bigint> {
  const createInstance = await getCreateInstance();
  const instance = await createInstance({
    rpcUrl: ZAMA_RELAYER_URL,
    chainId: 11155111, // Sepolia
  });
  const result = await instance.decrypt(encryptedHandle);
  return result;
}

/**
 * Decrypt an FHE-encrypted 256-bit value.
 */
export async function decryptToBytes32(encryptedHandle: `0x${string}`): Promise<`0x${string}`> {
  const createInstance = await getCreateInstance();
  const instance = await createInstance({
    rpcUrl: ZAMA_RELAYER_URL,
    chainId: 11155111, // Sepolia
  });
  const result = await instance.decrypt256(encryptedHandle);
  return result as `0x${string}`;
}

/**
 * Get FHE public key (via relayer).
 */
export async function getFHEPublicKey(): Promise<string> {
  const createInstance = await getCreateInstance();
  const instance = await createInstance({
    rpcUrl: ZAMA_RELAYER_URL,
    chainId: 11155111, // Sepolia
  });
  return instance.getPublicKey();
}
