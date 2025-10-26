require('dotenv').config();
const hre = require('hardhat');

async function main() {
  const commitmentArg = process.argv.find((arg) => arg.startsWith('0x')) || process.env.TARGET_COMMITMENT;
  if (!commitmentArg) {
    console.error('Usage: TARGET_COMMITMENT=0x... npx hardhat run scripts/findMessageByCommitment.js --network sepolia');
    process.exit(1);
  }

  const commitment = commitmentArg.toLowerCase();
  const contractAddress = process.env.SEALED_MESSAGE_CONTRACT_ADDRESS;
  if (!contractAddress) {
    throw new Error('SEALED_MESSAGE_CONTRACT_ADDRESS env var not set');
  }

  const { ethers } = hre;
  const contract = await ethers.getContractAt('SealedMessage', contractAddress);
  const count = Number(await contract.messageCount());
  console.log(`🔍 Scanning ${count} messages for commitment ${commitment}`);

  for (let i = 0; i < count; i++) {
    const message = await contract.getMessage(i);
    if (message.sessionKeyCommitment.toLowerCase() === commitment) {
      const financial = await contract.getMessageFinancialView(i);
      console.log('✅ Match found');
      console.log({
        id: i,
        sender: message.sender,
        receiver: message.receiver,
        unlockTime: Number(message.unlockTime),
        requiredPayment: message.requiredPayment.toString(),
        paidAmount: message.paidAmount.toString(),
        conditionMask: Number(message.conditionMask),
        isUnlocked: financial.isUnlocked,
      });
      return;
    }
  }

  console.log('❌ Commitment not found');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});