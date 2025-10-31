import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
// Only load FHEVM plugin for Zama network to avoid compatibility issues
if (process.env.ENABLE_FHEVM === "true") {
  require("@fhevm/hardhat-plugin");
}
import * as dotenv from "dotenv";

dotenv.config();

const networks: HardhatUserConfig["networks"] = {
  hardhat: {
    chainId: 31337
  },
  localhost: {
    url: "http://127.0.0.1:8547",
    chainId: 31337
  }
};

const privateKey = process.env.PRIVATE_KEY;

// Sepolia Testnet
if (process.env.SEPOLIA_RPC_URL && privateKey) {
  networks.sepolia = {
    url: process.env.SEPOLIA_RPC_URL,
    accounts: [privateKey],
    chainId: 11155111
  };
}

// Ethereum Mainnet
if (process.env.MAINNET_RPC_URL && privateKey) {
  networks.mainnet = {
    url: process.env.MAINNET_RPC_URL,
    accounts: [privateKey],
    chainId: 1
  };
}

// Polygon Mumbai Testnet (deprecated - use Amoy)
if (process.env.MUMBAI_RPC_URL && privateKey) {
  networks.mumbai = {
    url: process.env.MUMBAI_RPC_URL,
    accounts: [privateKey],
    chainId: 80001
  };
}

// Polygon Amoy Testnet (new testnet)
if (process.env.POLYGON_AMOY_RPC_URL && privateKey) {
  networks.polygonAmoy = {
    url: process.env.POLYGON_AMOY_RPC_URL,
    accounts: [privateKey],
    chainId: 80002
  };
}

// Base Sepolia Testnet
if (process.env.BASE_SEPOLIA_RPC_URL && privateKey) {
  networks.baseSepolia = {
    url: process.env.BASE_SEPOLIA_RPC_URL,
    accounts: [privateKey],
    chainId: 84532
  };
}

// Linea Sepolia Testnet
if (process.env.LINEA_SEPOLIA_RPC_URL && privateKey) {
  networks.lineaSepolia = {
    url: process.env.LINEA_SEPOLIA_RPC_URL,
    accounts: [privateKey],
    chainId: 59141
  };
}

// Arbitrum Sepolia Testnet
if (process.env.ARBITRUM_SEPOLIA_RPC_URL && privateKey) {
  networks.arbitrumSepolia = {
    url: process.env.ARBITRUM_SEPOLIA_RPC_URL,
    accounts: [privateKey],
    chainId: 421614
  };
}

// Optimism Sepolia Testnet
if (process.env.OPTIMISM_SEPOLIA_RPC_URL && privateKey) {
  networks.optimismSepolia = {
    url: process.env.OPTIMISM_SEPOLIA_RPC_URL,
    accounts: [privateKey],
    chainId: 11155420
  };
}

// Monad Testnet
if (process.env.MONAD_TESTNET_RPC_URL && privateKey) {
  networks.monadTestnet = {
    url: process.env.MONAD_TESTNET_RPC_URL,
    accounts: [privateKey],
    chainId: 10143
  };
}

// Scroll Sepolia Testnet
if (process.env.SCROLL_SEPOLIA_RPC_URL && privateKey) {
  networks.scrollSepolia = {
    url: process.env.SCROLL_SEPOLIA_RPC_URL,
    accounts: [privateKey],
    chainId: 534351
  };
}

// Incentiv Testnet
const incentivRpcUrl = process.env.INCENTIV_TESTNET_RPC_URL ?? process.env.INCENTIV_RPC_URL;
if (incentivRpcUrl && privateKey) {
  networks.incentiv = {
    url: incentivRpcUrl,
    accounts: [privateKey],
    chainId: 28802
  };
}

// Polygon Mainnet
if (process.env.POLYGON_RPC_URL && privateKey) {
  networks.polygon = {
    url: process.env.POLYGON_RPC_URL,
    accounts: [privateKey],
    chainId: 137
  };
}

// Zama FHEVM (gelecek sprint)
const rpcUrl = process.env.RPC_URL;
if (rpcUrl && privateKey) {
  networks.fhevm = {
    url: rpcUrl,
    accounts: [privateKey],
    chainId: process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : undefined
  };
}

// Neura Testnet
if (process.env.NEURA_TESTNET_RPC_URL && privateKey) {
  networks.neuraTestnet = {
    url: process.env.NEURA_TESTNET_RPC_URL,
    accounts: [privateKey],
    chainId: 267
  };
}

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          },
          viaIR: true  // Stack too deep çözümü için
        }
      },
      {
        version: "0.8.24",  // Zama FHE contracts için
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          },
          viaIR: true  // Stack too deep fix for metadata fields
        }
      }
    ]
  },
  defaultNetwork: "hardhat",
  networks,
  etherscan: {
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY ?? "",
      baseSepolia: process.env.BASESCAN_API_KEY ?? "",
      scrollSepolia: process.env.SCROLLSCAN_API_KEY ?? ""
    },
    customChains: [
      {
        network: "sepolia",
        chainId: 11155111,
        urls: {
          apiURL: "https://api-sepolia.etherscan.io/api",
          browserURL: "https://sepolia.etherscan.io"
        }
      },
      {
        network: "baseSepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org"
        }
      },
      {
        network: "scrollSepolia",
        chainId: 534351,
        urls: {
          apiURL: "https://api-sepolia.scrollscan.com/api",
          browserURL: "https://sepolia.scrollscan.com"
        }
      }
    ]
  }
};

export default config;
