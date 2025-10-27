// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title SealedMessage
/// @notice Stores AES/ECDH encrypted metadata with optional time- and payment-based unlock conditions
/// @dev The contract never receives plaintext payloads. Off-chain clients encrypt data using
///      AES-256-GCM, publish the ciphertext to IPFS (or similar) and submit integrity metadata here.
contract SealedMessage {
    uint8 private constant CONDITION_TIME = 0x01;
    uint8 private constant CONDITION_PAYMENT = 0x02;

    struct Message {
        address sender;
        address receiver;
        string uri;
        bytes iv;
        bytes authTag;
        bytes32 ciphertextHash;
        bytes32 metadataHash;
        bytes escrowCiphertext;
        bytes escrowIv;
        bytes escrowAuthTag;
        bytes32 sessionKeyCommitment;
        bytes32 receiverEnvelopeHash;
        uint16 escrowKeyVersion;
        uint256 createdAt;
        uint256 unlockTime;
        uint256 requiredPayment;
        uint256 paidAmount;
        uint8 conditionMask;
        bool revoked;
        bool exists;
    }

    struct MessageFinancialView {
        uint256 unlockTime;
        uint256 requiredPayment;
        uint256 paidAmount;
        uint8 conditionMask;
        bool isUnlocked;
    }

    uint256 public messageCount;
    mapping(uint256 => Message) private _messages;
    mapping(address => uint256[]) private _sentMessages;
    mapping(address => uint256[]) private _receivedMessages;
    mapping(address => bytes) private _encryptionKeys;

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status = _NOT_ENTERED;

    modifier nonReentrant() {
        require(_status != _ENTERED, "Reentrancy");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    event MessageStored(
        uint256 indexed messageId,
        address indexed sender,
        address indexed receiver,
        uint8 conditionMask,
        uint256 unlockTime,
        uint256 requiredPayment,
        string uri,
        bytes32 sessionKeyCommitment,
        uint16 escrowKeyVersion
    );

    event MessageRevoked(uint256 indexed messageId, address indexed sender);
    event MessagePaid(uint256 indexed messageId, address indexed payer, uint256 amount, uint256 totalPaid);
    event MessageUnlocked(uint256 indexed messageId, string reason);
    event EncryptionKeyRegistered(address indexed user, bytes publicKey);

    error MessageNotFound();
    error NotSender();

    function sendMessage(
        address receiver,
        string calldata uri,
        bytes calldata iv,
        bytes calldata authTag,
        bytes32 ciphertextHash,
        bytes32 metadataHash,
        bytes calldata escrowCiphertext,
        bytes calldata escrowIv,
        bytes calldata escrowAuthTag,
        bytes32 sessionKeyCommitment,
        bytes32 receiverEnvelopeHash,
        uint16 escrowKeyVersion,
        uint256 unlockTime,
        uint256 requiredPayment,
        uint8 conditionMask
    ) external returns (uint256 messageId) {
        require(receiver != address(0), "Invalid receiver");
        require(receiver != msg.sender, "Self target");
        require(bytes(uri).length != 0, "Empty uri");
        require(iv.length == 12, "IV length");
        require(authTag.length == 16, "Tag length");
        require(ciphertextHash != bytes32(0), "Cipher hash");
        require(metadataHash != bytes32(0), "Metadata hash");
        require(escrowCiphertext.length == 32, "Escrow cipher length");
        require(escrowIv.length == 12, "Escrow IV length");
        require(escrowAuthTag.length == 16, "Escrow tag length");
        require(sessionKeyCommitment != bytes32(0), "Session key commitment");
        require(receiverEnvelopeHash != bytes32(0), "Receiver envelope hash");
        require(escrowKeyVersion != 0, "Escrow key version");
        require(conditionMask & (CONDITION_TIME | CONDITION_PAYMENT) != 0, "Empty mask");

        bool hasTime = (conditionMask & CONDITION_TIME) != 0;
        bool hasPayment = (conditionMask & CONDITION_PAYMENT) != 0;

        if (hasTime) {
            require(unlockTime > block.timestamp, "Unlock in past");
        } else {
            unlockTime = 0;
        }

        if (hasPayment) {
            require(requiredPayment > 0, "Payment required");
        } else {
            requiredPayment = 0;
        }

        messageId = messageCount;
        messageCount += 1;

        Message storage message = _messages[messageId];
        message.sender = msg.sender;
        message.receiver = receiver;
        message.uri = uri;
        message.iv = iv;
        message.authTag = authTag;
        message.ciphertextHash = ciphertextHash;
        message.metadataHash = metadataHash;
    message.escrowCiphertext = escrowCiphertext;
    message.escrowIv = escrowIv;
    message.escrowAuthTag = escrowAuthTag;
    message.sessionKeyCommitment = sessionKeyCommitment;
    message.receiverEnvelopeHash = receiverEnvelopeHash;
    message.escrowKeyVersion = escrowKeyVersion;
        message.createdAt = block.timestamp;
        message.unlockTime = unlockTime;
        message.requiredPayment = requiredPayment;
        message.paidAmount = 0;
        message.conditionMask = conditionMask;
        message.revoked = false;
        message.exists = true;

        _sentMessages[msg.sender].push(messageId);
        _receivedMessages[receiver].push(messageId);

        emit MessageStored(
            messageId,
            msg.sender,
            receiver,
            conditionMask,
            unlockTime,
            requiredPayment,
            uri,
            sessionKeyCommitment,
            escrowKeyVersion
        );
    }

    function payToUnlock(uint256 messageId) external payable nonReentrant {
        Message storage message = _messages[messageId];
        if (!message.exists) revert MessageNotFound();
        require((message.conditionMask & CONDITION_PAYMENT) != 0, "No payment condition");
        require(!message.revoked, "Revoked");
        require(msg.value > 0, "No payment");
        require(message.paidAmount < message.requiredPayment, "Paid");

        uint256 remaining = message.requiredPayment - message.paidAmount;
        uint256 contribution = msg.value;

        if (contribution > remaining) {
            uint256 refund = contribution - remaining;
            contribution = remaining;
            (bool refundOk, ) = msg.sender.call{value: refund}("");
            require(refundOk, "Refund failed");
        }

        message.paidAmount += contribution;

        (bool success, ) = message.sender.call{value: contribution}("");
        require(success, "Forward failed");

        emit MessagePaid(messageId, msg.sender, contribution, message.paidAmount);

        if (message.paidAmount >= message.requiredPayment) {
            emit MessageUnlocked(messageId, "payment");
        }
    }

    function revokeMessage(uint256 messageId) external {
        Message storage message = _messages[messageId];
        if (!message.exists) revert MessageNotFound();
        if (message.sender != msg.sender) revert NotSender();
        require(!message.revoked, "Already revoked");

        message.revoked = true;
        emit MessageRevoked(messageId, msg.sender);
    }

    function getMessage(uint256 messageId)
        external
        view
        returns (
            address sender,
            address receiver,
            string memory uri,
            bytes memory iv,
            bytes memory authTag,
            bytes32 ciphertextHash,
            bytes32 metadataHash,
            bytes memory escrowCiphertext,
            bytes memory escrowIv,
            bytes memory escrowAuthTag,
            bytes32 sessionKeyCommitment,
            bytes32 receiverEnvelopeHash,
            uint16 escrowKeyVersion,
            uint256 createdAt,
            bool revoked,
            uint256 unlockTime,
            uint256 requiredPayment,
            uint256 paidAmount,
            uint8 conditionMask
        )
    {
        Message storage message = _messages[messageId];
        if (!message.exists) revert MessageNotFound();
        
        // ✅ CRITICAL SECURITY: Only sender or receiver can read message details
        // This prevents unauthorized access to encrypted data
        require(
            msg.sender == message.sender || msg.sender == message.receiver,
            "Only sender or receiver can access message"
        );

        return (
            message.sender,
            message.receiver,
            message.uri,
            message.iv,
            message.authTag,
            message.ciphertextHash,
            message.metadataHash,
            message.escrowCiphertext,
            message.escrowIv,
            message.escrowAuthTag,
            message.sessionKeyCommitment,
            message.receiverEnvelopeHash,
            message.escrowKeyVersion,
            message.createdAt,
            message.revoked,
            message.unlockTime,
            message.requiredPayment,
            message.paidAmount,
            message.conditionMask
        );
    }

    function getMessageFinancialView(uint256 messageId) external view returns (MessageFinancialView memory viewData) {
        Message storage message = _messages[messageId];
        if (!message.exists) revert MessageNotFound();

        return MessageFinancialView({
            unlockTime: message.unlockTime,
            requiredPayment: message.requiredPayment,
            paidAmount: message.paidAmount,
            conditionMask: message.conditionMask,
            isUnlocked: _isUnlocked(message)
        });
    }

    function isUnlocked(uint256 messageId) external view returns (bool) {
        Message storage message = _messages[messageId];
        if (!message.exists) revert MessageNotFound();
        return _isUnlocked(message);
    }

    function _isUnlocked(Message storage message) private view returns (bool) {
        bool timeOk = (message.conditionMask & CONDITION_TIME) == 0 || block.timestamp >= message.unlockTime;
        bool paymentOk = (message.conditionMask & CONDITION_PAYMENT) == 0 || message.paidAmount >= message.requiredPayment;

        // ✅ CRITICAL FIX: When BOTH conditions exist, BOTH must be satisfied (AND not OR)
        // Time + Payment: Both time must be reached AND payment must be made
        // if ((message.conditionMask & CONDITION_TIME) != 0 && (message.conditionMask & CONDITION_PAYMENT) != 0) {
        //     return timeOk || paymentOk;  // ❌ OLD BUGGY CODE: OR logic allowed early unlock
        // }

        // ✅ Correct logic: ALL active conditions must be satisfied
        return timeOk && paymentOk;
    }

    function getSentMessages(address user) external view returns (uint256[] memory) {
        return _sentMessages[user];
    }

    function getReceivedMessages(address user) external view returns (uint256[] memory) {
        return _receivedMessages[user];
    }

    function registerEncryptionKey(bytes calldata publicKey) external {
        require(publicKey.length == 33 || publicKey.length == 65, "Invalid key length");
        _encryptionKeys[msg.sender] = publicKey;
        emit EncryptionKeyRegistered(msg.sender, publicKey);
    }

    function getEncryptionKey(address user) external view returns (bytes memory) {
        return _encryptionKeys[user];
    }

    function hasEncryptionKey(address user) external view returns (bool) {
        return _encryptionKeys[user].length > 0;
    }
}
