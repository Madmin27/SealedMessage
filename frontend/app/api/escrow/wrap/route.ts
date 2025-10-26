import { NextResponse } from "next/server";
import { createCipheriv, randomBytes, createHash } from "crypto";
import { ethers } from "ethers";

interface WrapRequestBody {
  sessionKeyHex?: string;
  sessionKeyCommitment?: string;
  metadataShortHash?: string;
}

const HEX_REGEX = /^0x[0-9a-fA-F]+$/;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as WrapRequestBody;
    const sessionKeyHex = body.sessionKeyHex?.trim();
    const sessionKeyCommitment = body.sessionKeyCommitment?.trim();

    if (!sessionKeyHex || !HEX_REGEX.test(sessionKeyHex)) {
      return NextResponse.json({ error: "sessionKeyHex must be a 0x-prefixed hex string" }, { status: 400 });
    }

    if (!sessionKeyCommitment || !HEX_REGEX.test(sessionKeyCommitment)) {
      return NextResponse.json({ error: "sessionKeyCommitment must be provided" }, { status: 400 });
    }

    const keyPartA = process.env.ESCROW_KEY_PART_A;
    const keyPartB = process.env.ESCROW_KEY_PART_B;

    if (!keyPartA || !keyPartB) {
      console.error("escrow wrap: key parts missing from environment");
      return NextResponse.json({ error: "Escrow key material unavailable" }, { status: 500 });
    }

    const materialA = Buffer.from(keyPartA.replace(/^0x/, ""), "hex");
    const materialB = Buffer.from(keyPartB.replace(/^0x/, ""), "hex");
    if (materialA.length === 0 || materialB.length === 0) {
      return NextResponse.json({ error: "Escrow key parts must be non-empty" }, { status: 500 });
    }

    const combinedMaterial = Buffer.concat([materialA, materialB]);
    const derivedKey = createHash("sha256").update(combinedMaterial).digest();
    if (derivedKey.length !== 32) {
      return NextResponse.json({ error: "Escrow derived key must be 32 bytes" }, { status: 500 });
    }

    const plaintextKey = Buffer.from(sessionKeyHex.replace(/^0x/, ""), "hex");
    if (plaintextKey.length !== 32) {
      return NextResponse.json({ error: "Session key must be 32 bytes" }, { status: 400 });
    }

    const computedCommitment = ethers.keccak256(plaintextKey);
    if (computedCommitment.toLowerCase() !== sessionKeyCommitment.toLowerCase()) {
      return NextResponse.json({ error: "Session key commitment mismatch" }, { status: 400 });
    }

    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", derivedKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintextKey), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const keyVersion = Number(process.env.ESCROW_KEY_VERSION ?? 1);

    console.log("🔐 escrow wrap generated", {
      metadataShortHash: body.metadataShortHash ?? null,
      keyVersion,
      ciphertextBytes: ciphertext.length
    });

    return NextResponse.json({
      ok: true,
      wrap: {
        ciphertext: `0x${ciphertext.toString("hex")}`,
        iv: `0x${iv.toString("hex")}`,
        authTag: `0x${authTag.toString("hex")}`,
        keyVersion
      }
    });
  } catch (err: any) {
    console.error("escrow wrap failed", err);
    return NextResponse.json({ error: err?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
