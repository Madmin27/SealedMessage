export type IpfsPinResult = {
  IpfsHash: string;
  PinSize?: number;
  Timestamp?: string;
};

export async function pinFileToIpfs(params: {
  file: File;
  metadata?: Record<string, unknown>;
}): Promise<IpfsPinResult> {
  const formData = new FormData();
  formData.append("file", params.file);

  if (params.metadata && Object.keys(params.metadata).length > 0) {
    formData.append("pinataMetadata", JSON.stringify(params.metadata));
  }

  const response = await fetch("/api/ipfs/pin", {
    method: "POST",
    body: formData,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data?.error === "string" ? data.error : "IPFS upload failed");
  }

  return data as IpfsPinResult;
}

export async function searchPinnedFiles(params: {
  shortHash?: string;
  type?: string;
  hashContains?: string;
  pageLimit?: number;
}): Promise<Array<{ ipfs_pin_hash: string; metadata?: { keyvalues?: Record<string, string> } }>> {
  const query = new URLSearchParams();
  if (params.shortHash) query.set("shortHash", params.shortHash);
  if (params.type) query.set("type", params.type);
  if (params.hashContains) query.set("hashContains", params.hashContains);
  if (params.pageLimit) query.set("pageLimit", String(params.pageLimit));

  const response = await fetch(`/api/ipfs/pins?${query.toString()}`, {
    cache: "no-store",
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data?.error === "string" ? data.error : "Pin search failed");
  }

  return Array.isArray(data?.rows) ? data.rows : [];
}
