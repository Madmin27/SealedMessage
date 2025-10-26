require("dotenv").config();
const hre = require("hardhat");

async function main() {
  const contractAddress = process.env.SEALED_MESSAGE_CONTRACT_ADDRESS;
  if (!contractAddress) {
    throw new Error("SEALED_MESSAGE_CONTRACT_ADDRESS env var not set");
  }
  const messageId = 20;
  
  const SealedMessage = await hre.ethers.getContractFactory("SealedMessage");
  const contract = SealedMessage.attach(contractAddress);
  
  console.log("Fetching message #" + messageId + "...\n");
  
  const result = await contract.getMessage(messageId);
  
  console.log("Message Data:");
  console.log("  Sender:", result.sender);
  console.log("  Receiver:", result.receiver);
  console.log("  URI:", result.uri);
  console.log("  IV:", result.iv);
  console.log("  IV length:", result.iv.length);
  console.log("  AuthTag:", result.authTag);
  console.log("  AuthTag length:", result.authTag.length);
  console.log("  CiphertextHash:", result.ciphertextHash);
  console.log("  MetadataHash:", result.metadataHash);
  console.log("  SenderPublicKey:", result.senderPublicKey);
  console.log("  SenderPubKey length:", result.senderPublicKey.length);
  console.log("  UnlockTime:", new Date(Number(result.unlockTime) * 1000).toISOString());
  console.log("  Exists:", result.exists);
  
  console.log("\n✅ URI is present:", result.uri !== "" && result.uri !== "0x");
  console.log("✅ IV is present:", result.iv !== "0x" && result.iv.length > 2);
  console.log("✅ AuthTag is present:", result.authTag !== "0x" && result.authTag.length > 2);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
