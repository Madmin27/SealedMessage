import { promises as fs } from "fs";
import path from "path";

interface MappingRecord {
  shortHash: string;
  fullHash: string;
  publicHash?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  metadataKeccak?: string;
  updatedAt: string;
}

const dataDir = path.join(process.cwd(), ".data");
const dataFile = path.join(dataDir, "metadata-mapping.json");

async function readStore(): Promise<Record<string, MappingRecord>> {
  try {
    const raw = await fs.readFile(dataFile, "utf-8");
    if (!raw) {
      return {};
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, MappingRecord>;
      return parsed ?? {};
    } catch (err) {
      console.warn("metadataStore: corrupted JSON detected, resetting store", err);
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

async function writeStore(store: Record<string, MappingRecord>): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify(store, null, 2), "utf-8");
}

export async function upsertMapping(record: {
  shortHash: string;
  fullHash: string;
  publicHash?: string | null;
  metadataKeccak?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
}): Promise<MappingRecord> {
  const trimmedHash = record.shortHash.trim();
  const trimmedFull = record.fullHash.trim();
  if (!trimmedHash || !trimmedFull) {
    throw new Error("shortHash and fullHash are required");
  }

  const trimmedMetadataKeccak = record.metadataKeccak?.trim();
  const trimmedPublic = record.publicHash?.trim();

  const store = await readStore();
  const existing = store[trimmedHash];

  const payload: MappingRecord = {
    shortHash: trimmedHash,
    fullHash: trimmedFull || existing?.fullHash || trimmedFull,
    publicHash: trimmedPublic ?? existing?.publicHash,
    metadataKeccak: trimmedMetadataKeccak ?? existing?.metadataKeccak,
    fileName: record.fileName ?? existing?.fileName,
    fileSize: record.fileSize ?? existing?.fileSize,
    mimeType: record.mimeType ?? existing?.mimeType,
    updatedAt: new Date().toISOString()
  };

  store[trimmedHash] = payload;
  await writeStore(store);
  return payload;
}

export async function getMapping(shortHash: string): Promise<MappingRecord | undefined> {
  const trimmedHash = shortHash.trim();
  if (!trimmedHash) {
    return undefined;
  }
  const store = await readStore();
  return store[trimmedHash];
}

export async function getMappingByMetadataKeccak(metadataKeccak: string): Promise<MappingRecord | undefined> {
  const trimmed = metadataKeccak.trim().toLowerCase();
  if (!trimmed || trimmed === "0x") {
    return undefined;
  }

  const store = await readStore();
  const records = Object.values(store);
  return records.find((record) => record.metadataKeccak?.toLowerCase() === trimmed);
}

export async function getAllMappings(): Promise<MappingRecord[]> {
  const store = await readStore();
  return Object.values(store);
}
