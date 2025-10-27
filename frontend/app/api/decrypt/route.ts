import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { sealedMessageAbi } from "@/lib/sealedMessageAbi";
import { supportedChains, ZERO_ADDRESS, getChainByKey, getChainById, toViemChain, type ChainConfig } from "@/lib/chains";
import { appConfig } from "@/lib/env";
import { getReceiverEnvelope, findReceiverEnvelopeByHash } from "@/lib/escrowStore";
import type { ReceiverEnvelopeRecord } from "@/lib/escrowStore";
import { ethers } from "ethers";

const HEX_REGEX = /^0x[0-9a-fA-F]+$/;
const IPFS_GATEWAYS = [
	(hash: string) => `https://gateway.pinata.cloud/ipfs/${hash}`,
	(hash: string) => `https://ipfs.io/ipfs/${hash}`,
	(hash: string) => `https://dweb.link/ipfs/${hash}`
];

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
		const publicEnvKey = `NEXT_PUBLIC_${chainKey.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_RPC_URL`;
		const publicOverride = process.env[publicEnvKey as keyof NodeJS.ProcessEnv];
		if (typeof publicOverride === "string" && publicOverride.length > 0) {
			return publicOverride;
		}
	}
	if (config.id === defaultChainConfig.id) {
		return defaultResolvedRpcUrl;
	}
	return config.rpcUrls.default;
}

function resolveChainContext(input: { chainKey?: unknown; chainId?: unknown }) {
	let requestedKey = typeof input.chainKey === "string" && input.chainKey.trim().length > 0 ? input.chainKey.trim() : undefined;
	const rawChainId = typeof input.chainId === "number" ? input.chainId : typeof input.chainId === "string" && input.chainId.trim().length > 0 ? Number(input.chainId) : undefined;
	const requestedId = Number.isFinite(rawChainId) ? Number(rawChainId) : undefined;

	let config: ChainConfig | undefined;
	let resolvedKey: string | undefined;

	if (requestedKey) {
		config = getChainByKey(requestedKey);
		if (!config) {
			console.warn(`⚠️ Unknown chainKey "${requestedKey}" requested for decrypt API, falling back.`);
			requestedKey = undefined;
		} else {
			resolvedKey = requestedKey;
		}
	}

	if (!config && requestedId !== undefined) {
		config = getChainById(requestedId);
		if (!config) {
			console.warn(`⚠️ Unknown chainId ${requestedId} requested for decrypt API, falling back.`);
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
	if (!contractAddress || contractAddress === ZERO_ADDRESS) {
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

	return { config, client, contractAddress: contractAddress as `0x${string}`, chainKey: resolvedKey ?? chainKeyFromEnv };
}

const isHex = (value: unknown): value is string => typeof value === "string" && HEX_REGEX.test(value);

const toHex = (bytes: Uint8Array): string => `0x${Buffer.from(bytes).toString("hex")}`;

async function fetchIpfsPayload(uri: string) {
	if (!uri.startsWith("ipfs://")) {
		throw new Error("Invalid URI format. Expected ipfs://...");
	}

	const ipfsHash = uri.replace("ipfs://", "");

	if (ipfsHash.toLowerCase().includes("stub")) {
		return {
			stub: true,
			decrypted: "🎉 Bu bir test mesajıdır. Şifreleme henüz aktif değilken kullanılan stub içerik.",
			binary: new Uint8Array(0),
			text: null
		};
	}

	let lastError: Error | null = null;
	for (const gateway of IPFS_GATEWAYS) {
		const url = gateway(ipfsHash);
		try {
			console.log("📦 Fetching encrypted payload from", url);
			const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			const buffer = await response.arrayBuffer();
			const binary = new Uint8Array(buffer);
			let text: string | null = null;
			try {
				text = new TextDecoder().decode(binary);
			} catch {
				text = null;
			}
			return { stub: false, binary, text };
		} catch (err: any) {
			console.warn(`⚠️ IPFS gateway ${url} failed:`, err?.message || err);
			lastError = err instanceof Error ? err : new Error(String(err));
		}
	}

	throw lastError ?? new Error("Unable to fetch IPFS payload");
}

async function resolveEnvelope(
	sessionKeyCommitment: string,
	receiverEnvelopeHash?: string
): Promise<ReceiverEnvelopeRecord> {
	const commitmentRecord = await getReceiverEnvelope(sessionKeyCommitment);
	if (commitmentRecord) {
		if (
			receiverEnvelopeHash &&
			commitmentRecord.receiverEnvelopeHash.toLowerCase() !== receiverEnvelopeHash.toLowerCase()
		) {
			throw new Error("receiverEnvelopeHash does not match stored record");
		}
		return commitmentRecord;
	}

	if (receiverEnvelopeHash) {
		const hashRecord = await findReceiverEnvelopeByHash(receiverEnvelopeHash);
			if (hashRecord) {
				return hashRecord;
			}
	}

	throw new Error("Envelope not found for provided commitment");
}

function normalizeHex(value: unknown, field: string): string {
	if (typeof value !== "string" || !HEX_REGEX.test(value)) {
		throw new Error(`${field} must be 0x-prefixed hex string`);
	}
	return value.toLowerCase();
}

function splitCiphertext(binary: Uint8Array) {
	if (binary.length <= 16) {
		throw new Error("Encrypted payload too short");
	}
	const ciphertext = binary.slice(0, binary.length - 16);
	const authTag = binary.slice(binary.length - 16);
	return { ciphertext, authTag };
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

export async function POST(request: Request) {
	try {
		const body = await request.json();
		const viewerParam = typeof body.viewerAddress === "string" ? body.viewerAddress.trim() : undefined;
		const viewer = viewerParam && /^0x[0-9a-fA-F]{40}$/.test(viewerParam)
			? (viewerParam as `0x${string}`)
			: undefined;

		if (!viewer) {
			return NextResponse.json({ error: "viewerAddress is required" }, { status: 401 });
		}

		const { client: publicClient, contractAddress, config: activeChain } = resolveChainContext({
			chainKey: body.chainKey,
			chainId: body.chainId
		});

		const messageIdRaw = body.messageId ?? body.id;
		if (messageIdRaw === undefined) {
			return NextResponse.json({ error: "messageId is required" }, { status: 400 });
		}

		const messageId = BigInt(messageIdRaw);
		const uri = body.uri;
		const ivHex = normalizeHex(body.iv, "iv");
		const authTagHex = normalizeHex(body.authTag, "authTag");
		const sessionKeyCommitment = normalizeHex(body.sessionKeyCommitment, "sessionKeyCommitment");
		const receiverEnvelopeHash = body.receiverEnvelopeHash ? normalizeHex(body.receiverEnvelopeHash, "receiverEnvelopeHash") : undefined;
		const clientCiphertextHash = body.ciphertextHash && HEX_REGEX.test(body.ciphertextHash) ? body.ciphertextHash.toLowerCase() : undefined;

		if (!uri || typeof uri !== "string") {
			return NextResponse.json({ error: "uri is required" }, { status: 400 });
		}

		const envelope = await resolveEnvelope(sessionKeyCommitment, receiverEnvelopeHash);

		const onchainMessage = await publicClient.readContract({
			address: contractAddress,
			abi: sealedMessageAbi,
			functionName: "getMessage",
			args: [messageId],
			account: viewer
		}) as any;

		const financialView = await publicClient.readContract({
			address: contractAddress,
			abi: sealedMessageAbi,
			functionName: "getMessageFinancialView",
			args: [messageId],
			account: viewer
		}) as any;

		if (!financialView?.isUnlocked) {
			return NextResponse.json({ error: "Message is still locked" }, { status: 423 });
		}

		const chainUri = onchainMessage?.[2] as string | undefined;
		const chainIv = onchainMessage?.[3] as string | undefined;
		const chainAuthTag = onchainMessage?.[4] as string | undefined;
		const chainCiphertextHash = onchainMessage?.[5] as string | undefined;
		const chainSessionCommitment = onchainMessage?.[10] as string | undefined;
		const chainReceiverEnvelopeHash = onchainMessage?.[11] as string | undefined;
		const chainRevoked = Boolean(onchainMessage?.[14]);

		if (chainRevoked) {
			return NextResponse.json({ error: "Message has been revoked" }, { status: 409 });
		}

		if (!chainSessionCommitment || chainSessionCommitment.toLowerCase() !== sessionKeyCommitment) {
			return NextResponse.json({ error: "Session commitment mismatch" }, { status: 400 });
		}

		if (chainReceiverEnvelopeHash && receiverEnvelopeHash && chainReceiverEnvelopeHash.toLowerCase() !== receiverEnvelopeHash) {
			return NextResponse.json({ error: "On-chain receiver envelope hash mismatch" }, { status: 400 });
		}

		if (chainUri && chainUri !== uri) {
			console.warn("⚠️ URI mismatch between request and chain", { chainUri, requestUri: uri });
		}

		if (chainIv && chainIv.toLowerCase() !== ivHex) {
			console.warn("⚠️ IV mismatch between request and chain", { chainIv, requestIv: ivHex });
		}

		if (chainAuthTag && chainAuthTag.toLowerCase() !== authTagHex) {
			console.warn("⚠️ Auth tag mismatch between request and chain", { chainAuthTag, requestAuthTag: authTagHex });
		}

		const payload = await fetchIpfsPayload(uri);

		if (payload.stub) {
			return NextResponse.json({ success: true, decrypted: payload.decrypted, isStub: true });
		}

		const { ciphertext, authTag } = splitCiphertext(payload.binary);
		const computedCiphertextHash = ethers.keccak256(payload.binary);
		const expectedCiphertextHash = (clientCiphertextHash ?? chainCiphertextHash ?? "").toLowerCase();
		const ciphertextHashVerified = expectedCiphertextHash ? computedCiphertextHash.toLowerCase() === expectedCiphertextHash : true;

		if (!ciphertextHashVerified) {
			console.warn("⚠️ Ciphertext hash mismatch", {
				messageId: messageId.toString(),
				expected: expectedCiphertextHash,
				computed: computedCiphertextHash
			});
		}

		return NextResponse.json({
			success: true,
			ciphertext: toHex(ciphertext),
			authTag: toHex(authTag),
			iv: ivHex,
			senderPublicKey: envelope.senderPublicKey,
			receiverEnvelope: envelope.envelope,
			sessionKeyCommitment: envelope.commitment,
			receiverEnvelopeHash: envelope.receiverEnvelopeHash,
			ciphertextHashVerified,
			ciphertextHash: computedCiphertextHash,
			metadataShortHash: envelope.metadataShortHash ?? null,
			metadataKeccak: envelope.metadataKeccak ?? null,
			note: ciphertextHashVerified ? undefined : "Ciphertext hash mismatch detected",
			chain: {
				chainId: activeChain.id,
				name: activeChain.name
			}
		});
	} catch (err: any) {
		if (isMessageMissingError(err)) {
			console.warn("⚠️ Message not found on requested chain during decrypt");
			return NextResponse.json({ error: "Message not found on this chain" }, { status: 404 });
		}
		console.error("❌ Decrypt API error:", err);
		return NextResponse.json({ error: err?.message ?? "Decryption failed" }, { status: 500 });
	}
}
import * as secp256k1 from '@noble/secp256k1';

