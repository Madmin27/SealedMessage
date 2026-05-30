# SealedMessage

SealedMessage is a privacy-focused messaging dApp that allows creators to lock their content behind time and payment conditions on Ethereum Sepolia. Senders encrypt payloads locally, publish the ciphertext to IPFS, and attach the commitment to an on-chain escrow contract. Receivers unlock the message once the smart contract verifies that the configured release condition is met.

## Core Features
- **Conditional unlocking**: Messages can require a completed payment, a future timestamp, or both before decryption is permitted.
- **Wallet-native UX**: The Next.js frontend integrates with wagmi/viem so users interact with MetaMask and other EVM wallets without custom extensions.
- **IPFS storage**: Encrypted blobs and metadata are pinned off-chain, keeping the on-chain footprint lean.
- **Resilient UI flows**: Optimistic updates and metadata refresh keep the message list in sync after unlock and payment events.

## Architecture
- **Smart contracts**: `contracts/SealedMessage.sol` holds message commitments, escrow balances, and release condition checks.
- **Frontend**: Next.js 14 + TypeScript app under `frontend/` that renders message feeds, handles uploads, and coordinates unlock transactions.
- **APIs**: Edge routes in `frontend/app/api/**` proxy IPFS interactions, manage metadata caching, and prepare unlock payloads.
- **Tooling**: Hardhat scripts in `scripts/` manage deployments and operational maintenance for both the legacy and current Sepolia deployments.

## Security & Privacy
- **End-to-end encryption**: The current secure flow seals payloads and metadata with AES-256-GCM before uploading ciphertext envelopes to IPFS.
- **Ephemeral session keys**: Fresh random seeds per message minimize the blast radius of any key compromise.
- **Commit-reveal pattern**: On-chain commitments prevent tampering and double spending when conditions are enforced.
- **Access control**: In the secure FHE flow, Zama ACL gates the AES key parts and the receiver decrypts them with `userDecrypt` only after conditions pass.
- **Versioned deployments**: The frontend can target legacy V3, legacy V4-FHE, and the current V5 secure FHE deployment through a registry-backed version selector.
- **Preview model**: The secure V5 path keeps payload and private metadata encrypted end-to-end; only optional preview text or preview media should be exposed publicly.
- **Key hygiene**: Sensitive configuration stays in `.env` files; keys are never committed to the repository.
- **Server-only secrets**: Pinning credentials must stay server-side as `PINATA_JWT` or `PINATA_API_KEY`/`PINATA_SECRET_KEY`; do not expose them through `NEXT_PUBLIC_*` variables.

## Getting Started
1. Install dependencies in both root and frontend workspaces:
	```bash
	npm install
	cd frontend && npm install
	```
2. Copy `.env.example` to `.env` (root) and populate network RPC URLs, deployer keys, and storage settings.
3. Create `frontend/.env.local` with client-facing RPC endpoints, wallet keys, deployment addresses, and server-only pinning credentials.
4. Start the development stack:
	```bash
	npm run dev   # Hardhat local node if configured
	cd frontend && npm run dev
	```

## Deployment & Operations
- **Contract deployment**: Deploy Sepolia contracts with the Hardhat scripts, then register addresses in the frontend env for `NEXT_PUBLIC_CONTRACT_ADDRESS_SEPOLIA`, `NEXT_PUBLIC_FHE_CONTRACT_ADDRESS_SEPOLIA` (legacy), and `NEXT_PUBLIC_FHE_SECURE_CONTRACT_ADDRESS_SEPOLIA` (current secure flow).
- **Metadata management**: CLI helpers in `scripts/` (e.g., `encrypt-and-store.ts`, `inspectMessages.js`) assist with content uploads and troubleshooting.
- **IPFS gateway**: The Next.js API routes under `frontend/app/api/ipfs/**` proxy Pinata access and expect `PINATA_JWT` or `PINATA_API_KEY`/`PINATA_SECRET_KEY` on the server.

## Testing & Monitoring
Automated test suites are still incomplete, so rely on targeted QA flows:
- Create a V5 secure message, verify the payload/metadata CIDs resolve only to encrypted envelopes, then unlock and decrypt with the receiver wallet.
- Create a payment-locked message, complete the payment, and confirm the receiver can call the unlock flow and recover the AES key.
- Create a legacy V3 or V4 message and verify the version selector can still access the historical deployment.

## Roadmap
- Reinstate automated contract and frontend tests tailored to the current escrow design.
- Add analytics for unlock success/failure to catch regression quickly.
- Expand message condition types (e.g., allowlist gating) once the payment/time flows are battle-tested.

