"use client";

import { useEffect, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { useContractAddress } from "../lib/useContractAddress";
import { sealedMessageAbi } from "../lib/sealedMessageAbi";
import { getOrCreateEncryptionKey } from "../lib/keyAgreement";
import { ethers } from "ethers";

/**
 * Auto-registers user's encryption key on first DApp visit
 */
export function EncryptionKeyManager() {
  const { address, isConnected } = useAccount();
  const contractAddress = useContractAddress();
  const publicClient = usePublicClient();
  const [isRegistering, setIsRegistering] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);

  useEffect(() => {
    if (!isConnected || !address || !contractAddress || !publicClient || hasChecked) {
      return;
    }

    const checkAndRegister = async () => {
      try {
        setIsRegistering(true);

        const existingKey = await publicClient.readContract({
          address: contractAddress as any,
          abi: sealedMessageAbi,
          functionName: "getEncryptionKey",
          args: [address]
        }) as string;

        if (existingKey && existingKey !== "0x" && existingKey.length > 4) {
          console.log("✅ EncryptionKeyManager: User already registered");
          setHasChecked(true);
          return;
        }

        console.log("📝 EncryptionKeyManager: Starting registration...");

        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const signer = await provider.getSigner();

        const walletClient = {
          signMessage: async ({ message }: { account?: string; message: string }) => {
            return await signer.signMessage(message);
          }
        };

        const keyPair = await getOrCreateEncryptionKey(walletClient, address);
        const publicKeyHex = "0x" + Buffer.from(keyPair.publicKey).toString('hex');

        const contract = new ethers.Contract(contractAddress, sealedMessageAbi, signer);
        const tx = await contract.registerEncryptionKey(publicKeyHex);
        await tx.wait();
        
        console.log("✅ EncryptionKeyManager: Registration successful!");

      } catch (err: any) {
        console.error("❌ EncryptionKeyManager: Registration failed:", err);
      } finally {
        setIsRegistering(false);
        setHasChecked(true);
      }
    };

    checkAndRegister();
  }, [isConnected, address, contractAddress, publicClient, hasChecked]);

  return null;
}
