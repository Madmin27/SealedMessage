import hre from "hardhat";
import { promises as fs } from "fs";
import path from "path";

/**
 * SealedMessageFHE_v51 Deployment Script
 *
 * Usage:
 *   ENABLE_FHEVM=true npx hardhat run scripts/deploy-fhe-v51.ts --network sepolia
 *
 * Ön koşullar:
 *   - .env dosyasında SEPOLIA_RPC_URL, PRIVATE_KEY tanımlı olmalı
 *   - Deployer adreste yeterli Sepolia ETH bulunmalı
 */

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const balance = await hre.ethers.provider.getBalance(deployer.address);

  console.log("\n=== SealedMessageFHE_v51 Deployment ===");
  console.log(`Network: ${hre.network.name} (chain ID: ${hre.network.config.chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance: ${hre.ethers.formatEther(balance)} ETH\n`);

  if (balance === 0n) {
    console.warn("⚠️  Deployer balance is 0. Make sure you have Sepolia ETH.\n");
  }

  console.log("Deploying SealedMessageFHE_v51 contract...");

  // FHEVM plugin ile çalışırken solidity 0.8.24 kullanılır
  const SealedMessageFHE_v51 = await hre.ethers.getContractFactory("SealedMessageFHE_v51");
  const contract = await SealedMessageFHE_v51.deploy();

  console.log("Waiting for deployment confirmation...");
  await contract.waitForDeployment();

  const address = await contract.getAddress();

  // Deployment transaction info
  const deployTx = contract.deploymentTransaction();
  const receipt = deployTx ? await deployTx.wait() : null;

  console.log(`\n✅ SealedMessageFHE_v51 deployed to: ${address}`);
  console.log(`   Block #${receipt?.blockNumber ?? "unknown"}`);
  console.log(`   Gas used: ${receipt?.gasUsed?.toString() ?? "unknown"}`);

  // Verify contract version
  try {
    const version = await contract.CONTRACT_VERSION();
    const versionStr = await contract.CONTRACT_VERSION_STRING();
    console.log(`   Contract version: ${version} (${versionStr})`);
  } catch {
    console.log("   (CONTRACT_VERSION not readable — may need FHE re-encryption)");
  }

  // Deployment metadata'yı kaydet
  const deploymentsDir = path.resolve(__dirname, "..", "deployments");
  await fs.mkdir(deploymentsDir, { recursive: true });

  const metadata = {
    version: "v5.1-fhe",
    contract: "SealedMessageFHE_v51",
    address,
    network: hre.network.name,
    chainId: hre.network.config.chainId,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    blockNumber: receipt?.blockNumber
      ? Number(receipt.blockNumber)
      : await hre.ethers.provider.getBlockNumber(),
    gasUsed: receipt?.gasUsed?.toString() ?? "unknown",
    compiler: "0.8.24+viaIR",
    fhevm: true,
  };

  const filename = `fhe-v51-${hre.network.name}.json`;
  await fs.writeFile(
    path.join(deploymentsDir, filename),
    JSON.stringify(metadata, null, 2)
  );

  console.log(`\n📝 Deployment info saved to: deployments/${filename}`);

  // ABI de kaydedelim (frontend'e kopyalamak için)
  const artifactPath = path.resolve(
    __dirname,
    "..",
    "artifacts",
    "contracts",
    "SealedMessageFHE_v51.sol",
    "SealedMessageFHE_v51.json"
  );
  try {
    const artifact = JSON.parse(await fs.readFile(artifactPath, "utf8"));
    const abiDir = path.resolve(__dirname, "..", "deployments");
    await fs.writeFile(
      path.join(abiDir, `fhe-v51-${hre.network.name}-abi.json`),
      JSON.stringify(artifact.abi, null, 2)
    );
    console.log(`📄 ABI saved to: deployments/fhe-v51-${hre.network.name}-abi.json`);
  } catch (err) {
    console.warn("⚠️  Could not save ABI artifact:", (err as Error).message);
  }

  // Sonraki adımlar
  console.log("\n=== Next Steps ===");
  console.log(`1. Add this address to your frontend .env.local:`);
  console.log(`   NEXT_PUBLIC_FHE_SECURE_V51_CONTRACT_ADDRESS_SEPOLIA=${address}`);
  console.log(`2. Restart the frontend (systemctl restart sealed.service)`);
  console.log(`3. Test the V5.1 secure flow on Sepolia`);
  console.log("\n=== Deployment Complete ===\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
