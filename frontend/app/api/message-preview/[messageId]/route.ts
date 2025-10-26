import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { sealedMessageAbi } from "@/lib/sealedMessageAbi";
import { appConfig } from "@/lib/env";
import { getChainByKey, getChainById, supportedChains, toViemChain, type ChainConfig } from "@/lib/chains";

interface RouteContext {
  params: {
    messageId: string;
  };
}

const chainKeyFromEnv = process.env.NEXT_PUBLIC_CHAIN_KEY ?? "sepolia";
const defaultChainConfig =
  getChainByKey(chainKeyFromEnv) ??
  getChainByKey("sepolia") ??
  Object.values(supportedChains)[0];

if (!defaultChainConfig) {
  throw new Error("Chain configuration is missing");
}

const defaultRpcEnvKey = `${chainKeyFromEnv.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_RPC_URL`;
const defaultServerRpcUrl = process.env[defaultRpcEnvKey as keyof NodeJS.ProcessEnv];
const defaultResolvedRpcUrl =
  typeof defaultServerRpcUrl === "string" && defaultServerRpcUrl.length > 0
    ? defaultServerRpcUrl
    : appConfig.chain.rpcUrl ?? defaultChainConfig.rpcUrls.default;

const publicClientCache = new Map<number, ReturnType<typeof createPublicClient>>();
const chainKeyLookup = new Map<number, string>();
for (const [key, config] of Object.entries(supportedChains)) {
  chainKeyLookup.set(config.id, key);
}

function resolveRpcUrl(chainKey: string | undefined, config: ChainConfig) {
  if (chainKey) {
    const envKey = `${chainKey.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_RPC_URL`;
    const overridden = process.env[envKey as keyof NodeJS.ProcessEnv];
    if (typeof overridden === "string" && overridden.length > 0) {
      return overridden;
    }
  }
  if (config.id === defaultChainConfig.id) {
    return defaultResolvedRpcUrl;
  }
  return config.rpcUrls.default;
}

function resolveChainContext(params: URLSearchParams) {
  const chainKeyParam = params.get("chainKey")?.trim();
  const chainIdParam = params.get("chainId")?.trim();
  const requestedKey = chainKeyParam && chainKeyParam.length > 0 ? chainKeyParam : undefined;
  const requestedId = chainIdParam && chainIdParam.length > 0 ? Number(chainIdParam) : undefined;

  let config: ChainConfig | undefined;
  let resolvedKey: string | undefined;

  if (requestedKey) {
    config = getChainByKey(requestedKey);
    if (!config) {
      console.warn(`⚠️ Unknown chainKey "${requestedKey}" requested for message preview, falling back.`);
    } else {
      resolvedKey = requestedKey;
    }
  }

  if (!config && Number.isFinite(requestedId)) {
    config = getChainById(Number(requestedId));
    if (!config) {
      console.warn(`⚠️ Unknown chainId ${requestedId} requested for message preview, falling back.`);
    } else {
      resolvedKey = chainKeyLookup.get(config.id);
    }
  }

  if (!config) {
    config = defaultChainConfig;
    resolvedKey = chainKeyFromEnv;
  }

  if (!config) {
    throw new Error("Unable to resolve chain configuration");
  }

  const contractAddress = config.contractAddress;
  if (!contractAddress) {
    throw new Error(`Contract address unavailable for chain ${config.name}`);
  }

  let client = publicClientCache.get(config.id);
  if (!client) {
    const rpcUrl = resolveRpcUrl(resolvedKey, config);
    client = createPublicClient({
      chain: toViemChain(config),
      transport: http(rpcUrl)
    });
    publicClientCache.set(config.id, client);
  }

  return { client, contractAddress: contractAddress as `0x${string}` };
}

function isMessageMissingError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const fields: string[] = [];
  const message = (error as { message?: unknown }).message;
  if (typeof message === "string") {
    fields.push(message);
  }
  const shortMessage = (error as { shortMessage?: unknown }).shortMessage;
  if (typeof shortMessage === "string") {
    fields.push(shortMessage);
  }
  const details = (error as { details?: unknown }).details;
  if (typeof details === "string") {
    fields.push(details);
  }
  const metaMessages = (error as { metaMessages?: unknown }).metaMessages;
  if (Array.isArray(metaMessages)) {
    for (const item of metaMessages) {
      if (typeof item === "string") {
        fields.push(item);
      }
    }
  }

  if (fields.some((value) => value.includes("MessageNotFound"))) {
    return true;
  }

  const cause = (error as { cause?: unknown }).cause;
  if (cause && cause !== error) {
    return isMessageMissingError(cause);
  }

  return false;
}

export async function GET(request: Request, context: RouteContext) {
  const { messageId } = context.params;
  if (!messageId) {
    return NextResponse.json({ error: "messageId is required" }, { status: 400 });
  }

  try {
    const url = new URL(request.url);
    const { client: publicClient, contractAddress } = resolveChainContext(url.searchParams);

    // getMessage ve getMessageFinancialView kullan
    const message = await publicClient.readContract({
      address: contractAddress,
      abi: sealedMessageAbi,
      functionName: "getMessage",
      args: [BigInt(messageId)]
    }) as any;

    const financialData = await publicClient.readContract({
      address: contractAddress,
      abi: sealedMessageAbi,
      functionName: "getMessageFinancialView",
      args: [BigInt(messageId)]
    }) as any;

    return NextResponse.json({
      ok: true,
      message: {
        id: messageId,
        sender: message.sender,
        receiver: message.receiver,
        unlockTime: financialData.unlockTime.toString(),
        isUnlocked: financialData.isUnlocked,
        conditionMask: message.conditionMask,
        hasTimeCondition: (message.conditionMask & 0x01) !== 0,
        hasPaymentCondition: (message.conditionMask & 0x02) !== 0,
        requiredPayment: financialData.requiredPayment?.toString() || "0"
      }
    });
  } catch (err) {
    if (isMessageMissingError(err)) {
      console.warn(`message-preview/[${messageId}] missing on requested chain`);
      return NextResponse.json({ error: "Message not found on this chain" }, { status: 404 });
    }
    console.error("message-preview/[id] GET failed", err);
    return NextResponse.json({ error: "Failed to fetch message metadata" }, { status: 500 });
  }
}
