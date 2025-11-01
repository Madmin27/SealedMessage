import { ethers } from "hardhat";

async function main() {
  console.log("\n🚀 Deploying SealedMessage to ARC Testnet...\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer address:", deployer.address);

  // Get deployer balance
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance:", ethers.formatUnits(balance, 6), "USDC");

  if (balance === 0n) {
    throw new Error("❌ Deployer has no USDC. Please fund your wallet at https://faucet.circle.com");
  }

  // Deploy SealedMessage
  const SealedMessage = await ethers.getContractFactory("SealedMessage");
  const sealedMessage = await SealedMessage.deploy();
  await sealedMessage.waitForDeployment();

  const contractAddress = await sealedMessage.getAddress();
  console.log("\n✅ SealedMessage deployed to:", contractAddress);

  // Save deployment info
  const fs = require("fs");
  const path = require("path");
  const deploymentsDir = path.join(__dirname, "../deployments");
  
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const deploymentInfo = {
    network: "arcTestnet",
    chainId: 5042002,
    contractAddress,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    transactionHash: sealedMessage.deploymentTransaction()?.hash
  };

  fs.writeFileSync(
    path.join(deploymentsDir, "arc-testnet.json"),
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log("\n📝 Deployment info saved to deployments/arc-testnet.json");
  console.log("\n🔗 View on ARC Explorer:");
  console.log(`   https://testnet.arcscan.app/address/${contractAddress}`);
  console.log("\n⚙️  Update your frontend .env.local with:");
  console.log(`   NEXT_PUBLIC_CONTRACT_ADDRESS_ARC_TESTNET="${contractAddress}"`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
