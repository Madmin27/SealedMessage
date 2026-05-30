import { ethers } from "ethers";

const SDK_DEFAULT_RELAYER_URL = "https://relayer.testnet.zama.org/v2";

function normalizeRelayerUrl(rawUrl?: string): string {
  const candidate = (rawUrl || SDK_DEFAULT_RELAYER_URL).trim();
  const normalizedBase = candidate
    .replace("relayer.testnet.zama.cloud", "relayer.testnet.zama.org")
    .replace(/\/+$/, "");

  if (/\/v[12]$/i.test(normalizedBase)) {
    return normalizedBase;
  }

  return `${normalizedBase}/v2`;
}

const SECURE_RELAYER_URL = normalizeRelayerUrl(process.env.NEXT_PUBLIC_ZAMA_RELAYER_URL);

type FheInstance = {
  createEncryptedInput: (contractAddress: string, userAddress: string) => {
    add64: (value: bigint | number) => any;
    encrypt: () => Promise<{ handles: Uint8Array[]; inputProof: Uint8Array }>;
  };
  generateKeypair: () => { publicKey: string; privateKey: string };
  createEIP712: (publicKey: string, contractAddresses: string[], startTimestamp: number, durationDays: number) => {
    domain: Record<string, unknown>;
    types: Record<string, Array<{ name: string; type: string }>>;
    message: Record<string, unknown>;
  };
  userDecrypt: (
    handles: Array<{ handle: string; contractAddress: string }>,
    privateKey: string,
    publicKey: string,
    signature: string,
    contractAddresses: string[],
    userAddress: string,
    startTimestamp: number,
    durationDays: number
  ) => Promise<Record<string, bigint | number | string>>;
};

let fheInstancePromise: Promise<FheInstance> | null = null;

async function getFheInstance(): Promise<FheInstance> {
  if (typeof window === "undefined") {
    throw new Error("FHE secure helpers are browser-only");
  }

  if (!fheInstancePromise) {
    fheInstancePromise = import("@zama-fhe/relayer-sdk/web").then(async ({ createInstance, SepoliaConfigV2, initSDK }) => {
      // WASM modülünü (tfhe_bg.wasm) yükle — __wbindgen_malloc vb. fonksiyonlar
      // bu sayede kullanılabilir olur. initSDK() olmadan createInstance() çağrılırsa
      // "Impossible to fetch public key: wrong relayer url" hatası alınır çünkü
      // TFHE public key deserialization WASM'de çalışır.
      await initSDK();

      return createInstance({
        ...SepoliaConfigV2,
        chainId: 11155111,
        relayerUrl: SECURE_RELAYER_URL,
        network: (window as any).ethereum,
      }) as Promise<FheInstance>;
    });
  }

  return fheInstancePromise;
}

export async function encryptKeyPartsForContract(params: {
  contractAddress: string;
  userAddress: string;
  keyParts: [bigint, bigint, bigint, bigint];
}): Promise<{ handles: [`0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`]; inputProof: `0x${string}` }> {
  const instance = await getFheInstance();
  const input = instance.createEncryptedInput(params.contractAddress, params.userAddress);
  params.keyParts.forEach((part) => input.add64(part));
  const encrypted = await input.encrypt();

  if (encrypted.handles.length !== 4) {
    throw new Error("Expected 4 encrypted key handles");
  }

  return {
    handles: encrypted.handles.map((handle) => ethers.hexlify(handle) as `0x${string}`) as [`0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`],
    inputProof: ethers.hexlify(encrypted.inputProof) as `0x${string}`,
  };
}

export async function decryptKeyPartsForUser(params: {
  contractAddress: string;
  signer: ethers.Signer;
  userAddress: string;
  handles: [`0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`];
}): Promise<[bigint, bigint, bigint, bigint]> {
  const instance = await getFheInstance();
  const keypair = instance.generateKeypair();
  const startTimestamp = Math.floor(Date.now() / 1000);
  const durationDays = 7;
  const eip712 = instance.createEIP712(keypair.publicKey, [params.contractAddress], startTimestamp, durationDays);
  const { EIP712Domain: _ignored, ...types } = eip712.types;
  const signature = await params.signer.signTypedData(eip712.domain, types, eip712.message);

  const decrypted = await instance.userDecrypt(
    params.handles.map((handle) => ({ handle, contractAddress: params.contractAddress })),
    keypair.privateKey,
    keypair.publicKey,
    signature,
    [params.contractAddress],
    params.userAddress,
    startTimestamp,
    durationDays
  );

  return params.handles.map((handle) => BigInt(decrypted[handle])) as [bigint, bigint, bigint, bigint];
}
