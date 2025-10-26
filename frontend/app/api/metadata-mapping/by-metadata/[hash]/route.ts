import { NextResponse } from "next/server";
import { getMappingByMetadataKeccak } from "@/lib/metadataStore";

export async function GET(
  _request: Request,
  { params }: { params: { hash: string } }
) {
  try {
    const metadataKeccak = params.hash;
    if (!metadataKeccak) {
      return NextResponse.json({ error: "metadata hash required" }, { status: 400 });
    }

    const record = await getMappingByMetadataKeccak(metadataKeccak);
    if (!record) {
      return NextResponse.json({ ok: false, record: null }, { status: 404 });
    }

    return NextResponse.json({ ok: true, record });
  } catch (err) {
    console.error("metadata-mapping by-metadata GET failed", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
