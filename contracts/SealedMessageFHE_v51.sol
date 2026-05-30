// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title SealedMessageFHE_v51
/// @notice V5.1 — hardened FHE-sealed message contract.
/// @dev Security improvements over V5:
///      - getKeyHandles(): only receiver + unlocked
///      - unlockMessage(): FHE.allow only to receiver (no public decrypt)
///      - payToUnlock(): pull-payment via pendingWithdrawals
///      - UnlockCondition enum replaces uint8 conditionMode (OR mode removed)
///      - No key material in events
///      - CONTRACT_VERSION = 51, CONTRACT_VERSION_STRING = "5.1.0"
contract SealedMessageFHE_v51 is ZamaEthereumConfig {
    uint256 public constant CONTRACT_VERSION = 51;
    string public constant CONTRACT_VERSION_STRING = "5.1.0";

    error MessageNotFound();
    error NotSender();
    error RevokedMessage();
    error MessageAlreadyUnlocked();
    error ConditionsNotMet();

    enum UnlockCondition { TimeOnly, PaymentOnly, TimeAndPayment }

    struct Message {
        address sender;
        address receiver;
        uint64 createdAt;
        uint64 unlockTime;
        uint256 requiredPayment;
        UnlockCondition condition;
        bool paid;
        bool revoked;
        bool unlocked;
        bytes32 payloadHash;
        bytes32 metadataHash;
        bytes32 keyHandle0;
        bytes32 keyHandle1;
        bytes32 keyHandle2;
        bytes32 keyHandle3;
        euint64 key0;
        euint64 key1;
        euint64 key2;
        euint64 key3;
        string payloadCid;
        string metadataCid;
        string previewCid;
        string previewText;
    }

    struct MessageSummary {
        address sender;
        address receiver;
        uint64 createdAt;
        uint64 unlockTime;
        UnlockCondition condition;
        string payloadCid;
        string metadataCid;
        string previewCid;
        string previewText;
        bytes32 payloadHash;
        bytes32 metadataHash;
        bool paid;
        bool revoked;
        bool unlocked;
    }

    struct MessageAccess {
        uint256 requiredPayment;
        UnlockCondition condition;
        bool paid;
        bool isTimeMet;
        bool isReadyToUnlock;
        bool isUnlocked;
        bool isRevoked;
    }

    uint256 public messageCount;
    mapping(uint256 => Message) private _messages;
    mapping(address => uint256[]) private _sentMessages;
    mapping(address => uint256[]) private _receivedMessages;
    mapping(address => uint256) public pendingWithdrawals;

    uint256 private _status = 1;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    modifier nonReentrant() {
        require(_status != _ENTERED, "Reentrancy");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    event MessageStored(uint256 indexed messageId, address indexed sender, address indexed receiver);
    event MessageUnlocked(uint256 indexed messageId, address indexed receiver);
    event MessageRevoked(uint256 indexed messageId, address indexed sender);
    event MessagePaid(uint256 indexed messageId, address indexed payer, uint256 amount);

    /// @notice Create a new sealed message with FHE-encrypted AES key parts.
    /// @param receiver Address that will be able to decrypt after conditions are met.
    /// @param unlockTime Timestamp for time-based release (0 if TimeOnly/TimeAndPayment not used).
    /// @param requiredPayment ETH amount for payment-based release (0 if PaymentOnly/TimeAndPayment not used).
    /// @param condition UnlockCondition enum: TimeOnly, PaymentOnly, or TimeAndPayment.
    /// @param payloadCid IPFS CID of the encrypted payload envelope.
    /// @param metadataCid IPFS CID of the encrypted metadata envelope.
    /// @param previewCid IPFS CID of the public preview JSON (PublicPreviewData).
    /// @param previewText Plaintext short preview hint shown before unlock.
    /// @param payloadHash keccak256 of the encrypted payload (for integrity check).
    /// @param metadataHash keccak256 of the encrypted metadata.
    /// @param key0Handle First externalEuint64 key part handle.
    /// @param key1Handle Second externalEuint64 key part handle.
    /// @param key2Handle Third externalEuint64 key part handle.
    /// @param key3Handle Fourth externalEuint64 key part handle.
    /// @param keyInputProof Zama FHE proof for the external key handles.
    /// @return messageId The assigned message ID.
    function sendMessage(
        address receiver,
        uint64 unlockTime,
        uint256 requiredPayment,
        UnlockCondition condition,
        string calldata payloadCid,
        string calldata metadataCid,
        string calldata previewCid,
        string calldata previewText,
        bytes32 payloadHash,
        bytes32 metadataHash,
        externalEuint64 key0Handle,
        externalEuint64 key1Handle,
        externalEuint64 key2Handle,
        externalEuint64 key3Handle,
        bytes calldata keyInputProof
    ) external returns (uint256 messageId) {
        require(receiver != address(0), "Invalid receiver");
        require(receiver != msg.sender, "Self target");
        require(bytes(payloadCid).length > 0, "Empty payloadCid");
        require(bytes(metadataCid).length > 0, "Empty metadataCid");
        require(keyInputProof.length > 0, "Empty key proof");

        bool hasTimeCondition = condition == UnlockCondition.TimeOnly || condition == UnlockCondition.TimeAndPayment;
        bool hasPaymentCondition = condition == UnlockCondition.PaymentOnly || condition == UnlockCondition.TimeAndPayment;

        if (hasTimeCondition) {
            require(unlockTime > block.timestamp, "Unlock time must be future");
        }
        if (hasPaymentCondition) {
            require(requiredPayment > 0, "Payment condition requires amount > 0");
        }
        require(hasTimeCondition || hasPaymentCondition, "No condition set");

        euint64 key0 = FHE.fromExternal(key0Handle, keyInputProof);
        euint64 key1 = FHE.fromExternal(key1Handle, keyInputProof);
        euint64 key2 = FHE.fromExternal(key2Handle, keyInputProof);
        euint64 key3 = FHE.fromExternal(key3Handle, keyInputProof);

        FHE.allowThis(key0);
        FHE.allowThis(key1);
        FHE.allowThis(key2);
        FHE.allowThis(key3);

        messageId = messageCount;
        messageCount += 1;

        Message storage m = _messages[messageId];
        m.sender = msg.sender;
        m.receiver = receiver;
        m.createdAt = uint64(block.timestamp);
        m.unlockTime = unlockTime;
        m.requiredPayment = requiredPayment;
        m.condition = condition;
        m.paid = false;
        m.revoked = false;
        m.unlocked = false;
        m.payloadHash = payloadHash;
        m.metadataHash = metadataHash;
        m.keyHandle0 = externalEuint64.unwrap(key0Handle);
        m.keyHandle1 = externalEuint64.unwrap(key1Handle);
        m.keyHandle2 = externalEuint64.unwrap(key2Handle);
        m.keyHandle3 = externalEuint64.unwrap(key3Handle);
        m.key0 = key0;
        m.key1 = key1;
        m.key2 = key2;
        m.key3 = key3;
        m.payloadCid = payloadCid;
        m.metadataCid = metadataCid;
        m.previewCid = previewCid;
        m.previewText = previewText;

        _sentMessages[msg.sender].push(messageId);
        _receivedMessages[receiver].push(messageId);

        emit MessageStored(messageId, msg.sender, receiver);
    }

    /// @notice Pay the required amount to unlock a payment-condition message.
    ///         Uses pull-payment: ETH accumulates in pendingWithdrawals for the sender.
    /// @param messageId The ID of the message to pay for.
    function payToUnlock(uint256 messageId) external payable nonReentrant {
        Message storage m = _messages[messageId];
        if (m.sender == address(0)) revert MessageNotFound();
        if (m.revoked) revert RevokedMessage();
        require(m.condition != UnlockCondition.TimeOnly, "No payment condition");
        require(msg.value > 0, "No payment");
        require(!m.paid, "Already paid");
        require(msg.value >= m.requiredPayment, "Insufficient payment");

        if (msg.value > m.requiredPayment) {
            uint256 refund = msg.value - m.requiredPayment;
            (bool refundOk, ) = msg.sender.call{value: refund}("");
            require(refundOk, "Refund failed");
        }

        m.paid = true;
        pendingWithdrawals[m.sender] += m.requiredPayment;

        emit MessagePaid(messageId, msg.sender, m.requiredPayment);
    }

    /// @notice Withdraw accumulated payments (pull-payment pattern).
    function withdrawPayments() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing to withdraw");
        pendingWithdrawals[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Withdraw failed");
    }

    /// @notice Unlock a message, granting the receiver FHE decrypt access.
    ///         FHE.allow is called ONLY for the receiver — no public decrypt, no sender access.
    /// @param messageId The ID of the message to unlock.
    function unlockMessage(uint256 messageId) external {
        Message storage m = _messages[messageId];
        if (m.sender == address(0)) revert MessageNotFound();
        if (m.revoked) revert RevokedMessage();
        if (m.unlocked) revert MessageAlreadyUnlocked();
        if (!_conditionsMet(m)) revert ConditionsNotMet();

        m.unlocked = true;

        // Grant FHE decrypt access only to the receiver.
        // No FHE.makePubliclyDecryptable, no FHE.allow(sender), no FHE.allow(msg.sender).
        FHE.allow(m.key0, m.receiver);
        FHE.allow(m.key1, m.receiver);
        FHE.allow(m.key2, m.receiver);
        FHE.allow(m.key3, m.receiver);

        emit MessageUnlocked(messageId, m.receiver);
    }

    /// @notice Revoke a message before it is unlocked. Only the sender can revoke.
    /// @param messageId The ID of the message to revoke.
    function revokeMessage(uint256 messageId) external {
        Message storage m = _messages[messageId];
        if (m.sender == address(0)) revert MessageNotFound();
        if (m.sender != msg.sender) revert NotSender();
        if (m.revoked) revert RevokedMessage();
        if (m.unlocked) revert MessageAlreadyUnlocked();

        m.revoked = true;
        emit MessageRevoked(messageId, msg.sender);
    }

    /// @notice Get a human-readable summary of a message (no key material).
    function getMessageSummary(uint256 messageId) external view returns (MessageSummary memory) {
        Message storage m = _messages[messageId];
        if (m.sender == address(0)) revert MessageNotFound();

        return MessageSummary({
            sender: m.sender,
            receiver: m.receiver,
            createdAt: m.createdAt,
            unlockTime: m.unlockTime,
            condition: m.condition,
            payloadCid: m.payloadCid,
            metadataCid: m.metadataCid,
            previewCid: m.previewCid,
            previewText: m.previewText,
            payloadHash: m.payloadHash,
            metadataHash: m.metadataHash,
            paid: m.paid,
            revoked: m.revoked,
            unlocked: m.unlocked
        });
    }

    /// @notice Get access status of a message (condition evaluation, no key material).
    function getMessageAccess(uint256 messageId) external view returns (MessageAccess memory) {
        Message storage m = _messages[messageId];
        if (m.sender == address(0)) revert MessageNotFound();

        return MessageAccess({
            requiredPayment: m.requiredPayment,
            condition: m.condition,
            paid: m.paid,
            isTimeMet: _isTimeMet(m),
            isReadyToUnlock: _conditionsMet(m),
            isUnlocked: m.unlocked,
            isRevoked: m.revoked
        });
    }

    /// @notice Get the 4 key handles for FHE userDecrypt.
    /// @dev Restricted: only the receiver can call, and only after the message is unlocked.
    /// @param messageId The ID of the message.
    /// @return key0 The first bytes32 key handle.
    /// @return key1 The second bytes32 key handle.
    /// @return key2 The third bytes32 key handle.
    /// @return key3 The fourth bytes32 key handle.
    function getKeyHandles(uint256 messageId) external view returns (bytes32 key0, bytes32 key1, bytes32 key2, bytes32 key3) {
        Message storage m = _messages[messageId];
        if (m.sender == address(0)) revert MessageNotFound();
        require(msg.sender == m.receiver, "Only receiver");
        require(m.unlocked, "Message locked");

        return (m.keyHandle0, m.keyHandle1, m.keyHandle2, m.keyHandle3);
    }

    /// @notice Get list of message IDs sent by a user.
    function getSentMessages(address user) external view returns (uint256[] memory) {
        return _sentMessages[user];
    }

    /// @notice Get list of message IDs received by a user.
    function getReceivedMessages(address user) external view returns (uint256[] memory) {
        return _receivedMessages[user];
    }

    /// @notice Check if a message exists and its status.
    function messageExists(uint256 messageId) external view returns (bool exists, bool revoked, bool unlocked) {
        Message storage m = _messages[messageId];
        exists = m.sender != address(0);
        revoked = m.revoked;
        unlocked = m.unlocked;
    }

    /// @dev Evaluate whether all conditions for unlocking are met.
    ///      No OR mode — each UnlockCondition has a single deterministic path.
    function _conditionsMet(Message storage m) private view returns (bool) {
        if (m.condition == UnlockCondition.TimeOnly) {
            return block.timestamp >= m.unlockTime;
        } else if (m.condition == UnlockCondition.PaymentOnly) {
            return m.paid;
        } else if (m.condition == UnlockCondition.TimeAndPayment) {
            return block.timestamp >= m.unlockTime && m.paid;
        }
        return false;
    }

    /// @dev Returns true if either no time condition, or time condition is satisfied.
    function _isTimeMet(Message storage m) private view returns (bool) {
        if (m.condition == UnlockCondition.TimeOnly || m.condition == UnlockCondition.TimeAndPayment) {
            return block.timestamp >= m.unlockTime;
        }
        return true;
    }
}
