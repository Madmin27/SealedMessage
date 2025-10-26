import { NextRequest } from "next/server";

const DEFAULT_GATEWAYS = [
  process.env.PINATA_PUBLIC_GATEWAY?.replace(/\/$/, "") || "https://gateway.pinata.cloud/ipfs",
  "https://ipfs.io/ipfs",
  "https://dweb.link/ipfs"
];

const isValidCid = (hash: string) => /^[A-Za-z0-9]+$/.test(hash);

export async function GET(_req: NextRequest, { params }: { params: { hash?: string } }) {
  const hash = params.hash;

  if (!hash || !isValidCid(hash)) {
    return new Response("Invalid IPFS hash", { status: 400 });
  }

  const gateways = DEFAULT_GATEWAYS;
  const tried: string[] = [];

  for (const base of gateways) {
    const url = `${base}/${hash}`;
    tried.push(url);
    try {
      const upstream = await fetch(url, {
        headers: {
          Accept: "*/*"
        },
        redirect: "follow"
      });

      if (!upstream.ok) {
        console.warn(`IPFS proxy: ${url} responded with ${upstream.status}`);
        continue;
      }

      const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
      const buffer = await upstream.arrayBuffer();

      return new Response(buffer, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=60, s-maxage=300",
          "x-ipfs-gateway": url
        }
      });
    } catch (err) {
      console.error(`IPFS proxy: request to ${url} failed`, err);
      continue;
    }
  }

  return new Response(`Unable to resolve IPFS hash. Tried: ${tried.join(", ")}`, {
    status: 502,
    headers: {
      "Access-Control-Allow-Origin": "*"
    }
  });
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}
