import { promises as fs } from "fs";
import path from "path";

export interface ReceiverEnvelopeRecord {
  commitment: string;
  receiverEnvelopeHash: string;
  ciphertextHash: string;
  metadataShortHash?: string;
  metadataKeccak?: string;
  senderPublicKey: string;
  envelope: {
    ciphertext: string;
    iv: string;
    authTag: string;
  };
  createdAt: string;
  updatedAt: string;
  release?: {
    releasedAt: string;
    reason?: string;
    txHash?: string;
    releasedBy?: string;
  };
}

const dataDir = path.join(process.cwd(), ".data");
const dataFile = path.join(dataDir, "escrow-envelopes.json");

type StoreShape = Record<string, ReceiverEnvelopeRecord>;

async function readStore(): Promise<StoreShape> {
  try {
    const raw = await fs.readFile(dataFile, "utf-8");
    if (!raw) {
      return {};
    }
    try {
      const parsed = JSON.parse(raw) as StoreShape;
      return parsed ?? {};
    } catch (err) {
      console.warn("escrowStore: corrupted JSON detected, resetting store", err);
      await writeStore({});
      return {};
    }
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return {};
    }
    throw err;
  }
}

async function writeStore(store: StoreShape): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify(store, null, 2), "utf-8");
}

interface SaveEnvelopeInput {
  commitment: string;
  receiverEnvelopeHash: string;
  ciphertextHash: string;
  metadataShortHash?: string;
  metadataKeccak?: string;
  senderPublicKey: string;
  envelope: {
    ciphertext: string;
    iv: string;
    authTag: string;
  };
}

export async function saveReceiverEnvelope(input: SaveEnvelopeInput): Promise<ReceiverEnvelopeRecord> {
  const commitment = input.commitment.trim().toLowerCase();
  if (!commitment || commitment === "0x" || commitment === "0x0") {
    throw new Error("commitment is required");
  }

  const receiverEnvelopeHash = input.receiverEnvelopeHash.trim().toLowerCase();
  if (!receiverEnvelopeHash || receiverEnvelopeHash === "0x" || receiverEnvelopeHash === "0x0") {
    throw new Error("receiverEnvelopeHash is required");
  }

  const ciphertextHash = input.ciphertextHash.trim().toLowerCase();
  if (!ciphertextHash || ciphertextHash === "0x" || ciphertextHash === "0x0") {
    throw new Error("ciphertextHash is required");
  }

  const nowIso = new Date().toISOString();

  const record: ReceiverEnvelopeRecord = {
    commitment,
    receiverEnvelopeHash,
    ciphertextHash,
    metadataShortHash: input.metadataShortHash?.trim() || undefined,
    metadataKeccak: input.metadataKeccak?.trim() || undefined,
    senderPublicKey: input.senderPublicKey.trim(),
    envelope: {
      ciphertext: input.envelope.ciphertext.trim(),
      iv: input.envelope.iv.trim(),
      authTag: input.envelope.authTag.trim()
    },
    createdAt: nowIso,
    updatedAt: nowIso
  };

  const store = await readStore();
  store[commitment] = {
    ...record,
    // Preserve createdAt if record already exists (idempotent save)
    createdAt: store[commitment]?.createdAt ?? record.createdAt
  };
  await writeStore(store);
  return store[commitment];
}

export async function getReceiverEnvelope(commitment: string): Promise<ReceiverEnvelopeRecord | undefined> {
  const trimmed = commitment.trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }
  const store = await readStore();
  return store[trimmed];
}

export async function findReceiverEnvelopeByHash(receiverEnvelopeHash: string): Promise<ReceiverEnvelopeRecord | undefined> {
  const trimmed = receiverEnvelopeHash.trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }

  const store = await readStore();
  for (const record of Object.values(store)) {
    if (record.receiverEnvelopeHash.toLowerCase() === trimmed) {
      return record;
    }
  }

  return undefined;
}

interface MarkReleasedInput {
  commitment: string;
  reason?: string;
  releasedBy?: string;
  txHash?: string;
}

export async function markEnvelopeReleased(input: MarkReleasedInput): Promise<ReceiverEnvelopeRecord> {
  const commitment = input.commitment.trim().toLowerCase();
  if (!commitment) {
    throw new Error("commitment is required");
  }

  const store = await readStore();
  const existing = store[commitment];
  if (!existing) {
    throw new Error("Envelope not found");
  }

  existing.release = {
    releasedAt: new Date().toISOString(),
    reason: input.reason,
    releasedBy: input.releasedBy,
    txHash: input.txHash
  };
  existing.updatedAt = new Date().toISOString();

  await writeStore(store);
  return existing;
}

export async function listReceiverEnvelopes(): Promise<ReceiverEnvelopeRecord[]> {
  const store = await readStore();
  return Object.values(store);
}
