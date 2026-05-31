export type DeploymentVersionKey = "v3" | "v4-fhe-legacy" | "v5-fhe" | "v5.1-fhe" | "v5.2-fhe";

export type DeploymentDefinition = {
  key: DeploymentVersionKey;
  label: string;
  description: string;
  chainId: number;
  isFHE: boolean;
  address?: `0x${string}`;
  isCurrent?: boolean;
};

const sepoliaDeployments: DeploymentDefinition[] = [
  {
    key: "v3",
    label: "V3 - Legacy",
    description: "ECDH + AES legacy flow",
    chainId: 11155111,
    isFHE: false,
    address: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_SEPOLIA as `0x${string}` | undefined,
  },
  {
    key: "v4-fhe-legacy",
    label: "V4-FHE - Legacy",
    description: "Legacy FHE flow with plaintext metadata",
    chainId: 11155111,
    isFHE: true,
    address: (process.env.NEXT_PUBLIC_FHE_CONTRACT_ADDRESS_SEPOLIA ?? process.env.NEXT_PUBLIC_FHE_CONTRACT_ADDRESS_ZAMA) as `0x${string}` | undefined,
  },
  {
    key: "v5-fhe",
    label: "V5-FHE - Legacy",
    description: "Legacy V5 — deployed today, preserved for existing messages",
    chainId: 11155111,
    isFHE: true,
    isCurrent: false,
    address: process.env.NEXT_PUBLIC_FHE_SECURE_CONTRACT_ADDRESS_SEPOLIA as `0x${string}` | undefined,
  },
  {
    key: "v5.1-fhe",
    label: "V5.1-FHE",
    description: "Hardened: gated key release, pull-payment, no OR mode",
    chainId: 11155111,
    isFHE: true,
    isCurrent: false,
    address: process.env.NEXT_PUBLIC_FHE_SECURE_V51_CONTRACT_ADDRESS_SEPOLIA as `0x${string}` | undefined,
  },
  {
    key: "v5.2-fhe",
    label: "V5.2-FHE - Current",
    description: "Hardened current flow with Time OR Payment unlock support",
    chainId: 11155111,
    isFHE: true,
    isCurrent: true,
    address: process.env.NEXT_PUBLIC_FHE_SECURE_V52_CONTRACT_ADDRESS_SEPOLIA as `0x${string}` | undefined,
  },
];

const deploymentsByChain: Record<number, DeploymentDefinition[]> = {
  11155111: sepoliaDeployments,
};

export function getDeploymentsForChain(chainId?: number): DeploymentDefinition[] {
  if (!chainId) return [];
  return deploymentsByChain[chainId] ?? [];
}

export function getDeployment(chainId: number | undefined, key: string | undefined): DeploymentDefinition | undefined {
  if (!chainId || !key) return undefined;
  return getDeploymentsForChain(chainId).find((deployment) => deployment.key === key);
}

export function getDefaultDeploymentVersion(chainId?: number): DeploymentVersionKey | undefined {
  const deployments = getDeploymentsForChain(chainId);
  const current = deployments.find((deployment) => deployment.isCurrent && deployment.address);
  if (current) {
    return current.key;
  }
  return deployments.find((deployment) => deployment.address)?.key;
}

export function isFheVersionKey(versionKey?: string): boolean {
  return versionKey === "v4-fhe-legacy" || versionKey === "v5-fhe" || versionKey === "v5.1-fhe" || versionKey === "v5.2-fhe";
}
