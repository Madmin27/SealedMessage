require("dotenv").config();
const hre = require("hardhat");

function formatConditionMask(mask) {
  const flags = [];
  if ((mask & 0x01) !== 0) flags.push("time");
  if ((mask & 0x02) !== 0) flags.push("payment");
  return flags.length ? flags.join(" + ") : "none";
}

function formatUnlockStatus({ mask, unlockTime, requiredPayment, paidAmount, nowTs }) {
  const hasTime = (mask & 0x01) !== 0;
  const hasPayment = (mask & 0x02) !== 0;
  const timeOk = !hasTime || nowTs >= unlockTime;
  const paymentOk = !hasPayment || paidAmount >= requiredPayment;

  if (hasTime && hasPayment) {
    return {
      isUnlocked: timeOk || paymentOk,
      reason: `time:${timeOk ? "ok" : "pending"}, payment:${paymentOk ? "ok" : "pending"}`
    };
  }

  return {
    isUnlocked: timeOk && paymentOk,
    reason: `time:${timeOk ? "ok" : "pending"}, payment:${paymentOk ? "ok" : "pending"}`
  };
}

async function main() {
  const contractAddress = process.env.SEALED_MESSAGE_CONTRACT_ADDRESS;
  if (!contractAddress) {
    throw new Error("SEALED_MESSAGE_CONTRACT_ADDRESS env var not set");
  }

  const args = process.argv.slice(2);
  let targetAddress = process.env.INSPECT_ADDRESS || "";

  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (!token) continue;
    if (token.toLowerCase() === "--address" && args[i + 1]) {
      targetAddress = args[i + 1];
      break;
    }
    if (/^0x[a-fA-F0-9]{40}$/.test(token)) {
      targetAddress = token;
      break;
    }
  }

  if (!targetAddress) {
    console.error("Usage: npx hardhat run scripts/inspectMessages.js --network sepolia --address <0x...>");
    process.exit(1);
  }

  const { ethers } = hre;
  const provider = ethers.provider;
  const network = await provider.getNetwork();
  console.log(`🔍 Inspecting messages for ${targetAddress} on chain ${network.chainId}`);

  const contract = await ethers.getContractAt("SealedMessage", contractAddress);

  const totalCount = Number(await contract.messageCount());
  if (totalCount === 0) {
    console.log("ℹ️ No messages recorded on this contract yet.");
    return;
  }

  const sentIds = await contract.getSentMessages(targetAddress);
  const receivedIds = await contract.getReceivedMessages(targetAddress);
  const idsForAddress = new Set([...(sentIds ?? []).map(id => Number(id)), ...(receivedIds ?? []).map(id => Number(id))]);

  const nowTs = Math.floor(Date.now() / 1000);
  console.log(`🕒 Current time: ${nowTs}`);

  let shown = 0;

  for (let id = 0; id < totalCount; id++) {
    const data = await contract.getMessage(id);
    const isMatch = idsForAddress.size === 0 || idsForAddress.has(id) ||
      data.sender.toLowerCase() === targetAddress.toLowerCase() ||
      data.receiver.toLowerCase() === targetAddress.toLowerCase();

    if (!isMatch) {
      continue;
    }

    const conditionMask = Number(data.conditionMask);
    const unlockTime = Number(data.unlockTime);
    const requiredPayment = BigInt(data.requiredPayment.toString());
    const paidAmount = BigInt(data.paidAmount.toString());
    const status = formatUnlockStatus({
      mask: conditionMask,
      unlockTime,
      requiredPayment,
      paidAmount,
      nowTs
    });

    console.log("\n────────────────────────────");
    console.log(`📨 Message #${id}`);
    console.log(`   Sender   : ${data.sender}`);
    console.log(`   Receiver : ${data.receiver}`);
    console.log(`   URI      : ${data.uri}`);
    console.log(`   Conditions: ${formatConditionMask(conditionMask)} (mask ${conditionMask})`);
    console.log(`   UnlockTime: ${unlockTime} (${unlockTime ? new Date(unlockTime * 1000).toISOString() : "n/a"})`);
    console.log(`   Payment   : required ${requiredPayment} wei, paid ${paidAmount} wei`);
    console.log(`   Revoked   : ${data.revoked}`);
    console.log(`   Unlocked? : ${status.isUnlocked} (${status.reason})`);

    shown += 1;
  }

  if (shown === 0) {
    console.log("ℹ️ No messages matched the provided address. Use INSPECT_ADDRESS env var to target receiver or choose another account.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
