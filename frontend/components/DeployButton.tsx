"use client";

import { useState, useEffect } from "react";
import { useAccount, useContractWrite, useWaitForTransaction, useNetwork } from "wagmi";
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
      // Sadece bir kez çalışmasını sağla
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
        
        // Callback'i setTimeout ile geciktir
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
  setError(error.message || "Transaction failed");
    }
  });

  const handleDeploy = async () => {
    if (!isConnected) {
  setError("Connect your wallet first");
      return;
    }

    if (!contractAddress || contractAddress === "0x0000000000000000000000000000000000000000") {
      setError(`Bu ağda (${chain?.name}) factory henüz deploy edilmemiş`);
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
        <p className="text-sm text-slate-400">Yükleniyor...</p>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="rounded-lg border border-yellow-600 bg-yellow-900/20 p-4">
        <p className="text-sm text-yellow-200">
          ⚠️ Contract deploy etmek için önce cüzdanınızı bağlayın
        </p>
      </div>
    );
  }

  if (!contractAddress || contractAddress === "0x0000000000000000000000000000000000000000") {
    return (
      <div className="rounded-lg border border-orange-600 bg-orange-900/20 p-4">
        <p className="text-sm text-orange-200">
          ⚠️ Bu ağda ({chain?.name}) factory contract henüz deploy edilmemiş.
        </p>
        <p className="mt-2 text-xs text-orange-300">
          Lütfen desteklenen bir ağa geçin (Sepolia, Base Sepolia, vb.)
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-slate-700 bg-slate-900/60 p-6 shadow-lg backdrop-blur">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-aurora">
            Kendi Contract&apos;ınızı Deploy Edin
          </h3>
          <p className="mt-1 text-sm text-slate-400">
            Bu ağda ({chain?.name}) kendi ChronoMessage contract&apos;ınızı oluşturun
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
              Deploy Ediliyor...
            </span>
          ) : (
            "🚀 Deploy Et"
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
            ⏳ Transaction onaylanıyor... (~15 saniye)
          </p>
        </div>
      )}

      {deployedAddress && (
        <div className="rounded-lg border border-green-600 bg-green-900/20 p-4">
          <p className="text-sm font-semibold text-green-200">
            ✅ Contract başarıyla deploy edildi!
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
              Explorer&apos;da Görüntüle →
            </a>
          </div>
        </div>
      )}

      <div className="rounded-lg bg-slate-800/50 p-4">
        <h4 className="text-sm font-semibold text-slate-200">💡 Nasıl Çalışır?</h4>
        <ul className="mt-2 space-y-1 text-xs text-slate-400">
          <li>• Factory contract üzerinden yeni bir ChronoMessage instance oluşturulur</li>
          <li>• Contract&apos;ın sahibi sizsiniz (deployer)</li>
          <li>• Sadece sizin mesajlarınız bu contract&apos;ta saklanır</li>
          <li>• Her ağda farklı contract deploy edebilirsiniz</li>
          <li>• Deploy maliyeti: ~0.001-0.01 ETH (ağa göre değişir)</li>
        </ul>
      </div>
    </div>
  );
}
