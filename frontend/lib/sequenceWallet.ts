import { sequence } from "0xsequence";
import type { Chain, Wallet } from "@rainbow-me/rainbowkit";
import { createConnector } from "@wagmi/core";
import {
	createWalletClient,
	custom,
	getAddress,
	type Address,
	UserRejectedRequestError
} from "viem";

export interface SequenceWalletOptions {
	chains: Chain[];
	defaultNetwork?: sequence.network.ChainIdLike;
	connect?: sequence.provider.ConnectOptions;
	useEIP6492?: boolean;
	walletAppURL?: string;
	onConnect?: (details: sequence.provider.ConnectDetails) => void;
	projectAccessKey: string;
}

const ICON_DATA_URL =
	"data:image/svg+xml;base64," +
	btoa(`<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg" style="fill:none" version="1.1" viewBox="0 0 396 396" height="396" width="396">
	<g transform="translate(0,38)" clip-path="url(#clip0_5_131)">
		<g clip-path="url(#clip1_5_131)">
			<path style="fill:#111111" d="M 0,67.5049 V 250.165 c 0,37.282 30.1402,67.505 67.32,67.505 h 261.36 c 37.18,0 67.32,-30.223 67.32,-67.505 V 67.5049 C 396,30.223 365.86,0 328.68,0 H 67.32 C 30.1402,0 0,30.223 0,67.5049 Z" />
			<path style="fill:url(#paint0_linear_5_131)" d="M 0,67.5049 V 250.165 c 0,37.282 30.1402,67.505 67.32,67.505 h 261.36 c 37.18,0 67.32,-30.223 67.32,-67.505 V 67.5049 C 396,30.223 365.86,0 328.68,0 H 67.32 C 30.1402,0 0,30.223 0,67.5049 Z" />
			<path style="fill:url(#paint1_linear_5_131)" d="m 98.9999,79.4176 c 0,-10.9653 -8.8648,-19.8544 -19.8,-19.8544 -10.9352,0 -19.8,8.8891 -19.8,19.8544 0,10.9652 8.8648,19.8544 19.8,19.8544 10.9352,0 19.8,-8.8892 19.8,-19.8544 z" />
			<path style="fill:url(#paint2_linear_5_131)" d="m 98.9999,79.4176 c 0,-10.9653 -8.8648,-19.8544 -19.8,-19.8544 -10.9352,0 -19.8,8.8891 -19.8,19.8544 0,10.9652 8.8648,19.8544 19.8,19.8544 10.9352,0 19.8,-8.8892 19.8,-19.8544 z" />
			<path style="fill:url(#paint3_linear_5_131)" d="m 98.9999,79.4176 c 0,-10.9653 -8.8648,-19.8544 -19.8,-19.8544 -10.9352,0 -19.8,8.8891 -19.8,19.8544 0,10.9652 8.8648,19.8544 19.8,19.8544 10.9352,0 19.8,-8.8892 19.8,-19.8544 z" />
			<path style="fill:url(#paint4_linear_5_131)" d="m 98.9999,238.126 c 0,-10.965 -8.8648,-19.854 -19.8,-19.854 -10.9352,0 -19.8,8.889 -19.8,19.854 0,10.966 8.8648,19.855 19.8,19.855 10.9352,0 19.8,-8.889 19.8,-19.855 z" />
			<path style="fill:url(#paint5_linear_5_131)" d="m 336.6,158.835 c 0,-10.965 -8.865,-19.854 -19.8,-19.854 -10.935,0 -19.8,8.889 -19.8,19.854 0,10.965 8.865,19.855 19.8,19.855 10.935,0 19.8,-8.89 19.8,-19.855 z" />
			<path style="fill:url(#paint6_linear_5_131)" d="m 336.6,158.835 c 0,-10.965 -8.865,-19.854 -19.8,-19.854 -10.935,0 -19.8,8.889 -19.8,19.854 0,10.965 8.865,19.855 19.8,19.855 10.935,0 19.8,-8.89 19.8,-19.855 z" />
			<path style="fill:url(#paint7_linear_5_131)" d="M 316.8,59.5632 H 158.4 c -10.935,0 -19.8,8.8891 -19.8,19.8544 0,10.9652 8.865,19.8544 19.8,19.8544 h 158.4 c 10.935,0 19.8,-8.8892 19.8,-19.8544 0,-10.9653 -8.865,-19.8544 -19.8,-19.8544 z" />
			<path style="fill:url(#paint8_linear_5_131)" d="M 316.8,218.272 H 158.4 c -10.935,0 -19.8,8.889 -19.8,19.854 0,10.966 8.865,19.855 19.8,19.855 h 158.4 c 10.935,0 19.8,-8.889 19.8,-19.855 0,-10.965 -8.865,-19.854 -19.8,-19.854 z" />
			<path style="fill:url(#paint9_linear_5_131)" d="M 237.6,138.981 H 79.2 c -10.9352,0 -19.8,8.889 -19.8,19.854 0,10.965 8.8648,19.855 19.8,19.855 h 158.4 c 10.935,0 19.8,-8.89 19.8,-19.855 0,-10.965 -8.865,-19.854 -19.8,-19.854 z" />
		</g>
	</g>
	<defs>
		<linearGradient gradientUnits="userSpaceOnUse" y2="318" x2="198" y1="0" x1="198" id="paint0_linear_5_131">
			<stop stop-color="#1D273D" />
			<stop stop-color="#0D0F13" offset="1" />
		</linearGradient>
		<linearGradient gradientUnits="userSpaceOnUse" y2="63" x2="92.5" y1="99" x1="65.5" id="paint1_linear_5_131">
			<stop stop-color="#4462FE" />
			<stop stop-color="#7D69FA" offset="1" />
		</linearGradient>
		<linearGradient gradientUnits="userSpaceOnUse" y2="97.591103" x2="96.137703" y1="99.291199" x1="62.879902" id="paint2_linear_5_131">
			<stop stop-color="#3757FD" />
			<stop stop-color="#6980FA" offset="1" />
		</linearGradient>
		<linearGradient gradientUnits="userSpaceOnUse" y2="97.591103" x2="96.137703" y1="99.291199" x1="62.879902" id="paint3_linear_5_131">
			<stop stop-color="#2447FF" />
			<stop stop-color="#4E63FA" offset="1" />
		</linearGradient>
		<linearGradient gradientUnits="userSpaceOnUse" y2="273.127" x2="92.5" y1="237.126" x1="65.5" id="paint4_linear_5_131">
			<stop stop-color="#3D88EF" />
			<stop stop-color="#6C9FEB" offset="1" />
		</linearGradient>
		<linearGradient gradientUnits="userSpaceOnUse" y2="178.69" x2="336.6" y1="138.981" x1="316.8" id="paint5_linear_5_131">
			<stop stop-color="#29A8D8" />
			<stop stop-color="#56BCE6" offset="1" />
		</linearGradient>
		<linearGradient gradientUnits="userSpaceOnUse" y2="180.69" x2="336.6" y1="140.981" x1="316.8" id="paint6_linear_5_131">
			<stop stop-color="#29A8D8" />
			<stop stop-color="#64D2FF" offset="1" />
		</linearGradient>
		<linearGradient gradientUnits="userSpaceOnUse" y2="98.2712" x2="316.8" y1="59.5632" x1="158.4" id="paint7_linear_5_131">
			<stop stop-color="#3898FF" />
			<stop stop-color="#74B6FF" offset="1" />
		</linearGradient>
		<linearGradient gradientUnits="userSpaceOnUse" y2="258.127" x2="316.8" y1="218.272" x1="158.4" id="paint8_linear_5_131">
			<stop stop-color="#3898FF" />
			<stop stop-color="#74B6FF" offset="1" />
		</linearGradient>
		<linearGradient gradientUnits="userSpaceOnUse" y2="178.835" x2="237.6" y1="138.981" x1="79.2" id="paint9_linear_5_131">
			<stop stop-color="#3898FF" />
			<stop stop-color="#74B6FF" offset="1" />
		</linearGradient>
		<clipPath id="clip0_5_131">
			<rect width="396" height="320" fill="white" />
		</clipPath>
		<clipPath id="clip1_5_131">
			<rect width="396" height="320" fill="white" />
		</clipPath>
	</defs>
</svg>`);

const normalizeChainId = (chain: string | number | bigint | { chainId: string }): number => {
	if (typeof chain === "object") {
		return normalizeChainId(chain.chainId);
	}
	if (typeof chain === "string") {
		const trimmed = chain.trim();
		const base = trimmed.startsWith("0x") ? 16 : 10;
		return Number.parseInt(trimmed, base);
	}
	if (typeof chain === "bigint") {
		return Number(chain);
	}
	return chain;
};

const resolveAddress = async (provider: sequence.SequenceProvider): Promise<Address> => {
	const signer = provider.getSigner();
	const address = await signer.getAddress();
	return getAddress(address);
};

export const createSequenceConnector = ({
	projectAccessKey,
	chains,
	defaultNetwork,
	connect,
	walletAppURL,
	useEIP6492,
	onConnect
}: SequenceWalletOptions) =>
	createConnector<sequence.SequenceProvider>(((config: any) => {
		const provider = sequence.initWallet(projectAccessKey, {
			defaultNetwork,
			transports: walletAppURL ? { walletAppURL } : undefined,
			defaultEIP6492: useEIP6492
		});

		if (onConnect) {
			provider.client.onConnect(onConnect);
		}

		const isChainUnsupported = (chainId: number) =>
			provider.networks.findIndex((network) => network.chainId === chainId) === -1;

		const emitAccountsChanged = (accounts: string[]) => {
			if (!accounts.length) {
				config.emitter.emit("disconnect");
				return;
			}
			const normalized = accounts.map((account) => getAddress(account));
			config.emitter.emit("change", { accounts: normalized });
		};

		const emitChainChanged = (chain: string | number | bigint | { chainId: string }) => {
			const chainId = normalizeChainId(chain);
			config.emitter.emit("change", { chainId });
		};

		const emitDisconnect = () => {
			config.emitter.emit("disconnect");
		};

		let accountsListener: ((accounts: string[]) => void) | undefined;
		let chainListener:
			| ((chain: string | number | bigint | { chainId: string }) => void)
			| undefined;
		let disconnectListener: (() => void) | undefined;

		const ensureListeners = () => {
			if (!accountsListener) {
				accountsListener = emitAccountsChanged;
				provider.on("accountsChanged", accountsListener);
			}
			if (!chainListener) {
				chainListener = emitChainChanged;
				provider.on("chainChanged", chainListener);
			}
			if (!disconnectListener) {
				disconnectListener = emitDisconnect;
				provider.on("disconnect", disconnectListener);
			}
		};

				return {
			id: "sequence",
			name: "Sequence",
			type: "sequence",
					async connect(
						{
							chainId,
							withCapabilities
						}: { chainId?: number; withCapabilities?: boolean } = {}
					) {
				if (!provider.isConnected()) {
					config.emitter.emit("message", { type: "connecting" });
					const response = await provider.connect(connect ?? { app: "RainbowKit app" });
					if (response.error) {
						throw new UserRejectedRequestError(new Error(response.error));
					}
					if (!response.connected) {
						throw new UserRejectedRequestError(new Error("Wallet connection rejected"));
					}
				}

				if (typeof chainId === "number" && provider.getChainId() !== chainId) {
					if (isChainUnsupported(chainId)) {
						throw new Error("Unsupported chain");
					}
					provider.setDefaultChainId(chainId);
				}

				const address = await resolveAddress(provider);
				ensureListeners();

				const activeChainId = provider.getChainId();

												if (withCapabilities) {
													return {
														accounts: [
															{
																address,
																capabilities: {} as Record<string, unknown>
															}
														],
														chainId: activeChainId
													} as any;
												}

												return {
													accounts: [address] as readonly Address[],
													chainId: activeChainId
												} as any;
			},
			async disconnect() {
				provider.disconnect();
			},
			async getAccounts() {
				const address = await resolveAddress(provider);
				return [address] as const;
			},
			async getChainId() {
				return provider.getChainId();
			},
			async getProvider() {
				return provider;
			},
			async getClient({ chainId }: { chainId?: number } = {}) {
				const targetChainId = chainId ?? provider.getChainId();
				const target = chains.find((candidate) => candidate.id === targetChainId);
				return createWalletClient({
					chain: target,
					account: await resolveAddress(provider),
					transport: custom(provider)
				});
			},
			async isAuthorized() {
				try {
					await resolveAddress(provider);
					return true;
				} catch {
					return false;
				}
			},
			async switchChain({ chainId }: { chainId: number }) {
				if (isChainUnsupported(chainId)) {
					throw new Error("Unsupported chain");
				}
				provider.setDefaultChainId(chainId);
				const target = chains.find((candidate) => candidate.id === chainId);
				if (!target) {
					throw new Error("Chain not configured");
				}
				return target;
			},
			onAccountsChanged: emitAccountsChanged,
			onChainChanged: emitChainChanged,
			onDisconnect: emitDisconnect
		};
			}) as any);

export const sequenceWallet = (options: SequenceWalletOptions): Wallet => ({
	id: "sequence",
	name: "Sequence",
	iconUrl: ICON_DATA_URL,
	iconBackground: "#fff",
	createConnector: () => createSequenceConnector(options),
	downloadUrls: {
		mobile: "https://sequence.app",
		qrCode: "https://sequence.app",
		desktop: "https://sequence.app",
		linux: "https://sequence.app",
		macos: "https://sequence.app",
		windows: "https://sequence.app"
	},
	mobile: {
		getUri: () => window.location.href
	},
	desktop: {
		getUri: () => window.location.href
	}
});
