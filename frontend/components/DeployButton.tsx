"use client";

import { useState, useEffect } from "react";
import { useAccount, useContractWrite, useWaitForTransaction, useNetwork } from "../lib/wagmiCompat";
import { parseAbi } from "viem";
import { supportedChains } from "../lib/chains";

// Factory ABI (sadece deploy fonksiyonu)
const factoryAbi = parseAbi([
  "function deployChronoMessage(string networkName) external returns (address)",
  "function getUserDeployments(address user) external view returns (address[])",
  "event ChronoMessageDeployed(address indexed deployer, address indexed contractAddress, uint256 timestamp, uint256 chainId)"
]);

interface DeployButtonProps {
  onDeployed?: (contractAddress: string) => void;
}

export function DeployButton({ onDeployed }: DeployButtonProps) {
  const { address, isConnected } = useAccount();
  const { chain } = useNetwork();
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployedAddress, setDeployedAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  // Prevent hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Get Sealed contract address from supportedChains config
  const chainConfig = chain?.id ? Object.values(supportedChains).find(c => c.id === chain.id) : undefined;
  const contractAddress = chainConfig?.contractAddress;

  // Debug log
  if (chain) {
    console.log('🔍 Debug Info:', {
      chainId: chain.id,
      chainName: chain.name,
      chainConfig: chainConfig,
      contractAddress
    });
  }

  const { data, write } = useContractWrite({
    address: contractAddress as `0x${string}`,
    abi: factoryAbi,
    functionName: "deployChronoMessage"
  });

  const { isLoading: isConfirming, isSuccess } = useWaitForTransaction({
    hash: data?.hash,
    onSuccess: (receipt) => {
      // Ensure it runs only once
      if (deployedAddress) return;

      // Parse logs to get deployed contract address
      const deployedEvent = receipt.logs.find((log: any) => {
        try {
          // ChronoMessageDeployed event signature
          return log.topics[0] === "0x..." ; // Event signature hash
        } catch {
          return false;
        }
      });

      if (deployedEvent && deployedEvent.topics && deployedEvent.topics[2]) {
        // Extract contract address from event (topics[2])
        const contractAddr = `0x${deployedEvent.topics[2].slice(26)}`;
        setDeployedAddress(contractAddr);
        setIsDeploying(false);
        
        // Delay callback with setTimeout
        setTimeout(() => {
          onDeployed?.(contractAddr);
        }, 100);
      } else {
        setIsDeploying(false);
  setError("Contract address could not be found in the events");
      }
    },
    onError: (error) => {
      setIsDeploying(false);
      const message = error instanceof Error ? error.message : "Transaction failed";
      setError(message);
    }
  });

  const handleDeploy = async () => {
    if (!isConnected) {
  setError("Connect your wallet first");
      return;
    }

    if (!contractAddress || contractAddress === "0x0000000000000000000000000000000000000000") {
      setError(`Factory not yet deployed on this network (${chain?.name})`);
      return;
    }

    setError(null);
    setIsDeploying(true);

    try {
      write?.({
        args: [chain?.name || "Unknown Network"]
      });
    } catch (err: any) {
      setError(err.message || "Deployment failed");
      setIsDeploying(false);
    }
  };

  // Prevent hydration mismatch - show loading state until mounted
  if (!mounted) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-900/20 p-4">
        <p className="text-sm text-slate-400">Loading...</p>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="rounded-lg border border-yellow-600 bg-yellow-900/20 p-4">
        <p className="text-sm text-yellow-200">
          ⚠️ Connect your wallet first to deploy contract
        </p>
      </div>
    );
  }

  if (!contractAddress || contractAddress === "0x0000000000000000000000000000000000000000") {
    return (
      <div className="rounded-lg border border-orange-600 bg-orange-900/20 p-4">
        <p className="text-sm text-orange-200">
          ⚠️ Factory contract not yet deployed on this network ({chain?.name}).
        </p>
        <p className="mt-2 text-xs text-orange-300">
          Please switch to a supported network (Sepolia, Base Sepolia, etc.)
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-slate-700 bg-slate-900/60 p-6 shadow-lg backdrop-blur">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-aurora">
            Deploy Your Own Contract
          </h3>
          <p className="mt-1 text-sm text-slate-400">
            Create your own ChronoMessage contract on this network ({chain?.name})
          </p>
        </div>
        
        <button
          onClick={handleDeploy}
          disabled={isDeploying || isConfirming}
          className={`rounded-lg px-6 py-3 font-semibold transition ${
            isDeploying || isConfirming
              ? "cursor-not-allowed bg-gray-600 text-gray-400"
              : "bg-gradient-to-r from-aurora to-pink-500 text-white hover:shadow-lg hover:shadow-aurora/50"
          }`}
        >
          {isDeploying || isConfirming ? (
            <span className="flex items-center gap-2">
              <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Deploying...
            </span>
          ) : (
            "🚀 Deploy"
          )}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-600 bg-red-900/20 p-3">
          <p className="text-sm text-red-200">❌ {error}</p>
        </div>
      )}

      {isConfirming && (
        <div className="rounded-lg border border-blue-600 bg-blue-900/20 p-3">
          <p className="text-sm text-blue-200">
            ⏳ Confirming transaction... (~15 seconds)
          </p>
        </div>
      )}

      {deployedAddress && (
        <div className="rounded-lg border border-green-600 bg-green-900/20 p-4">
          <p className="text-sm font-semibold text-green-200">
            ✅ Contract deployed successfully!
          </p>
          <div className="mt-2 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-green-300">Address:</span>
              <code className="rounded bg-black/30 px-2 py-1 text-xs text-green-100">
                {deployedAddress}
              </code>
              <button
                onClick={() => navigator.clipboard.writeText(deployedAddress)}
                className="rounded bg-green-700 px-2 py-1 text-xs hover:bg-green-600"
              >
                Copy
              </button>
            </div>
            <a
              href={`${chain?.blockExplorers?.default?.url}/address/${deployedAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-green-300 hover:text-green-200"
            >
              View on Explorer →
            </a>
          </div>
        </div>
      )}

      <div className="rounded-lg bg-slate-800/50 p-4">
        <h4 className="text-sm font-semibold text-slate-200">💡 How It Works?</h4>
        <ul className="mt-2 space-y-1 text-xs text-slate-400">
          <li>• New ChronoMessage instance is created via factory contract</li>
          <li>• You are the owner of the contract (deployer)</li>
          <li>• Only your messages are stored in this contract</li>
          <li>• You can deploy different contracts on each network</li>
          <li>• Deploy cost: ~0.001-0.01 ETH (varies by network)</li>
        </ul>
      </div>
    </div>
  );
}
