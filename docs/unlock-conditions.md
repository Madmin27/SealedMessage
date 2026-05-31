# Unlock Conditions

SealedMessage lets a sender seal a private message until one or more unlock conditions are satisfied on-chain. The encrypted payload, private metadata, and attachments stay encrypted on IPFS. The receiver can decrypt only after the contract marks the message as ready and releases receiver access to the FHE-protected key parts.

## Roles

### Sender

- Chooses the receiver address.
- Chooses the unlock condition: time, payment, time plus payment, or time or payment.
- May revoke an unopened message before payment has been received or before it has been unlocked.
- Receives payment into `pendingWithdrawals(sender)` when a receiver pays for a payment-gated message.
- Uses the pending earnings panel to call `withdrawPayments()` and pull accumulated ETH from the contract.

### Receiver

- Can see public preview information only.
- Pays the required ETH if the message has an active payment condition.
- Can call unlock once the selected condition is satisfied.
- Can decrypt the payload locally only after the contract releases receiver FHE access.

## Condition Types

### Time Only

The message can be unlocked when the configured unlock time has passed.

Rule: `block.timestamp >= unlockTime`

### Payment Only

The message can be unlocked after the receiver pays the required amount.

Rule: `paid == true`

Payment condition requires `requiredPayment > 0`.

### Time AND Payment

Both conditions must be satisfied. The receiver must pay, and the unlock time must have passed.

Rule: `timeOk && paid`

### Time OR Payment

Either condition can unlock the message. The receiver can unlock after the time passes, or unlock earlier by paying the required amount.

Rule: `timeOk || paid`

This is supported by V5.2 FHE.

## Payment Flow

1. Sender creates a payment-gated message.
2. Receiver pays the required ETH by calling `payToUnlock(messageId)`.
3. The contract stores the payment under `pendingWithdrawals(sender)`.
4. Sender withdraws accumulated ETH by calling `withdrawPayments()`.

Payments are pull-based. ETH is not sent directly to the sender during the receiver payment transaction.

## Revoke Rules

Revoke is a sender-side cancellation action for messages that have not been opened yet. In the frontend, revoke is hidden once payment has been received, because the sender already has pending earnings for that message.

Unlocked messages cannot be revoked.

## Privacy Rules

- Do not store plaintext message data, private metadata, attachments, or AES keys on-chain.
- Do not expose AES keys through logs, local storage, session storage, or events.
- Do not grant public FHE decrypt access.
- FHE key access is granted to the receiver only after unlock.
