import { ethers } from "hardhat";

async function main() {
  console.log("🚀 Deploying SealedMessage to Sepolia...\n");

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("📋 Deployment Info:");
  console.log("  Deployer:", deployer.address);
  console.log("  Balance:", ethers.formatEther(balance), "ETH");
  console.log("  Network:", (await ethers.provider.getNetwork()).name);
  console.log("  Chain ID:", (await ethers.provider.getNetwork()).chainId);
  console.log("");

  if (balance < ethers.parseEther("0.01")) {
    console.warn("⚠️  Warning: Balance is low. Make sure you have enough ETH for deployment.");
  }

  // Deploy SealedMessage
  console.log("📦 Deploying SealedMessage contract...");
  const SealedMessage = await ethers.getContractFactory("SealedMessage");
  const sealedMessage = await SealedMessage.deploy();
  
  await sealedMessage.waitForDeployment();
  const contractAddress = await sealedMessage.getAddress();

  console.log("✅ SealedMessage deployed to:", contractAddress);
  console.log("");

  // Verify deployment
  console.log("🔍 Verifying deployment...");
  const messageCount = await sealedMessage.messageCount();
  console.log("  Initial message count:", messageCount.toString());

  console.log("");
  console.log("📝 Deployment Summary:");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Contract:        SealedMessage");
  console.log("Address:        ", contractAddress);
  console.log("Network:         Sepolia Testnet");
  console.log("Chain ID:        11155111");
  console.log("Deployer:       ", deployer.address);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");

  console.log("🔗 Next Steps:");
  console.log("1. Update frontend/lib/chains.ts with the new contract address:");
  console.log(`   zamaContractAddress: '${contractAddress}'`);
  console.log("");
  console.log("2. Verify contract on Etherscan:");
  console.log(`   npx hardhat verify --network sepolia ${contractAddress}`);
  console.log("");
  console.log("3. View on Etherscan:");
  console.log(`   https://sepolia.etherscan.io/address/${contractAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });
