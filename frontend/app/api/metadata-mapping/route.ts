import { NextResponse } from "next/server";
import { upsertMapping, getAllMappings } from "@/lib/metadataStore";

interface PostBody {
  shortHash?: string;
  fullHash?: string;
  metadataKeccak?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  publicHash?: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PostBody;
    if (!body?.shortHash || !body?.fullHash) {
      return NextResponse.json({ error: "shortHash and fullHash are required" }, { status: 400 });
    }

    const record = await upsertMapping({
      shortHash: body.shortHash,
      fullHash: body.fullHash,
      publicHash: body.publicHash,
      metadataKeccak: body.metadataKeccak,
      fileName: body.fileName,
      fileSize: body.fileSize,
      mimeType: body.mimeType
    });

    return NextResponse.json({ ok: true, record });
  } catch (err) {
    console.error("metadata-mapping POST failed", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const mappings = await getAllMappings();
    return NextResponse.json({ ok: true, mappings });
  } catch (err) {
    console.error("metadata-mapping GET failed", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
