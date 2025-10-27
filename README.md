# SealedMessage

SealedMessage is a privacy-focused messaging dApp that allows creators to lock their content behind time and payment conditions on Ethereum Sepolia. Senders encrypt payloads locally, publish the ciphertext to IPFS, and attach the commitment to an on-chain escrow contract. Receivers unlock the message once the smart contract verifies that the configured release condition is met.

https://sealed.minen.com.tr/

https://youtu.be/MdFKtYHHOCI

## Core Features
- **Conditional unlocking**: Messages can require a completed payment, a future timestamp, or both before decryption is permitted.
- **Wallet-native UX**: The Next.js frontend integrates with wagmi/viem so users interact with MetaMask and other EVM wallets without custom extensions.
- **IPFS storage**: Encrypted blobs and metadata are pinned off-chain, keeping the on-chain footprint lean.
- **Resilient UI flows**: Optimistic updates and metadata refresh keep the message list in sync after unlock and payment events.

## Architecture
- **Smart contracts**: `contracts/SealedMessage.sol` holds message commitments, escrow balances, and release condition checks.
- **Frontend**: Next.js 14 + TypeScript app under `frontend/` that renders message feeds, handles uploads, and coordinates unlock transactions.
- **APIs**: Edge routes in `frontend/app/api/**` proxy IPFS interactions, manage metadata caching, and prepare unlock payloads.
- **Tooling**: Hardhat scripts in `scripts/` manage deployments and operational maintenance (legacy Zama FHE tooling has been removed).

## Security & Privacy
- **End-to-end encryption**: Clients derive a shared key via ECDH, seal message bodies with AES-256-GCM, and store only ciphertext off-chain.
- **Ephemeral session keys**: Fresh random seeds per message minimize the blast radius of any key compromise.
- **Commit-reveal pattern**: On-chain commitments prevent tampering and double spending when conditions are enforced.
- **Access control**: Unlock API validates wallet ownership and settlement before disclosing decryption material.
- **Key hygiene**: Sensitive configuration stays in `.env` files; keys are never committed to the repository.
- **Dependability**: FHE/Zama dependencies were removed to reduce attack surface and simplify audits.

## Getting Started
1. Install dependencies in both root and frontend workspaces:
	```bash
	npm install
	cd frontend && npm install
	```
2. Copy `.env.example` to `.env` (root) and populate network RPC URLs, deployer keys, and storage settings.
3. Copy `frontend/.env.example` to `frontend/.env.local` with client-facing RPC endpoints, IPFS gateway URLs, and wallet connect keys.
4. Start the development stack:
	```bash
	npm run dev   # Hardhat local node if configured
	cd frontend && npm run dev
	```

## Deployment & Operations
- **Contract deployment**: Use `scripts/deploy-sealed-sepolia.ts` to publish the escrow contract on Sepolia. The script outputs the address consumed by the frontend.
- **Metadata management**: CLI helpers in `scripts/` (e.g., `encrypt-and-store.ts`, `inspectMessages.js`) assist with content uploads and troubleshooting.
- **IPFS gateway**: The API routes assume a configured pinning service; update environment variables when switching providers.

## Testing & Monitoring
Automated test suites were decommissioned during the Zama cleanup. Rely on manual QA flows:
- Create a time-locked message, verify the unlock button activates after the target timestamp.
- Create a payment-locked message, complete the payment, and confirm decryption material becomes available.
- Inspect `frontend/.data/` caches to ensure metadata sync jobs produce the expected entries.

## Roadmap
- Reinstate automated contract and frontend tests tailored to the current escrow design.
- Add analytics for unlock success/failure to catch regression quickly.
- Expand message condition types (e.g., allowlist gating) once the payment/time flows are battle-tested.

