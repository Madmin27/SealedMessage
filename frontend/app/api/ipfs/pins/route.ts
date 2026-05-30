import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function getPinataAuthHeaders(): Record<string, string> {
  const jwt = process.env.PINATA_JWT?.trim();
  if (jwt) {
    return { Authorization: `Bearer ${jwt}` };
  }

  const apiKey = process.env.PINATA_API_KEY?.trim();
  const secretKey = process.env.PINATA_SECRET_KEY?.trim();
  if (!apiKey || !secretKey) {
    throw new Error("PINATA_API_KEY/PINATA_SECRET_KEY or PINATA_JWT must be configured on the server");
  }

  return {
    pinata_api_key: apiKey,
    pinata_secret_api_key: secretKey,
    Accept: "application/json",
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const params = new URLSearchParams({ status: "pinned" });
    params.set("pageLimit", searchParams.get("pageLimit") || "5");

    const shortHash = searchParams.get("shortHash");
    const type = searchParams.get("type");
    const hashContains = searchParams.get("hashContains");

    if (hashContains) {
      params.set("hashContains", hashContains);
    }

    if (shortHash || type) {
      const keyvalues: Record<string, { value: string; op: "eq" }> = {};
      if (shortHash) keyvalues.shortHash = { value: shortHash, op: "eq" };
      if (type) keyvalues.type = { value: type, op: "eq" };
      params.append("metadata[keyvalues]", JSON.stringify(keyvalues));
    }

    const response = await fetch(`https://api.pinata.cloud/data/pinList?${params.toString()}`, {
      headers: getPinataAuthHeaders(),
      cache: "no-store",
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json({ error: data?.error ?? response.statusText }, { status: response.status });
    }

    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error("/api/ipfs/pins failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Pin list failed" }, { status: 500 });
  }
}
