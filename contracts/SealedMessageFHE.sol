// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title SealedMessageFHE
/// @notice Stores AES-encrypted IPFS payload references while Zama FHE protects the AES key material.
/// @dev Payload and metadata remain encrypted off-chain. This contract only releases key access to the
///      receiver after the configured conditions are satisfied.
contract SealedMessageFHE is ZamaEthereumConfig {
    uint16 public constant CONTRACT_VERSION = 4;

    error MessageNotFound();
    error NotSender();
    error RevokedMessage();
    error MessageAlreadyUnlocked();
    error ConditionsNotMet();
    error InvalidConditionMode();

    struct Message {
        address sender;
        address receiver;
        uint64 createdAt;
        uint64 unlockTime;
        uint256 requiredPayment;
        uint256 paidAmount;
        uint8 conditionMode;
        bool hasTimeCondition;
        bool hasPaymentCondition;
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
        uint8 conditionMode;
        bool hasTimeCondition;
        bool hasPaymentCondition;
        string payloadCid;
        string metadataCid;
        string previewCid;
        string previewText;
        bytes32 payloadHash;
        bytes32 metadataHash;
        bool revoked;
        bool unlocked;
    }

    struct MessageAccess {
        uint256 requiredPayment;
        uint256 paidAmount;
        bool isPaymentMet;
        bool isTimeMet;
        bool isReadyToUnlock;
        bool isUnlocked;
        bool isRevoked;
    }

    uint256 public messageCount;
    mapping(uint256 => Message) private _messages;
    mapping(address => uint256[]) private _sentMessages;
    mapping(address => uint256[]) private _receivedMessages;

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
    event MessagePaid(uint256 indexed messageId, address indexed payer, uint256 amount, uint256 totalPaid);

    function sendMessage(
        address receiver,
        uint64 unlockTime,
        uint256 requiredPayment,
        uint8 conditionMode,
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
        if (conditionMode > 1) revert InvalidConditionMode();

        bool hasTimeCondition = unlockTime > block.timestamp;
        bool hasPaymentCondition = requiredPayment > 0;
        require(unlockTime == 0 || hasTimeCondition, "Unlock time must be future");
        require(hasTimeCondition || hasPaymentCondition, "Empty conditions");

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

        Message storage messageRef = _messages[messageId];
        messageRef.sender = msg.sender;
        messageRef.receiver = receiver;
        messageRef.createdAt = uint64(block.timestamp);
        messageRef.unlockTime = unlockTime;
        messageRef.requiredPayment = requiredPayment;
        messageRef.paidAmount = 0;
        messageRef.conditionMode = hasTimeCondition && hasPaymentCondition ? conditionMode : 0;
        messageRef.hasTimeCondition = hasTimeCondition;
        messageRef.hasPaymentCondition = hasPaymentCondition;
        messageRef.revoked = false;
        messageRef.unlocked = false;
        messageRef.payloadHash = payloadHash;
        messageRef.metadataHash = metadataHash;
        messageRef.keyHandle0 = externalEuint64.unwrap(key0Handle);
        messageRef.keyHandle1 = externalEuint64.unwrap(key1Handle);
        messageRef.keyHandle2 = externalEuint64.unwrap(key2Handle);
        messageRef.keyHandle3 = externalEuint64.unwrap(key3Handle);
        messageRef.key0 = key0;
        messageRef.key1 = key1;
        messageRef.key2 = key2;
        messageRef.key3 = key3;
        messageRef.payloadCid = payloadCid;
        messageRef.metadataCid = metadataCid;
        messageRef.previewCid = previewCid;
        messageRef.previewText = previewText;

        _sentMessages[msg.sender].push(messageId);
        _receivedMessages[receiver].push(messageId);

        emit MessageStored(messageId, msg.sender, receiver);
    }

    function payToUnlock(uint256 messageId) external payable nonReentrant {
        Message storage messageRef = _messages[messageId];
        if (messageRef.sender == address(0)) revert MessageNotFound();
        if (messageRef.revoked) revert RevokedMessage();
        require(messageRef.hasPaymentCondition, "No payment condition");
        require(msg.value > 0, "No payment");

        uint256 remaining = messageRef.requiredPayment > messageRef.paidAmount
            ? messageRef.requiredPayment - messageRef.paidAmount
            : 0;
        require(remaining > 0, "Already paid");

        uint256 contribution = msg.value;
        if (contribution > remaining) {
            uint256 refund = contribution - remaining;
            contribution = remaining;
            (bool refundOk, ) = msg.sender.call{value: refund}("");
            require(refundOk, "Refund failed");
        }

        messageRef.paidAmount += contribution;

        (bool payoutOk, ) = messageRef.sender.call{value: contribution}("");
        require(payoutOk, "Payment forward failed");

        emit MessagePaid(messageId, msg.sender, contribution, messageRef.paidAmount);
    }

    function unlockMessage(uint256 messageId) external {
        Message storage messageRef = _messages[messageId];
        if (messageRef.sender == address(0)) revert MessageNotFound();
        if (messageRef.revoked) revert RevokedMessage();
        if (messageRef.unlocked) revert MessageAlreadyUnlocked();
        if (!_conditionsMet(messageRef)) revert ConditionsNotMet();

        messageRef.unlocked = true;

        FHE.allow(messageRef.key0, messageRef.receiver);
        FHE.allow(messageRef.key1, messageRef.receiver);
        FHE.allow(messageRef.key2, messageRef.receiver);
        FHE.allow(messageRef.key3, messageRef.receiver);

        emit MessageUnlocked(messageId, messageRef.receiver);
    }

    function revokeMessage(uint256 messageId) external {
        Message storage messageRef = _messages[messageId];
        if (messageRef.sender == address(0)) revert MessageNotFound();
        if (messageRef.sender != msg.sender) revert NotSender();
        if (messageRef.revoked) revert RevokedMessage();
        if (messageRef.unlocked) revert MessageAlreadyUnlocked();

        messageRef.revoked = true;
        emit MessageRevoked(messageId, msg.sender);
    }

    function getMessageSummary(uint256 messageId) external view returns (MessageSummary memory) {
        Message storage messageRef = _messages[messageId];
        if (messageRef.sender == address(0)) revert MessageNotFound();

        return MessageSummary({
            sender: messageRef.sender,
            receiver: messageRef.receiver,
            createdAt: messageRef.createdAt,
            unlockTime: messageRef.unlockTime,
            conditionMode: messageRef.conditionMode,
            hasTimeCondition: messageRef.hasTimeCondition,
            hasPaymentCondition: messageRef.hasPaymentCondition,
            payloadCid: messageRef.payloadCid,
            metadataCid: messageRef.metadataCid,
            previewCid: messageRef.previewCid,
            previewText: messageRef.previewText,
            payloadHash: messageRef.payloadHash,
            metadataHash: messageRef.metadataHash,
            revoked: messageRef.revoked,
            unlocked: messageRef.unlocked
        });
    }

    function getMessageAccess(uint256 messageId) external view returns (MessageAccess memory) {
        Message storage messageRef = _messages[messageId];
        if (messageRef.sender == address(0)) revert MessageNotFound();

        bool paymentMet = _isPaymentMet(messageRef);
        bool timeMet = _isTimeMet(messageRef);

        return MessageAccess({
            requiredPayment: messageRef.requiredPayment,
            paidAmount: messageRef.paidAmount,
            isPaymentMet: paymentMet,
            isTimeMet: timeMet,
            isReadyToUnlock: _conditionsMet(messageRef),
            isUnlocked: messageRef.unlocked,
            isRevoked: messageRef.revoked
        });
    }

    function getKeyHandles(uint256 messageId) external view returns (bytes32 key0, bytes32 key1, bytes32 key2, bytes32 key3) {
        Message storage messageRef = _messages[messageId];
        if (messageRef.sender == address(0)) revert MessageNotFound();

        return (messageRef.keyHandle0, messageRef.keyHandle1, messageRef.keyHandle2, messageRef.keyHandle3);
    }

    function getSentMessages(address user) external view returns (uint256[] memory) {
        return _sentMessages[user];
    }

    function getReceivedMessages(address user) external view returns (uint256[] memory) {
        return _receivedMessages[user];
    }

    function messageExists(uint256 messageId) external view returns (bool exists, bool revoked, bool unlocked) {
        Message storage messageRef = _messages[messageId];
        exists = messageRef.sender != address(0);
        revoked = messageRef.revoked;
        unlocked = messageRef.unlocked;
    }

    function _conditionsMet(Message storage messageRef) private view returns (bool) {
        bool timeMet = _isTimeMet(messageRef);
        bool paymentMet = _isPaymentMet(messageRef);

        if (messageRef.hasTimeCondition && messageRef.hasPaymentCondition) {
            return messageRef.conditionMode == 1 ? (timeMet || paymentMet) : (timeMet && paymentMet);
        }

        if (messageRef.hasTimeCondition) {
            return timeMet;
        }

        if (messageRef.hasPaymentCondition) {
            return paymentMet;
        }

        return false;
    }

    function _isTimeMet(Message storage messageRef) private view returns (bool) {
        return !messageRef.hasTimeCondition || block.timestamp >= messageRef.unlockTime;
    }

    function _isPaymentMet(Message storage messageRef) private view returns (bool) {
        return !messageRef.hasPaymentCondition || messageRef.paidAmount >= messageRef.requiredPayment;
    }
}
