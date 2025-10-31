import hre from "hardhat";
import { promises as fs } from "fs";
import path from "path";

async function main() {
  if (hre.network.name !== "incentiv") {
    console.log("⚠️ This smoke test is intended for the Incentiv network. Current network:", hre.network.name);
    return;
  }

  const deploymentPath = path.resolve(__dirname, "..", "deployments", "incentiv.json");
  const deploymentRaw = await fs.readFile(deploymentPath, "utf-8");
  const deployment = JSON.parse(deploymentRaw) as { address: string };

  const [signer] = await hre.ethers.getSigners();
  console.log("🔌 Connected signer:", signer.address);

  const contract = await hre.ethers.getContractAt("SealedMessage", deployment.address, signer);
  console.log("📄 Target contract:", deployment.address);

  const beforeCount = await contract.messageCount();
  console.log("ℹ️  messageCount (before):", Number(beforeCount));

  const unlockTime = Math.floor(Date.now() / 1000) + 15 * 60; // 15 minutes from now
  const iv = "0x0102030405060708090a0b0c";
  const authTag = "0x0d0e0f101112131415161718191a1b1c";
  const ciphertextHash = hre.ethers.id("smoke-ciphertext");
  const metadataHash = hre.ethers.id("smoke-metadata");
  const escrowCiphertext = hre.ethers.hexlify(Buffer.alloc(32, 0x11));
  const escrowIv = "0x0c0b0a090807060504030201";
  const escrowAuthTag = "0x1c1b1a191817161514131211100f0e0d";
  const sessionKeyCommitment = hre.ethers.id("smoke-session-key");
  const receiverEnvelopeHash = hre.ethers.id("smoke-receiver-envelope");
  const escrowKeyVersion = 1;

  console.log("🚀 Sending smoke-test message...");
  const tx = await contract.sendMessage(
    "0x1111111111111111111111111111111111111111",
    "ipfs://sealedmessage/smoke-test",
    iv,
    authTag,
    ciphertextHash,
    metadataHash,
    escrowCiphertext,
    escrowIv,
    escrowAuthTag,
    sessionKeyCommitment,
    receiverEnvelopeHash,
    escrowKeyVersion,
    unlockTime,
    0,
    0x01 // CONDITION_TIME
  );

  const receipt = await tx.wait();
  if (!receipt) {
    throw new Error("Smoke test transaction not mined");
  }

  console.log("✅ Smoke test transaction mined in block", receipt.blockNumber);

  const afterCount = await contract.messageCount();
  console.log("ℹ️  messageCount (after):", Number(afterCount));
}

main().catch((error) => {
  console.error("❌ Smoke test failed:", error);
  process.exitCode = 1;
});
