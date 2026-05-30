# FHE V5.1 Live Validation

Validated on Sepolia using:

- Contract: `0x604218f74c1bE61cf6042C4624B2e1de6907AA40`
- Relayer: `https://relayer.testnet.zama.org/v2`
- Script: `scripts/test-fhe-v51-live-flow.ts`

Validated flow:

1. Encrypt AES key parts with Zama Relayer SDK.
2. Send FHE message.
3. Pay unlock condition.
4. Unlock message.
5. Receiver calls `getKeyHandles()`.
6. Receiver decrypts 4 key handles with `userDecrypt`.
7. AES key is reconstructed.
8. Payload decrypts successfully.

Negative checks:

- Sender cannot decrypt before unlock.
- Sender cannot decrypt after unlock.
- Third party cannot decrypt before unlock.
- Third party cannot decrypt after unlock.

Relayer note:

Official or older docs may mention `relayer.testnet.zama.cloud`.
This project currently uses `https://relayer.testnet.zama.org/v2` because the live Sepolia V5.1 flow was verified with it.

Conclusion:

V5.1 `getKeyHandles()` output is compatible with `FHE.allow(m.keyN, receiver)` for the current Sepolia deployment.