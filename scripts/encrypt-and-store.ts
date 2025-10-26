import crypto from "crypto";
import * as dotenv from "dotenv";
import { promises as fs } from "fs";
import path from "path";
import hre from "hardhat";

dotenv.config();

const { ethers } = hre;

function toBuffer(hexOrBytes: string | Uint8Array): Buffer {
  if (typeof hexOrBytes === "string") {
    const normalized = hexOrBytes.startsWith("0x") ? hexOrBytes.slice(2) : hexOrBytes;
    return Buffer.from(normalized, "hex");
  }
  return Buffer.from(hexOrBytes);
}

function deriveSharedSecret(privateKey: string, publicKey: string): Buffer {
  const ecdh = crypto.createECDH("secp256k1");
  const privBytes = toBuffer(privateKey);
  const pubBytes = toBuffer(publicKey);
  if (!(pubBytes.length === 33 || pubBytes.length === 65)) {
    throw new Error("RECEIVER_PUBLIC_KEY must be 33-byte (compressed) or 65-byte (uncompressed) hex string");
  }
  ecdh.setPrivateKey(privBytes);
  return ecdh.computeSecret(pubBytes);
}

async function resolveContractAddress(networkName: string): Promise<string> {
  const explicit = process.env.CONTRACT_ADDRESS;
  if (explicit) {
    return explicit;
  }

  try {
    const deploymentsDir = path.resolve(__dirname, "..", "deployments");
    const metadata = await fs.readFile(path.join(deploymentsDir, `${networkName}.json`), "utf-8");
    const parsed = JSON.parse(metadata);
    if (typeof parsed.address === "string" && parsed.address.startsWith("0x")) {
      return parsed.address;
    }
  } catch (error) {
    // Ignore and throw below for a clearer message
  }

  throw new Error(
    "Set CONTRACT_ADDRESS env var or ensure deployments/<network>.json exists with an address field."
  );
}

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY is required to sign the transaction");
  }

  const receiverAddress = process.env.RECEIVER_ADDRESS;
  if (!receiverAddress || !ethers.isAddress(receiverAddress)) {
    throw new Error("RECEIVER_ADDRESS must be a valid Ethereum address");
  }

  const receiverPublicKey = process.env.RECEIVER_PUBLIC_KEY;
  if (!receiverPublicKey) {
    throw new Error("RECEIVER_PUBLIC_KEY is required (hex, 65-byte uncompressed recommended)");
  }

  const message = process.env.MESSAGE ?? "Merhaba Base!";
  const messageUri = process.env.MESSAGE_URI ?? "ipfs://placeholder";
  const outputDir = process.env.METADATA_OUTPUT_DIR ?? path.resolve(__dirname, "..", "tmp");

  const wallet = new ethers.Wallet(privateKey, ethers.provider);
  const senderPublicKey = new ethers.SigningKey(privateKey).publicKey;
  const sharedSecret = deriveSharedSecret(privateKey, receiverPublicKey);
  const aesKey = crypto.createHash("sha256").update(sharedSecret).digest();

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
  const ciphertext = Buffer.concat([cipher.update(message, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const ciphertextHash = ethers.keccak256(ciphertext);

  const metadataDocument = {
    version: 1,
    scheme: "aes-256-gcm+ecdh",
    messageUri,
    sender: wallet.address,
    receiver: receiverAddress,
  senderPublicKey,
    receiverPublicKey,
    ciphertext: ciphertext.toString("base64"),
    iv: ethers.hexlify(iv),
    authTag: ethers.hexlify(authTag),
    ciphertextHash,
    createdAt: new Date().toISOString()
  } as const;

  const metadataJson = JSON.stringify(metadataDocument, null, 2);
  const metadataHash = ethers.keccak256(ethers.toUtf8Bytes(metadataJson));

  await fs.mkdir(outputDir, { recursive: true });
  const metadataFile = path.join(outputDir, `sealed-message-${metadataHash.slice(2)}.json`);
  await fs.writeFile(metadataFile, metadataJson, "utf-8");

  const contractAddress = await resolveContractAddress(hre.network.name);
  const artifact = await hre.artifacts.readArtifact("SealedMessage");
  const contract = new ethers.Contract(contractAddress, artifact.abi, wallet);

  console.log("\n=== SealedMessage Off-Chain Encryption ===");
  console.log(`Network: ${hre.network.name}`);
  console.log(`Sender:  ${wallet.address}`);
  console.log(`Receiver: ${receiverAddress}`);
  console.log(`Message URI: ${messageUri}`);
  console.log(`Metadata file: ${metadataFile}`);
  console.log(`ciphertextHash: ${ciphertextHash}`);
  console.log(`metadataHash:  ${metadataHash}`);

  const tx = await contract.sendMessage(
    receiverAddress,
    messageUri,
    iv,
    authTag,
    ciphertextHash,
    metadataHash,
    senderPublicKey
  );

  console.log("Submitting transaction...");
  const receipt = await tx.wait();
  const total = await contract.messageCount();
  const newMessageId = total > 0n ? total - 1n : 0n;

  console.log(`\n✅ Stored message #${newMessageId.toString()}`);
  console.log(`Tx: ${receipt.hash}`);
  console.log("Remember to pin the metadata file at the URI you provided so receivers can fetch it.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
