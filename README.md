# SealedMessage

SealedMessage is a privacy-focused messaging dApp for condition-gated private messages on Ethereum Sepolia. Senders encrypt payloads locally, pin only encrypted envelopes to IPFS, and store the release policy on-chain. Receivers can decrypt only after the selected time/payment/FHE unlock rule is satisfied.

## Core Features
- **Condition-based unlocks**: Messages support `TimeOnly`, `PaymentOnly`, `TimeAndPayment`, and current V5.2 `TimeOrPayment`.
- **FHE-gated key release**: Zama FHE stores encrypted AES key parts and grants receiver access only after unlock.
- **Wallet-native UX**: The Next.js frontend uses wagmi/viem and RainbowKit for MetaMask and other EVM wallets.
- **IPFS storage**: Payloads, private metadata, and attachments are pinned as encrypted envelopes only.
- **Versioned compatibility**: Legacy V3/V4/V5/V5.1 deployments remain readable while new secure messages target the current deployment.
- **Sepolia-first operation**: Sepolia is the default network and the production frontend runs behind Nginx on port `3005`.

## Architecture
- **Smart contracts**: `contracts/SealedMessageFHE_v52.sol` is the current secure FHE contract. Legacy contracts remain in the repo for historical reads.
- **Frontend**: Next.js 14 + TypeScript app under `frontend/` that renders message feeds, handles uploads, and coordinates unlock transactions.
- **APIs**: Edge routes in `frontend/app/api/**` proxy IPFS interactions, manage metadata caching, and prepare unlock payloads.
- **Tooling**: Hardhat scripts in `scripts/` manage Sepolia deployments, live-flow checks, and operational maintenance.

## Current Sepolia Deployments
- **Current V5.2-FHE contract**: `0x3D40Bf66f1EDC0A6ff11808FfE1074A7b079d65A`
- **V5.1-FHE contract**: `0x604218f74c1bE61cf6042C4624B2e1de6907AA40`
- **Legacy V5-FHE contract**: `0x1cf58133fd8b0961474BaD1AC8FFE357C7877a15`
- **Validated relayer endpoint**: `https://relayer.testnet.zama.org/v2`
- **Live validation notes**: `docs/fhe-v51-live-validation.md`

V5.2 is current for new secure messages because it adds explicit OR unlock support while preserving the V5.1 security invariant: only the receiver can receive FHE access to key parts after the on-chain conditions are met.

## Security & Privacy
- **End-to-end encryption**: The current secure flow seals payloads and metadata with AES-256-GCM before uploading ciphertext envelopes to IPFS.
- **Ephemeral session keys**: Fresh random seeds per message minimize the blast radius of any key compromise.
- **Integrity commitments**: On-chain payload and metadata hashes protect against tampering.
- **Access control**: In the secure FHE flow, Zama ACL gates the AES key parts and the receiver decrypts them with `userDecrypt` only after conditions pass.
- **Versioned deployments**: The frontend can target legacy V3, legacy V4-FHE, legacy V5-FHE, V5.1-FHE, and the current V5.2-FHE deployment through a registry-backed version selector.
- **Preview model**: The secure V5 path keeps payload and private metadata encrypted end-to-end; only optional preview text or preview media should be exposed publicly.
- **Key hygiene**: Sensitive configuration stays in `.env` files; keys are never committed to the repository.
- **Server-only secrets**: Pinning credentials must stay server-side as `PINATA_JWT` or `PINATA_API_KEY`/`PINATA_SECRET_KEY`; do not expose them through `NEXT_PUBLIC_*` variables.
- **Relayer note**: Older Zama docs may mention `relayer.testnet.zama.cloud`, but this project currently uses `https://relayer.testnet.zama.org/v2` because the live Sepolia V5.1 flow was validated with it.

Never introduce `FHE.makePubliclyDecryptable`, `FHE.allow(sender)`, or `FHE.allow(msg.sender)` in the secure message flow. Key access must be granted to the receiver only after unlock.

## Getting Started
1. Install dependencies in both root and frontend workspaces:
	```bash
	npm install
	cd frontend && npm install
	```
2. Copy `.env.example` to `.env` (root) and populate network RPC URLs, deployer keys, and storage settings.
3. Create `frontend/.env.local` with public RPC endpoints and deployment addresses. Keep pinning credentials server-side only, and do not put private keys in frontend env files.
4. Start the development stack:
	```bash
	npm run dev   # Hardhat local node if configured
	cd frontend && npm run dev
	```

### Required frontend deployment vars
- `NEXT_PUBLIC_FHE_SECURE_CONTRACT_ADDRESS_SEPOLIA` -> legacy V5-FHE deployment
- `NEXT_PUBLIC_FHE_SECURE_V51_CONTRACT_ADDRESS_SEPOLIA` -> V5.1-FHE deployment (`0x604218f74c1bE61cf6042C4624B2e1de6907AA40`)
- `NEXT_PUBLIC_FHE_SECURE_V52_CONTRACT_ADDRESS_SEPOLIA` -> current V5.2-FHE deployment (`0x3D40Bf66f1EDC0A6ff11808FfE1074A7b079d65A`)
- `NEXT_PUBLIC_ZAMA_RELAYER_URL` -> `https://relayer.testnet.zama.org/v2`

## Deployment & Operations
- **Contract deployment**: Deploy Sepolia contracts with the Hardhat scripts, then register addresses in the frontend env for `NEXT_PUBLIC_CONTRACT_ADDRESS_SEPOLIA` (legacy V3), `NEXT_PUBLIC_FHE_CONTRACT_ADDRESS_ZAMA` (legacy V4-FHE), `NEXT_PUBLIC_FHE_SECURE_CONTRACT_ADDRESS_SEPOLIA` (legacy V5-FHE), `NEXT_PUBLIC_FHE_SECURE_V51_CONTRACT_ADDRESS_SEPOLIA` (V5.1-FHE), and `NEXT_PUBLIC_FHE_SECURE_V52_CONTRACT_ADDRESS_SEPOLIA` (current V5.2-FHE).
- **Metadata management**: CLI helpers in `scripts/` (e.g., `encrypt-and-store.ts`, `inspectMessages.js`) assist with content uploads and troubleshooting.
- **IPFS gateway**: The Next.js API routes under `frontend/app/api/ipfs/**` proxy Pinata access and expect `PINATA_JWT` or `PINATA_API_KEY`/`PINATA_SECRET_KEY` on the server.
- **Frontend release**: After frontend changes, clear `.next` and `node_modules/.cache`, run `npm run build`, restart `sealed.service`, and smoke-test `http://127.0.0.1:3005` plus the Nginx host.
- **Live-flow validation**: Use the live-flow scripts to verify Sepolia end-to-end before promoting contract or relayer changes.

## Testing & Monitoring
Automated test suites are still incomplete, so rely on targeted QA flows:
- Create a V5.2 secure message, verify the payload/metadata CIDs resolve only to encrypted envelopes, then satisfy the configured conditions and decrypt with the receiver wallet.
- Create a payment-locked message, complete the payment, and confirm the receiver can call the unlock flow and recover the AES key.
- Create TimeOnly, PaymentOnly, TimeAndPayment, and TimeOrPayment messages and verify the expected unlock behavior.
- Create a legacy V3 or V4 message and verify the version selector can still access the historical deployment.
- Run `ENABLE_FHEVM=true npx hardhat run scripts/test-fhe-v51-live-flow.ts --network sepolia` after relayer or deployment changes.

## Roadmap
- Reinstate automated contract and frontend tests tailored to the current escrow design.
- Add analytics for unlock success/failure to catch regression quickly.
- Expand message condition types (e.g., allowlist gating) once the payment/time flows are battle-tested.
