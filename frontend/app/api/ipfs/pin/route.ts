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
  };
}

export async function POST(request: NextRequest) {
  try {
    const incoming = await request.formData();
    const file = incoming.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    const formData = new FormData();
    formData.append("file", file);

    const pinataMetadata = incoming.get("pinataMetadata");
    if (typeof pinataMetadata === "string" && pinataMetadata.trim().length > 0) {
      formData.append("pinataMetadata", pinataMetadata);
    }

    const pinataOptions = incoming.get("pinataOptions");
    if (typeof pinataOptions === "string" && pinataOptions.trim().length > 0) {
      formData.append("pinataOptions", pinataOptions);
    }

    const response = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: getPinataAuthHeaders(),
      body: formData,
      cache: "no-store",
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json({ error: data?.error ?? response.statusText }, { status: response.status });
    }

    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error("/api/ipfs/pin failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "IPFS pin failed" }, { status: 500 });
  }
}
