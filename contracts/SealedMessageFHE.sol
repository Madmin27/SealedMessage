// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SealedMessageFHE - FHE-encrypted time-locked messaging on Zama FHEVM
/// @notice Uses Zama FHEVM v0.11 for fully homomorphic encryption of on-chain data.
///         Messages are stored on IPFS with AES-256-GCM encryption. The IPFS CIDs
///         are stored in plaintext (on-chain event data), while the unlock time is
///         FHE-encrypted on-chain for metadata privacy about WHEN a message unlocks.
/// @dev V2 contract — works alongside the original SealedMessage (non-FHE) for backward
///      compatibility. Users switch versions via the frontend's VersionSwitcher.
///      Forbidden patterns: NO @fhevm-js/relayer, NO @fhenixprotocol, NO allowForDecryption,
///      NO requestDecryption, NO FHE ops in view/pure.
import {FHE, euint64, ebool, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @notice Inherits ZamaEthereumConfig to auto-configure FHEVM coprocessor addresses
///         for Sepolia (chainId 11155111) via constructor.
contract SealedMessageFHE is ZamaEthereumConfig {
    // ──────────────────────────────────────────────
    // Constants
    // ──────────────────────────────────────────────

    uint8 private constant CONDITION_TIME = 0x01;
    uint8 private constant CONDITION_PAYMENT = 0x02;
    uint16 public constant CONTRACT_VERSION = 2;

    // ──────────────────────────────────────────────
    // Structs
    // ──────────────────────────────────────────────

    /// @notice FHE-encrypted unlock conditions
    struct FHEConditions {
        euint64 encryptedUnlockTime;    // FHE-encrypted unlock timestamp (euint64)
        uint256 requiredPayment;        // Plaintext (amount, doesn't need FHE)
        uint256 paidAmount;             // Plaintext accumulated payment
        uint8 conditionMask;            // Bitmask: TIME=0x01, PAYMENT=0x02
        bool timeUnlocked;              // Set by checkTimeCondition() when block.timestamp >= unlockTime
        bool revoked;
        bool exists;
    }

    /// @notice A single sealed message
    struct FHEMessage {
        address sender;
        address receiver;
        uint256 createdAt;
        FHEConditions conditions;
        string dataCid;                 // Plaintext IPFS CID of message content
        string metadataCid;             // Plaintext IPFS CID of metadata JSON
    }

    /// @notice Financial view returned for non-FHE queries
    struct FinancialView {
        uint256 requiredPayment;
        uint256 paidAmount;
        uint8 conditionMask;
        bool isPaymentMet;
        bool isUnlocked;
        bool exists;
    }

    // ──────────────────────────────────────────────
    // State
    // ──────────────────────────────────────────────

    uint256 public messageCount;
    mapping(uint256 => FHEMessage) private _messages;
    mapping(address => uint256[]) private _sentMessages;
    mapping(address => uint256[]) private _receivedMessages;

    // Reentrancy guard
    uint256 private _status = 1;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    modifier nonReentrant() {
        require(_status != _ENTERED, "Reentrancy");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    // ──────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────

    event MessageStored(
        uint256 indexed messageId,
        address indexed sender,
        address indexed receiver,
        uint8 conditionMask,
        uint256 requiredPayment,
        uint256 createdAt,
        string dataCid,
        string metadataCid
    );
    event MessageRevoked(uint256 indexed messageId, address indexed sender);
    event MessagePaid(uint256 indexed messageId, address indexed payer, uint256 amount, uint256 totalPaid);

    // ──────────────────────────────────────────────
    // Errors
    // ──────────────────────────────────────────────

    error MessageNotFound();
    error NotSender();
    error OnlySenderOrReceiver();

    // ──────────────────────────────────────────────
    // Core Functions
    // ──────────────────────────────────────────────

    /// @notice Send an FHE-encrypted message with time and/or payment unlock conditions.
    /// @param receiver Message recipient address
    /// @param encryptedUnlockTimeHandle FHE-encrypted unlock timestamp handle (externalEuint64)
    /// @param unlockProof Proof from FHEVM SDK encryption (empty for trivial/asEuint64)
    /// @param dataCid IPFS CID of the message content (plaintext)
    /// @param metadataCid IPFS CID of the metadata JSON (plaintext)
    /// @param requiredPayment Amount of native token required to unlock (0 if no payment condition)
    /// @param conditionMask Bitmask: 0x01=TIME, 0x02=PAYMENT, 0x03=BOTH
    function sendMessage(
        address receiver,
        externalEuint64 encryptedUnlockTimeHandle,
        bytes calldata unlockProof,
        string calldata dataCid,
        string calldata metadataCid,
        uint256 requiredPayment,
        uint8 conditionMask
    ) external returns (uint256 messageId) {
        require(receiver != address(0), "Invalid receiver");
        require(receiver != msg.sender, "Self target");
        require(conditionMask & (CONDITION_TIME | CONDITION_PAYMENT) != 0, "Empty mask");
        require(bytes(dataCid).length > 0, "Empty dataCid");

        bool hasTime = (conditionMask & CONDITION_TIME) != 0;
        bool hasPayment = (conditionMask & CONDITION_PAYMENT) != 0;

        // ── Convert encrypted input with Zama proof ──
        euint64 unlockTime;
        if (hasTime) {
            unlockTime = FHE.fromExternal(encryptedUnlockTimeHandle, unlockProof);
        } else {
            unlockTime = FHE.asEuint64(0);
        }
        FHE.allowThis(unlockTime);

        if (!hasPayment) {
            requiredPayment = 0;
        }

        // ── Store the message ──
        messageId = messageCount;
        messageCount += 1;

        FHEMessage storage m = _messages[messageId];
        m.sender = msg.sender;
        m.receiver = receiver;
        m.createdAt = block.timestamp;
        m.conditions.encryptedUnlockTime = unlockTime;
        m.conditions.requiredPayment = requiredPayment;
        m.conditions.paidAmount = 0;
        m.conditions.conditionMask = conditionMask;
        m.conditions.revoked = false;
        m.conditions.exists = true;
        m.dataCid = dataCid;
        m.metadataCid = metadataCid;

        // ── Grant decryption rights via FHE ACL ──
        FHE.allow(unlockTime, msg.sender);
        FHE.allow(unlockTime, receiver);

        _sentMessages[msg.sender].push(messageId);
        _receivedMessages[receiver].push(messageId);

        emit MessageStored(messageId, msg.sender, receiver, conditionMask, requiredPayment, block.timestamp, dataCid, metadataCid);
    }

    /// @notice Pay to unlock a message (when PAYMENT condition is set).
    ///         Anyone can pay on behalf of the receiver. Overpayment is refunded.
    function payToUnlock(uint256 messageId) external payable nonReentrant {
        FHEMessage storage m = _messages[messageId];
        if (!m.conditions.exists) revert MessageNotFound();
        require((m.conditions.conditionMask & CONDITION_PAYMENT) != 0, "No payment condition");
        require(!m.conditions.revoked, "Revoked");
        require(msg.value > 0, "No payment");
        require(m.conditions.paidAmount < m.conditions.requiredPayment, "Already paid");

        uint256 remaining = m.conditions.requiredPayment - m.conditions.paidAmount;
        uint256 contribution = msg.value;

        if (contribution > remaining) {
            uint256 refund = contribution - remaining;
            contribution = remaining;
            (bool refundOk, ) = msg.sender.call{value: refund}("");
            require(refundOk, "Refund failed");
        }

        m.conditions.paidAmount += contribution;

        (bool success, ) = m.sender.call{value: contribution}("");
        require(success, "Payment forward failed");

        emit MessagePaid(messageId, msg.sender, contribution, m.conditions.paidAmount);
    }

    /// @notice Revoke a message (sender only). Revoked messages cannot be paid or decrypted.
    function revokeMessage(uint256 messageId) external {
        FHEMessage storage m = _messages[messageId];
        if (!m.conditions.exists) revert MessageNotFound();
        if (m.sender != msg.sender) revert NotSender();
        require(!m.conditions.revoked, "Already revoked");

        m.conditions.revoked = true;
        emit MessageRevoked(messageId, msg.sender);
    }

    /// @notice Make a message's encrypted unlock time publicly decryptable so the FHEVM
    ///         oracle can decrypt it and call back into this contract.
    ///         Anyone can trigger this — the oracle verifies the KMS signatures.
    /// @param messageId Message to check
    function checkTimeCondition(uint256 messageId) external {
        FHEMessage storage m = _messages[messageId];
        if (!m.conditions.exists) revert MessageNotFound();
        if (m.conditions.revoked) revert("Revoked");
        require((m.conditions.conditionMask & CONDITION_TIME) != 0, "No time condition");
        if (m.conditions.timeUnlocked) return; // already checked

        // Mark the handle as publicly decryptable so the oracle can decrypt it
        FHE.makePubliclyDecryptable(m.conditions.encryptedUnlockTime);
    }

    /// @notice Callback for the FHEVM public decryption oracle.
    ///         The oracle calls this with KMS-signed proof after handling
    ///         the makePubliclyDecryptable request. We verify signatures
    ///         and, if the time has come, unlock the message.
    /// @param messageId Message to unlock
    /// @param handlesList Array with a single handle (the encryptedUnlockTime)
    /// @param abiEncodedCleartexts ABI-encoded decrypted values
    /// @param decryptionProof KMS signatures proof
    function receiveDecryption(
        uint256 messageId,
        bytes32[] calldata handlesList,
        bytes calldata abiEncodedCleartexts,
        bytes calldata decryptionProof
    ) external {
        FHEMessage storage m = _messages[messageId];
        if (!m.conditions.exists) revert MessageNotFound();
        if (m.conditions.revoked) revert("Revoked");
        require((m.conditions.conditionMask & CONDITION_TIME) != 0, "No time condition");
        if (m.conditions.timeUnlocked) return;

        // Verify the handle matches
        bytes32 expectedHandle;
        assembly {
            expectedHandle := sload(add(m.slot, 2))
        }
        require(handlesList.length == 1 && handlesList[0] == expectedHandle, "Handle mismatch");

        // Verify KMS signatures (reverts on invalid)
        FHE.checkSignatures(handlesList, abiEncodedCleartexts, decryptionProof);

        // Decode the decrypted unlock time
        uint256 unlockTime = abi.decode(abiEncodedCleartexts, (uint256));

        require(block.timestamp >= unlockTime, "Still locked");
        m.conditions.timeUnlocked = true;
    }

    // ──────────────────────────────────────────────
    // View / Pure Getters
    // ──────────────────────────────────────────────

    /// @notice Get financial view of a message (plaintext — no FHE operations in view functions).
    function getMessageFinancialView(uint256 messageId) external view returns (FinancialView memory) {
        FHEMessage storage m = _messages[messageId];
        if (!m.conditions.exists) revert MessageNotFound();

        bool hasTime = (m.conditions.conditionMask & CONDITION_TIME) != 0;
        bool hasPayment = (m.conditions.conditionMask & CONDITION_PAYMENT) != 0;
        bool paymentMet = m.conditions.paidAmount >= m.conditions.requiredPayment;
        bool timeMet = !hasTime || m.conditions.timeUnlocked;
        bool paymentPass = !hasPayment || paymentMet;

        return FinancialView({
            requiredPayment: m.conditions.requiredPayment,
            paidAmount: m.conditions.paidAmount,
            conditionMask: m.conditions.conditionMask,
            isPaymentMet: paymentMet,
            isUnlocked: timeMet && paymentPass,
            exists: true
        });
    }

    /// @notice Get message sender, receiver, and IPFS CIDs (plaintext).
    function getMessageParties(uint256 messageId) external view returns (address sender, address receiver, bool exists, string memory dataCid, string memory metadataCid) {
        FHEMessage storage m = _messages[messageId];
        if (!m.conditions.exists) revert MessageNotFound();
        return (m.sender, m.receiver, true, m.dataCid, m.metadataCid);
    }

    /// @notice Get list of sent message IDs for a user.
    function getSentMessages(address user) external view returns (uint256[] memory) {
        return _sentMessages[user];
    }

    /// @notice Get list of received message IDs for a user.
    function getReceivedMessages(address user) external view returns (uint256[] memory) {
        return _receivedMessages[user];
    }

    /// @notice Check if a message exists and is not revoked.
    function messageExists(uint256 messageId) external view returns (bool exists, bool revoked) {
        FHEMessage storage m = _messages[messageId];
        exists = m.conditions.exists;
        revoked = m.conditions.revoked;
    }

    /// @notice Get the FHE-encrypted unlock time handle for decryption via relayer SDK.
    ///         Only users authorized via the FHE ACL (sender/receiver) can decrypt it.
    function getEncryptedUnlockTimeHandle(uint256 messageId) external view returns (bytes32 handle) {
        FHEMessage storage m = _messages[messageId];
        if (!m.conditions.exists) revert MessageNotFound();
        assembly {
            // Storage layout (0-indexed slots from m.slot):
            //   0: sender + receiver (2 addresses packed)
            //   1: createdAt (uint256)
            //   2: encryptedUnlockTime (euint64 — first field of FHEConditions)
            handle := sload(add(m.slot, 2))
        }
    }
}
