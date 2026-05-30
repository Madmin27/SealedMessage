// FHEVM SDK Helper — Zama FHE devnet için
// Dinamik import kullanır (browser-only modül, SSR'da çalışmaz).
export interface FHEEncryptedInput {
  value: `0x${string}`;
  proof: `0x${string}`;
}

// Lazy-loaded FHEVM instance (yalnızca browser'da)
let _fhevmInstance: any = null;

async function getFHEVM(): Promise<any> {
  if (typeof window === 'undefined') {
    throw new Error('FHEVM is browser-only');
  }
  if (_fhevmInstance) return _fhevmInstance;
  const { createInstance } = await import('@zama-fhe/relayer-sdk/web');
  _fhevmInstance = createInstance;
  return _fhevmInstance;
}

/**
 * Bir değeri FHE şifrele (euint64 olarak).
 * @param value Şifrelenecek değer (number)
 * @returns encrypted input (value + proof)
 */
export async function encryptEuint64(value: bigint | number): Promise<FHEEncryptedInput> {
  const createInstance = await getFHEVM();
  const instance = await createInstance({
    rpcUrl: 'https://devnet.zama.ai',
    chainId: 8009,
  });
  const result = await instance.encrypt64(BigInt(value));
  return {
    value: `0x${result.hex}` as `0x${string}`,
    proof: `0x${result.proof}` as `0x${string}`,
  };
}

/**
 * Bir değeri FHE şifrele (euint256 olarak).
 * @param value Şifrelenecek bytes32 değeri (hex)
 * @returns encrypted input (value + proof)
 */
export async function encryptEuint256(value: `0x${string}`): Promise<FHEEncryptedInput> {
  const createInstance = await getFHEVM();
  const instance = await createInstance({
    rpcUrl: 'https://devnet.zama.ai',
    chainId: 8009,
  });
  const result = await instance.encrypt256(value);
  return {
    value: `0x${result.hex}` as `0x${string}`,
    proof: `0x${result.proof}` as `0x${string}`,
  };
}

/**
 * FHE şifreli bir değeri deşifre et (relayer üzerinden).
 * @param encryptedHandle Akıllı kontrattan dönen handle (bytes32)
 * @returns Deşifre edilmiş değer (bigint)
 */
export async function decryptToBigInt(encryptedHandle: `0x${string}`): Promise<bigint> {
  const instance = await initFHEVM();
  const result = await instance.decrypt(encryptedHandle);
  return result;
}

/**
 * FHE şifreli bir 256-bit değeri deşifre et.
 */
export async function decryptToBytes32(encryptedHandle: `0x${string}`): Promise<`0x${string}`> {
  const instance = await initFHEVM();
  const result = await instance.decrypt256(encryptedHandle);
  return result as `0x${string}`;
}

/**
 * FHE devnet public key'ini al.
 */
export async function getFHEPublicKey(): Promise<string> {
  const instance = await initFHEVM();
  return instance.getPublicKey();
}
