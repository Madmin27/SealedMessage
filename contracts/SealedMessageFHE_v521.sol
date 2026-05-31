// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title SealedMessageFHE_v521
/// @notice V5.2.1 — hardened FHE-sealed message contract with paid revoke protection.
/// @dev Security invariants remain the same as V5.1:
///      - getKeyHandles(): only receiver + unlocked
///      - unlockMessage(): FHE.allow only to receiver (no public decrypt)
///      - payToUnlock(): receiver-only pull-payment via pendingWithdrawals
///      - revokeMessage(): paid messages cannot be revoked
///      - No key material in events
///      - CONTRACT_VERSION = 521, CONTRACT_VERSION_STRING = "5.2.1"
contract SealedMessageFHE_v521 is ZamaEthereumConfig {
    uint256 public constant CONTRACT_VERSION = 521;
    string public constant CONTRACT_VERSION_STRING = "5.2.1";

    error MessageNotFound();
    error NotSender();
    error RevokedMessage();
    error MessageAlreadyUnlocked();
    error ConditionsNotMet();
    error NotReceiver();
    error PaidMessageCannotBeRevoked();

    enum UnlockCondition { TimeOnly, PaymentOnly, TimeAndPayment, TimeOrPayment }

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

        bool hasTimeCondition = _hasTimeCondition(condition);
        bool hasPaymentCondition = _hasPaymentCondition(condition);

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

    function payToUnlock(uint256 messageId) external payable nonReentrant {
        Message storage m = _messages[messageId];
        if (m.sender == address(0)) revert MessageNotFound();
        if (m.revoked) revert RevokedMessage();
        if (m.unlocked) revert MessageAlreadyUnlocked();
        if (msg.sender != m.receiver) revert NotReceiver();
        require(_hasPaymentCondition(m.condition), "No payment condition");
        require(!m.paid, "Already paid");
        require(msg.value == m.requiredPayment, "Incorrect payment");

        m.paid = true;
        pendingWithdrawals[m.sender] += msg.value;

        emit MessagePaid(messageId, msg.sender, msg.value);

        if (_conditionsMet(m)) {
            _unlockMessage(messageId, m);
        }
    }

    function withdrawPayments() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing to withdraw");
        pendingWithdrawals[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Withdraw failed");
    }

    function unlockMessage(uint256 messageId) external {
        Message storage m = _messages[messageId];
        if (m.sender == address(0)) revert MessageNotFound();
        if (m.revoked) revert RevokedMessage();
        if (m.unlocked) revert MessageAlreadyUnlocked();
        if (!_conditionsMet(m)) revert ConditionsNotMet();

        _unlockMessage(messageId, m);
    }

    function revokeMessage(uint256 messageId) external {
        Message storage m = _messages[messageId];
        if (m.sender == address(0)) revert MessageNotFound();
        if (m.sender != msg.sender) revert NotSender();
        if (m.revoked) revert RevokedMessage();
        if (m.unlocked) revert MessageAlreadyUnlocked();
        if (m.paid) revert PaidMessageCannotBeRevoked();

        m.revoked = true;
        emit MessageRevoked(messageId, msg.sender);
    }

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

    function getKeyHandles(uint256 messageId) external view returns (bytes32 key0, bytes32 key1, bytes32 key2, bytes32 key3) {
        Message storage m = _messages[messageId];
        if (m.sender == address(0)) revert MessageNotFound();
        require(msg.sender == m.receiver, "Only receiver");
        require(m.unlocked, "Message locked");

        return (m.keyHandle0, m.keyHandle1, m.keyHandle2, m.keyHandle3);
    }

    function getSentMessages(address user) external view returns (uint256[] memory) {
        return _sentMessages[user];
    }

    function getReceivedMessages(address user) external view returns (uint256[] memory) {
        return _receivedMessages[user];
    }

    function messageExists(uint256 messageId) external view returns (bool exists, bool revoked, bool unlocked) {
        Message storage m = _messages[messageId];
        exists = m.sender != address(0);
        revoked = m.revoked;
        unlocked = m.unlocked;
    }

    function _conditionsMet(Message storage m) private view returns (bool) {
        bool timeOk = !_hasTimeCondition(m.condition) || block.timestamp >= m.unlockTime;
        bool paymentOk = !_hasPaymentCondition(m.condition) || m.paid;

        if (m.condition == UnlockCondition.TimeOnly) {
            return timeOk;
        }
        if (m.condition == UnlockCondition.PaymentOnly) {
            return paymentOk;
        }
        if (m.condition == UnlockCondition.TimeAndPayment) {
            return timeOk && paymentOk;
        }
        if (m.condition == UnlockCondition.TimeOrPayment) {
            return timeOk || paymentOk;
        }
        return false;
    }

    function _isTimeMet(Message storage m) private view returns (bool) {
        if (_hasTimeCondition(m.condition)) {
            return block.timestamp >= m.unlockTime;
        }
        return true;
    }

    function _hasTimeCondition(UnlockCondition condition) private pure returns (bool) {
        return condition == UnlockCondition.TimeOnly || condition == UnlockCondition.TimeAndPayment || condition == UnlockCondition.TimeOrPayment;
    }

    function _hasPaymentCondition(UnlockCondition condition) private pure returns (bool) {
        return condition == UnlockCondition.PaymentOnly || condition == UnlockCondition.TimeAndPayment || condition == UnlockCondition.TimeOrPayment;
    }

    function _unlockMessage(uint256 messageId, Message storage m) private {
        m.unlocked = true;

        FHE.allow(m.key0, m.receiver);
        FHE.allow(m.key1, m.receiver);
        FHE.allow(m.key2, m.receiver);
        FHE.allow(m.key3, m.receiver);

        emit MessageUnlocked(messageId, m.receiver);
    }
}
