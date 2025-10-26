import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { saveReceiverEnvelope, getReceiverEnvelope, findReceiverEnvelopeByHash } from "@/lib/escrowStore";

interface EnvelopeBody {
  commitment?: string;
  receiverEnvelopeHash?: string;
  ciphertextHash?: string;
  metadataShortHash?: string;
  metadataKeccak?: string;
  senderPublicKey?: string;
  envelope?: {
    ciphertext?: string;
    iv?: string;
    authTag?: string;
  };
}

const HEX_REGEX = /^0x[0-9a-fA-F]+$/;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as EnvelopeBody;
    const commitment = body.commitment?.trim();
    const receiverEnvelopeHash = body.receiverEnvelopeHash?.trim();
    const ciphertextHash = body.ciphertextHash?.trim();
    const senderPublicKey = body.senderPublicKey?.trim();

    if (!commitment || !HEX_REGEX.test(commitment)) {
      return NextResponse.json({ error: "commitment must be 0x-prefixed" }, { status: 400 });
    }
    if (!receiverEnvelopeHash || !HEX_REGEX.test(receiverEnvelopeHash)) {
      return NextResponse.json({ error: "receiverEnvelopeHash must be 0x-prefixed" }, { status: 400 });
    }
    if (!ciphertextHash || !HEX_REGEX.test(ciphertextHash)) {
      return NextResponse.json({ error: "ciphertextHash must be 0x-prefixed" }, { status: 400 });
    }
    if (!senderPublicKey || !HEX_REGEX.test(senderPublicKey)) {
      return NextResponse.json({ error: "senderPublicKey must be 0x-prefixed" }, { status: 400 });
    }

    const envelope = body.envelope;
    if (!envelope?.ciphertext || !envelope?.iv || !envelope?.authTag) {
      return NextResponse.json({ error: "envelope.ciphertext, iv and authTag are required" }, { status: 400 });
    }
    if (!HEX_REGEX.test(envelope.ciphertext) || !HEX_REGEX.test(envelope.iv) || !HEX_REGEX.test(envelope.authTag)) {
      return NextResponse.json({ error: "Envelope fields must be 0x-prefixed" }, { status: 400 });
    }

    const ciphertextBytes = ethers.getBytes(envelope.ciphertext);
    const ivBytes = ethers.getBytes(envelope.iv);
    const authTagBytes = ethers.getBytes(envelope.authTag);
    const senderPubKeyBytes = ethers.getBytes(senderPublicKey);

    if (ciphertextBytes.length !== 32) {
      return NextResponse.json({ error: "Envelope ciphertext must be 32 bytes" }, { status: 400 });
    }
    if (ivBytes.length !== 12) {
      return NextResponse.json({ error: "Envelope IV must be 12 bytes" }, { status: 400 });
    }
    if (authTagBytes.length !== 16) {
      return NextResponse.json({ error: "Envelope authTag must be 16 bytes" }, { status: 400 });
    }

    const computedHash = ethers.keccak256(ethers.concat([ciphertextBytes, ivBytes, authTagBytes, senderPubKeyBytes]));
    if (computedHash.toLowerCase() !== receiverEnvelopeHash.toLowerCase()) {
      return NextResponse.json({ error: "receiverEnvelopeHash mismatch" }, { status: 400 });
    }

    const record = await saveReceiverEnvelope({
      commitment,
      receiverEnvelopeHash,
      ciphertextHash,
      metadataShortHash: body.metadataShortHash,
      metadataKeccak: body.metadataKeccak,
      senderPublicKey,
      envelope: {
        ciphertext: envelope.ciphertext,
        iv: envelope.iv,
        authTag: envelope.authTag
      }
    });

    return NextResponse.json({ ok: true, record });
  } catch (err: any) {
    console.error("escrow envelope store failed", err);
    return NextResponse.json({ error: err?.message ?? "Internal Server Error" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const commitment = url.searchParams.get("commitment") ?? url.searchParams.get("sessionKeyCommitment");
  const receiverEnvelopeHash = url.searchParams.get("receiverEnvelopeHash");

  if (!commitment && !receiverEnvelopeHash) {
    return NextResponse.json({ error: "commitment or receiverEnvelopeHash is required" }, { status: 400 });
  }

  try {
    let record;

    if (commitment) {
      record = await getReceiverEnvelope(commitment);
    }

    if (!record && receiverEnvelopeHash) {
      record = await findReceiverEnvelopeByHash(receiverEnvelopeHash);
    }

    if (!record) {
      return NextResponse.json({ error: "Envelope not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, record });
  } catch (err: any) {
    console.error("escrow envelope fetch failed", err);
    return NextResponse.json({ error: err?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
