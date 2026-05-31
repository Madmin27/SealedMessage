import hre from "hardhat";
import { createInstance, SepoliaConfigV2 } from "@zama-fhe/relayer-sdk/node";
import { ethers } from "ethers";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import * as fs from "fs";
import * as path from "path";

import v51Deploy from "../deployments/fhe-v51-sepolia.json";
import v51Abi from "../deployments/fhe-v51-sepolia-abi.json";

const V51_ADDRESS = v51Deploy.address as `0x${string}`;
const CHAIN_ID = 11155111;
const DEFAULT_RELAYER_URL = "https://relayer.testnet.zama.org/v2";

type FheInstance = {
  createEncryptedInput: (contractAddress: string, userAddress: string) => {
    add64: (value: bigint | number) => void;
    encrypt: () => Promise<{ handles: Uint8Array[]; inputProof: Uint8Array }>;
  };
  generateKeypair: () => { publicKey: string; privateKey: string };
  createEIP712: (
    publicKey: string,
    contractAddresses: string[],
    startTimestamp: number,
    durationDays: number
  ) => {
    domain: Record<string, unknown>;
    types: Record<string, ReadonlyArray<{ name: string; type: string }>>;
    message: Record<string, unknown>;
  };
  userDecrypt: (
    handles: Array<{ handle: string; contractAddress: string }>,
    privateKey: string,
    publicKey: string,
    signature: string,
    contractAddresses: string[],
    userAddress: string,
    startTimestamp: number,
    durationDays: number
  ) => Promise<Record<string, bigint | number | string>>;
};

function readEnv(name: string, fallback?: string): string {
  const envPath = path.resolve(__dirname, "..", ".env");
  const envContent = fs.readFileSync(envPath, "utf-8");

  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith(`${name}=`) && !trimmed.startsWith("#")) {
      return trimmed.split("=").slice(1).join("=").trim().replace(/^['"]|['"]$/g, "");
    }
  }

  if (fallback !== undefined) {
    return fallback;
  }

  throw new Error(`${name} not found in .env`);
}

function splitMessageKey(messageKey: Uint8Array): [bigint, bigint, bigint, bigint] {
  const parts: bigint[] = [];

  for (let offset = 0; offset < 32; offset += 8) {
    const view = messageKey.slice(offset, offset + 8);
    parts.push(BigInt(`0x${Buffer.from(view).toString("hex")}`));
  }

  return parts as [bigint, bigint, bigint, bigint];
}

function combineMessageKey(parts: [bigint, bigint, bigint, bigint]): Uint8Array {
  const key = new Uint8Array(32);

  parts.forEach((part, index) => {
    const hex = part.toString(16).padStart(16, "0");
    key.set(Uint8Array.from(Buffer.from(hex, "hex")), index * 8);
  });

  return key;
}

function encryptJsonEnvelope(payload: unknown, key: Uint8Array) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key), iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    version: 1 as const,
    algorithm: "aes-256-gcm" as const,
    ciphertext: `0x${ciphertext.toString("hex")}`,
    iv: `0x${iv.toString("hex")}`,
    authTag: `0x${authTag.toString("hex")}`,
  };
}

function decryptJsonEnvelope<T>(
  envelope: { ciphertext: string; iv: string; authTag: string },
  key: Uint8Array
): T {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key),
    Buffer.from(envelope.iv.slice(2), "hex")
  );
  decipher.setAuthTag(Buffer.from(envelope.authTag.slice(2), "hex"));
  const ciphertext = Buffer.from(envelope.ciphertext.slice(2), "hex");
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return JSON.parse(plaintext.toString("utf8")) as T;
}

async function expectFailure(label: string, action: () => Promise<unknown>) {
  try {
    await action();
    throw new Error(`${label} unexpectedly succeeded`);
  } catch (error: any) {
    const message = error?.shortMessage ?? error?.reason ?? error?.message ?? String(error);
    console.log(`  ✅ ${label} blocked: ${message.slice(0, 120)}`);
  }
}

async function decryptForUser(params: {
  instance: FheInstance;
  signer: ethers.Signer;
  contractAddress: `0x${string}`;
  userAddress: string;
  handles: [`0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`];
}): Promise<[bigint, bigint, bigint, bigint]> {
  const { instance, signer, contractAddress, userAddress, handles } = params;
  const keypair = instance.generateKeypair();
  const startTimestamp = Math.floor(Date.now() / 1000);
  const durationDays = 7;
  const eip712 = instance.createEIP712(keypair.publicKey, [contractAddress], startTimestamp, durationDays);
  const { EIP712Domain: _ignored, ...types } = eip712.types;
  const signature = await signer.signTypedData(eip712.domain as any, types as any, eip712.message as any);

  const decrypted = await instance.userDecrypt(
    handles.map((handle) => ({ handle, contractAddress })),
    keypair.privateKey,
    keypair.publicKey,
    signature,
    [contractAddress],
    userAddress,
    startTimestamp,
    durationDays
  );

  return handles.map((handle) => BigInt(decrypted[handle])) as [bigint, bigint, bigint, bigint];
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const provider = hre.ethers.provider;
  const rpcUrl = readEnv("SEPOLIA_RPC_URL");
  const relayerUrl = readEnv("ZAMA_RELAYER_URL", DEFAULT_RELAYER_URL);

  const receiver = ethers.Wallet.createRandom().connect(provider);
  const thirdParty = ethers.Wallet.createRandom().connect(provider);

  console.log("\n=== SealedMessageFHE v5.1 Live Flow Test ===\n");
  console.log(`Contract:     ${V51_ADDRESS}`);
  console.log(`Deployer:     ${deployer.address}`);
  console.log(`Receiver:     ${receiver.address}`);
  console.log(`Third party:  ${thirdParty.address}`);
  console.log(`Relayer:      ${relayerUrl}\n`);

  const deployerBalance = await provider.getBalance(deployer.address);
  console.log(`Deployer balance: ${ethers.formatEther(deployerBalance)} ETH`);

  const fundAmount = ethers.parseEther("0.0025");
  for (const wallet of [receiver, thirdParty]) {
    const balance = await provider.getBalance(wallet.address);
    if (balance < fundAmount) {
      const tx = await deployer.sendTransaction({ to: wallet.address, value: fundAmount - balance });
      await tx.wait();
    }
  }

  console.log("Funding complete.\n");

  const fheInstance = (await createInstance({
    ...SepoliaConfigV2,
    chainId: CHAIN_ID,
    relayerUrl,
    network: rpcUrl,
  })) as unknown as FheInstance;

  const senderContract = new ethers.Contract(V51_ADDRESS, v51Abi, deployer);
  const receiverContract = new ethers.Contract(V51_ADDRESS, v51Abi, receiver);
  const thirdPartyContract = new ethers.Contract(V51_ADDRESS, v51Abi, thirdParty);

  const messageKey = randomBytes(32);
  const keyParts = splitMessageKey(messageKey);
  const payloadEnvelope = encryptJsonEnvelope(
    {
      version: 1,
      message: "v5.1 live flow payload",
      attachmentEnvelopeCid: null,
    },
    messageKey
  );
  const metadataEnvelope = encryptJsonEnvelope(
    {
      version: 1,
      createdAt: new Date().toISOString(),
      hasAttachment: false,
      attachment: null,
    },
    messageKey
  );

  const payloadCid = `local://sealed-payload/${Date.now()}`;
  const metadataCid = `local://sealed-metadata/${Date.now()}`;
  const payloadHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(payloadEnvelope)));
  const metadataHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(metadataEnvelope)));

  console.log("[1] Encrypting FHE shares via relayer...");
  const encInput = fheInstance.createEncryptedInput(V51_ADDRESS, deployer.address);
  keyParts.forEach((part) => encInput.add64(part));
  const encrypted = await encInput.encrypt();
  const handles = encrypted.handles.map((handle) => ethers.hexlify(handle)) as [`0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`];
  const inputProof = ethers.hexlify(encrypted.inputProof) as `0x${string}`;
  console.log(`  Handles ready: ${handles.length}`);

  const currentCount = await senderContract.messageCount();
  const requiredPayment = ethers.parseEther("0.00005");

  console.log("[2] Sending PaymentOnly message on-chain...");
  const sendTx = await senderContract.sendMessage(
    receiver.address,
    0,
    requiredPayment,
    1,
    payloadCid,
    metadataCid,
    "",
    "live-flow",
    payloadHash,
    metadataHash,
    handles[0],
    handles[1],
    handles[2],
    handles[3],
    inputProof
  );
  await sendTx.wait();
  const messageId = currentCount;
  console.log(`  Message stored: #${messageId}`);

  console.log("[3] Pre-unlock negative checks...");
  await expectFailure("receiver getKeyHandles before unlock", () => receiverContract.getKeyHandles(messageId));
  await expectFailure("receiver userDecrypt before unlock", () =>
    decryptForUser({
      instance: fheInstance,
      signer: receiver,
      contractAddress: V51_ADDRESS,
      userAddress: receiver.address,
      handles,
    })
  );
  await expectFailure("sender userDecrypt before unlock", () =>
    decryptForUser({
      instance: fheInstance,
      signer: deployer,
      contractAddress: V51_ADDRESS,
      userAddress: deployer.address,
      handles,
    })
  );
  await expectFailure("third-party userDecrypt before unlock", () =>
    decryptForUser({
      instance: fheInstance,
      signer: thirdParty,
      contractAddress: V51_ADDRESS,
      userAddress: thirdParty.address,
      handles,
    })
  );

  console.log("[4] Satisfying payment condition and unlocking...");
  const payTx = await receiverContract.payToUnlock(messageId, { value: requiredPayment });
  await payTx.wait();
  const pendingAfterPay = await senderContract.pendingWithdrawals(deployer.address);
  console.log(`  Sender pending withdrawals: ${ethers.formatEther(pendingAfterPay)} ETH`);
  const unlockTx = await receiverContract.unlockMessage(messageId);
  await unlockTx.wait();
  console.log("  Message unlocked");

  console.log("[5] Post-unlock handle checks...");
  const returnedHandles = (await receiverContract.getKeyHandles(messageId)) as [`0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`];
  const sameHandles = returnedHandles.every((handle, index) => handle.toLowerCase() === handles[index].toLowerCase());
  if (!sameHandles) {
    throw new Error("Returned handles differ from stored external handles");
  }
  console.log("  Receiver obtained expected 4 handles");
  await expectFailure("sender getKeyHandles after unlock", () => senderContract.getKeyHandles(messageId));
  await expectFailure("third-party getKeyHandles after unlock", () => thirdPartyContract.getKeyHandles(messageId));

  console.log("[6] Receiver decrypt flow...");
  const decryptedParts = await decryptForUser({
    instance: fheInstance,
    signer: receiver,
    contractAddress: V51_ADDRESS,
    userAddress: receiver.address,
    handles: returnedHandles,
  });
  const rebuiltKey = combineMessageKey(decryptedParts);
  if (Buffer.compare(Buffer.from(rebuiltKey), Buffer.from(messageKey)) !== 0) {
    throw new Error("Rebuilt AES key does not match original key");
  }
  const decryptedPayload = decryptJsonEnvelope<{ message: string }>(payloadEnvelope, rebuiltKey);
  if (decryptedPayload.message !== "v5.1 live flow payload") {
    throw new Error("Payload decrypt did not match expected plaintext");
  }
  console.log("  Receiver userDecrypt succeeded and payload decrypted");

  console.log("[7] Post-unlock unauthorized decrypt checks...");
  await expectFailure("sender userDecrypt after unlock", () =>
    decryptForUser({
      instance: fheInstance,
      signer: deployer,
      contractAddress: V51_ADDRESS,
      userAddress: deployer.address,
      handles: returnedHandles,
    })
  );
  await expectFailure("third-party userDecrypt after unlock", () =>
    decryptForUser({
      instance: fheInstance,
      signer: thirdParty,
      contractAddress: V51_ADDRESS,
      userAddress: thirdParty.address,
      handles: returnedHandles,
    })
  );

  console.log("[8] Pull-payment withdrawal check...");
  const withdrawTx = await senderContract.withdrawPayments();
  await withdrawTx.wait();
  const pendingAfterWithdraw = await senderContract.pendingWithdrawals(deployer.address);
  if (pendingAfterWithdraw !== 0n) {
    throw new Error("Pending withdrawals were not cleared");
  }
  console.log("  Withdraw completed and pending balance cleared");

  console.log("\n=== Live flow test passed ===");
  console.log("- relayer encrypt works");
  console.log("- pre-unlock decrypt blocked for all parties");
  console.log("- unlock grants receiver-only handle access");
  console.log("- receiver userDecrypt reconstructs the message secret");
  console.log("- payload decrypt succeeds with rebuilt secret material");
  console.log("- sender withdraw pull-payment works\n");
}

main().catch((error) => {
  console.error("\n❌ LIVE FLOW TEST FAILED");
  console.error(error);
  process.exit(1);
});
