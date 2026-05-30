export const sealedMessageFheSecureAbi = [
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "uint256", "name": "messageId", "type": "uint256" },
      { "indexed": true, "internalType": "address", "name": "sender", "type": "address" },
      { "indexed": true, "internalType": "address", "name": "receiver", "type": "address" }
    ],
    "name": "MessageStored",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "uint256", "name": "messageId", "type": "uint256" },
      { "indexed": true, "internalType": "address", "name": "receiver", "type": "address" }
    ],
    "name": "MessageUnlocked",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "uint256", "name": "messageId", "type": "uint256" },
      { "indexed": true, "internalType": "address", "name": "payer", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "totalPaid", "type": "uint256" }
    ],
    "name": "MessagePaid",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "CONTRACT_VERSION",
    "outputs": [{ "internalType": "uint16", "name": "", "type": "uint16" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "user", "type": "address" }],
    "name": "getSentMessages",
    "outputs": [{ "internalType": "uint256[]", "name": "", "type": "uint256[]" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "user", "type": "address" }],
    "name": "getReceivedMessages",
    "outputs": [{ "internalType": "uint256[]", "name": "", "type": "uint256[]" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "messageId", "type": "uint256" }],
    "name": "getMessageSummary",
    "outputs": [{
      "components": [
        { "internalType": "address", "name": "sender", "type": "address" },
        { "internalType": "address", "name": "receiver", "type": "address" },
        { "internalType": "uint64", "name": "createdAt", "type": "uint64" },
        { "internalType": "uint64", "name": "unlockTime", "type": "uint64" },
        { "internalType": "uint8", "name": "conditionMode", "type": "uint8" },
        { "internalType": "bool", "name": "hasTimeCondition", "type": "bool" },
        { "internalType": "bool", "name": "hasPaymentCondition", "type": "bool" },
        { "internalType": "string", "name": "payloadCid", "type": "string" },
        { "internalType": "string", "name": "metadataCid", "type": "string" },
        { "internalType": "string", "name": "previewCid", "type": "string" },
        { "internalType": "string", "name": "previewText", "type": "string" },
        { "internalType": "bytes32", "name": "payloadHash", "type": "bytes32" },
        { "internalType": "bytes32", "name": "metadataHash", "type": "bytes32" },
        { "internalType": "bool", "name": "revoked", "type": "bool" },
        { "internalType": "bool", "name": "unlocked", "type": "bool" }
      ],
      "internalType": "struct SealedMessageFHE.MessageSummary",
      "name": "",
      "type": "tuple"
    }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "messageId", "type": "uint256" }],
    "name": "getMessageAccess",
    "outputs": [{
      "components": [
        { "internalType": "uint256", "name": "requiredPayment", "type": "uint256" },
        { "internalType": "uint256", "name": "paidAmount", "type": "uint256" },
        { "internalType": "bool", "name": "isPaymentMet", "type": "bool" },
        { "internalType": "bool", "name": "isTimeMet", "type": "bool" },
        { "internalType": "bool", "name": "isReadyToUnlock", "type": "bool" },
        { "internalType": "bool", "name": "isUnlocked", "type": "bool" },
        { "internalType": "bool", "name": "isRevoked", "type": "bool" }
      ],
      "internalType": "struct SealedMessageFHE.MessageAccess",
      "name": "",
      "type": "tuple"
    }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "messageId", "type": "uint256" }],
    "name": "getKeyHandles",
    "outputs": [
      { "internalType": "bytes32", "name": "key0", "type": "bytes32" },
      { "internalType": "bytes32", "name": "key1", "type": "bytes32" },
      { "internalType": "bytes32", "name": "key2", "type": "bytes32" },
      { "internalType": "bytes32", "name": "key3", "type": "bytes32" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "receiver", "type": "address" },
      { "internalType": "uint64", "name": "unlockTime", "type": "uint64" },
      { "internalType": "uint256", "name": "requiredPayment", "type": "uint256" },
      { "internalType": "uint8", "name": "conditionMode", "type": "uint8" },
      { "internalType": "string", "name": "payloadCid", "type": "string" },
      { "internalType": "string", "name": "metadataCid", "type": "string" },
      { "internalType": "string", "name": "previewCid", "type": "string" },
      { "internalType": "string", "name": "previewText", "type": "string" },
      { "internalType": "bytes32", "name": "payloadHash", "type": "bytes32" },
      { "internalType": "bytes32", "name": "metadataHash", "type": "bytes32" },
      { "internalType": "externalEuint64", "name": "key0Handle", "type": "bytes32" },
      { "internalType": "externalEuint64", "name": "key1Handle", "type": "bytes32" },
      { "internalType": "externalEuint64", "name": "key2Handle", "type": "bytes32" },
      { "internalType": "externalEuint64", "name": "key3Handle", "type": "bytes32" },
      { "internalType": "bytes", "name": "keyInputProof", "type": "bytes" }
    ],
    "name": "sendMessage",
    "outputs": [{ "internalType": "uint256", "name": "messageId", "type": "uint256" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "messageId", "type": "uint256" }],
    "name": "unlockMessage",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "messageId", "type": "uint256" }],
    "name": "revokeMessage",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "messageId", "type": "uint256" }],
    "name": "payToUnlock",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  }
] as const;
