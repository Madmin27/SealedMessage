import * as secp256k1 from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak256 } from 'ethers';
import { aesGcmDecryptBytes, aesGcmDecryptMessage } from './encryption';
import { getOrCreateEncryptionKey } from './keyAgreement';

export type DecryptRole = 'receiver' | 'sender';

export interface DecryptOptions {
  role?: DecryptRole;
  peerPublicKey?: Uint8Array;
  fallbackPrivateKey?: Uint8Array;
}

export interface ReceiverEnvelopeChunks {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  authTag: Uint8Array;
}

export interface DecryptMessageParams {
  ciphertext: Uint8Array;
  authTag: Uint8Array;
  iv: Uint8Array;
  senderPublicKey: Uint8Array;
  receiverEnvelope: ReceiverEnvelopeChunks;
  sessionKeyCommitment?: string;
  walletClient: any;
  userAddress: string;
  options?: DecryptOptions;
}

/**
 * Decrypt AES-256-GCM encrypted message using ECDH shared secret
 * 
 * @param combinedData - Combined encrypted data (ciphertext + authTag, last 16 bytes is authTag)
 * @param iv - Initialization vector (12 bytes)
 * @param senderPublicKey - Sender's compressed public key (33 bytes)
 * @param walletClient - Wallet client for signature
 * @param userAddress - User's address for keypair derivation
 */
export interface DecryptMessageResult {
  plaintext: string;
  sessionKey: Uint8Array;
}

export async function decryptMessage(params: DecryptMessageParams): Promise<DecryptMessageResult> {
  try {
    const {
      ciphertext,
      authTag,
      iv,
      senderPublicKey,
      receiverEnvelope,
      sessionKeyCommitment,
      walletClient,
      userAddress,
      options
    } = params;

    console.log('🔐 Starting envelope-assisted decryption...');
    console.log('📊 Input lengths:', {
      ciphertext: ciphertext.length,
      authTag: authTag.length,
      iv: iv.length,
      senderPubKey: senderPublicKey.length,
      envelopeCipher: receiverEnvelope.ciphertext.length
    });

    // Step 1: Get receiver's encryption keypair (derived from wallet signature)
    const receiverKeyPair = await getOrCreateEncryptionKey(walletClient, userAddress);
    console.log('✅ Receiver keypair derived from wallet');
    console.log('📍 Receiver public key:', Array.from(receiverKeyPair.publicKey).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 20) + '...');
    console.log('📍 Sender public key:', Array.from(senderPublicKey).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 20) + '...');

    // Step 2: Compute ECDH shared secret
    const role: DecryptRole = options?.role ?? 'receiver';
    const peerPublicKey = role === 'sender'
      ? (() => {
          if (!options?.peerPublicKey || options.peerPublicKey.length === 0) {
            throw new Error('Receiver public key required for sender-side decrypt');
          }
          return options.peerPublicKey;
        })()
      : senderPublicKey;

    const receiverPrivateCandidates: { label: string; privateKey: Uint8Array }[] = [
      { label: 'derived-signature', privateKey: receiverKeyPair.privateKey }
    ];

    if (options?.fallbackPrivateKey && options.fallbackPrivateKey.length === 32) {
      const fallbackCandidate = options.fallbackPrivateKey.byteOffset === 0 && options.fallbackPrivateKey.byteLength === options.fallbackPrivateKey.buffer.byteLength
        ? options.fallbackPrivateKey
        : options.fallbackPrivateKey.slice();

      const isDuplicate = receiverPrivateCandidates.some((candidate) =>
        candidate.privateKey.length === fallbackCandidate.length &&
        candidate.privateKey.every((value, index) => value === fallbackCandidate[index])
      );

      if (!isDuplicate) {
        receiverPrivateCandidates.push({ label: 'fallback-derived', privateKey: fallbackCandidate });
      }
    }

    let lastError: unknown = null;
    const normalizedCommitment = sessionKeyCommitment?.toLowerCase();

    for (const receiverCandidate of receiverPrivateCandidates) {
      try {
        const sharedSecret = secp256k1.getSharedSecret(
          receiverCandidate.privateKey,
          peerPublicKey,
          true // compressed
        );

        console.log('✅ ECDH shared secret computed');
        console.log('📍 Shared secret candidate:', receiverCandidate.label);
        console.log('📍 Shared secret (first 20 bytes):', Array.from(sharedSecret.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(''));

        const sharedSecretSlice = sharedSecret.slice(1); // drop prefix byte

        const candidateKeys: { label: string; key: Uint8Array }[] = [
          { label: `${receiverCandidate.label}-slice-1-33`, key: sharedSecretSlice.slice(0, 32) },
          { label: `${receiverCandidate.label}-sha256-slice`, key: new Uint8Array(sha256(sharedSecretSlice)) },
          { label: `${receiverCandidate.label}-sha256-full`, key: new Uint8Array(sha256(sharedSecret)) },
          { label: `${receiverCandidate.label}-slice-0-32`, key: sharedSecret.slice(0, 32) }
        ];

        for (const candidate of candidateKeys) {
          if (candidate.key.length !== 32) {
            continue;
          }

          try {
            console.log(`🔑 Trying envelope AES key candidate: ${candidate.label}`);

            const sessionKeyBytes = await aesGcmDecryptBytes(
              receiverEnvelope.ciphertext,
              receiverEnvelope.authTag,
              receiverEnvelope.iv,
              candidate.key
            );

            if (sessionKeyBytes.length !== 32) {
              console.warn('⚠️ Session key length unexpected', sessionKeyBytes.length);
              continue;
            }

            if (normalizedCommitment) {
              const commitment = keccak256(sessionKeyBytes).toLowerCase();
              console.log('🔎 Session key commitment check:', {
                expected: normalizedCommitment,
                computed: commitment
              });
              if (commitment !== normalizedCommitment) {
                console.warn(`⚠️ Session key commitment mismatch for candidate ${candidate.label}`);
                continue;
              }
            }

            const plaintext = await aesGcmDecryptMessage(ciphertext, authTag, iv, sessionKeyBytes);
            console.log(`✅ Message decrypted with session key (candidate: ${candidate.label})`);
            console.log('✅ Plaintext (preview):', plaintext.slice(0, 80) + (plaintext.length > 80 ? '...' : ''));
            return { plaintext, sessionKey: sessionKeyBytes };
          } catch (candidateErr) {
            lastError = candidateErr;
            continue;
          }
        }
      } catch (sharedSecretErr) {
        lastError = sharedSecretErr;
        console.warn(`⚠️ Shared secret derivation failed for candidate ${receiverCandidate.label}`, sharedSecretErr);
      }
    }

    if (lastError) {
  throw lastError;
    }

    throw new Error('All AES key candidates failed');

  } catch (err: any) {
    console.error('❌ Decryption failed at stage:', err);
    console.warn('Full error:', err);
    throw new Error(`Decryption failed: ${err.message}`);
  }
}
