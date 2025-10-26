import hre from "hardhat";
import { promises as fs } from "fs";
import path from "path";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const balance = await hre.ethers.provider.getBalance(deployer.address);

  console.log("\n=== SealedMessage Deployment ===");
  console.log(`Network: ${hre.network.name}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance: ${hre.ethers.formatEther(balance)} ANKR\n`);

  // Bakiye kontrolü (Neura Testnet için devre dışı - gas-free olabilir)
  const minBalance = hre.ethers.parseEther("0.01");
  if (balance < minBalance && hre.network.name !== 'neuraTestnet') {
    console.error("❌ Insufficient balance! Need at least 0.01 ETH for deployment.");
    process.exit(1);
  }

  console.log("Deploying SealedMessage contract...");
  const SealedMessage = await hre.ethers.getContractFactory("SealedMessage");
  const contract = await SealedMessage.deploy();
  
  console.log("Waiting for deployment confirmation...");
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`\n✅ SealedMessage deployed to: ${address}`);

  // Deployment metadata'yı kaydet
  const deploymentsDir = path.resolve(__dirname, "..", "deployments");
  await fs.mkdir(deploymentsDir, { recursive: true });
  
  const metadata = {
    address,
    network: hre.network.name,
    chainId: hre.network.config.chainId,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    blockNumber: await hre.ethers.provider.getBlockNumber()
  };
  
  const filename = `${hre.network.name}.json`;
  await fs.writeFile(
    path.join(deploymentsDir, filename), 
    JSON.stringify(metadata, null, 2)
  );
  
  console.log(`\n📝 Deployment info saved to: deployments/${filename}`);

  // Network'e göre explorer URL'i
  const explorerUrls: Record<string, string> = {
    sepolia: "https://sepolia.etherscan.io",
    mainnet: "https://etherscan.io",
    polygon: "https://polygonscan.com",
    mumbai: "https://mumbai.polygonscan.com"
  };

  const explorerUrl = explorerUrls[hre.network.name];
  if (explorerUrl) {
    console.log(`\n🔍 View on Explorer: ${explorerUrl}/address/${address}`);
    console.log(`\n📌 To verify contract, run:`);
    console.log(`npx hardhat verify --network ${hre.network.name} ${address}`);
  }

  console.log("\n=== Deployment Complete ===\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
