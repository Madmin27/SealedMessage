import * as secp256k1 from "@noble/secp256k1";
import { sha256 } from "@noble/hashes/sha2.js";
import { ethers } from "ethers";

// secp256k1 curve order
const CURVE_ORDER = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");

/**
 * Generate fallback encryption keypair for receivers who haven't registered yet.
 * Uses: keccak256(receiverAddress + "SealedMessage" + FALLBACK_SEED)
 * 
 * SECURITY: The FALLBACK_SEED from .env adds extra entropy.
 * Do NOT share your FALLBACK_SEED publicly.
 */
export function generateFallbackKeyPair(receiverAddress: string): {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
} {
  const fallbackSeed = process.env.NEXT_PUBLIC_FALLBACK_SEED || "DefaultSeed";
  
  // Combine receiver address + static string + secret seed
  const seedString = 
    receiverAddress.toLowerCase() + 
    "SealedMessage" + 
    fallbackSeed;
  
  // Generate deterministic seed via keccak256
  const seedHash = ethers.keccak256(ethers.toUtf8Bytes(seedString));
  const seedBytes = ethers.getBytes(seedHash);
  
  // Derive private key via SHA-256 and modulo curve order
  const privateKeyHash = sha256(seedBytes);
  const privateKeyBigInt = BigInt("0x" + Buffer.from(privateKeyHash).toString("hex"));
  const privateKeyReduced = privateKeyBigInt % CURVE_ORDER;
  
  // Ensure non-zero
  if (privateKeyReduced === 0n) {
    throw new Error("Generated zero private key");
  }
  
  const privateKey = hexToBytes(privateKeyReduced.toString(16).padStart(64, "0"));
  const publicKey = secp256k1.getPublicKey(privateKey, true);
  
  console.log("🔑 Generated fallback keypair for", receiverAddress);
  
  return { privateKey, publicKey };
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return bytes;
}
