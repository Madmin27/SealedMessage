// ABI generated from compiled artifact (FHEVM v0.11)
export const sealedMessageFheAbi = [
  {
    "inputs": [],
    "name": "InvalidKMSSignatures",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "MessageNotFound",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotSender",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "OnlySenderOrReceiver",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "handle",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "sender",
        "type": "address"
      }
    ],
    "name": "SenderNotAllowedToUseHandle",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "messageId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "payer",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "totalPaid",
        "type": "uint256"
      }
    ],
    "name": "MessagePaid",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "messageId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "sender",
        "type": "address"
      }
    ],
    "name": "MessageRevoked",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "messageId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "sender",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "receiver",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "conditionMask",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "requiredPayment",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "createdAt",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "dataCid",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "metadataCid",
        "type": "string"
      }
    ],
    "name": "MessageStored",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "bytes32[]",
        "name": "handlesList",
        "type": "bytes32[]"
      },
      {
        "indexed": false,
        "internalType": "bytes",
        "name": "abiEncodedCleartexts",
        "type": "bytes"
      }
    ],
    "name": "PublicDecryptionVerified",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "CONTRACT_VERSION",
    "outputs": [
      {
        "internalType": "uint16",
        "name": "",
        "type": "uint16"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "messageId",
        "type": "uint256"
      }
    ],
    "name": "checkTimeCondition",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "messageId",
        "type": "uint256"
      }
    ],
    "name": "getEncryptedUnlockTimeHandle",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "handle",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "messageId",
        "type": "uint256"
      }
    ],
    "name": "getMessageFinancialView",
    "outputs": [
      {
        "components": [
          {
            "internalType": "uint256",
            "name": "requiredPayment",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "paidAmount",
            "type": "uint256"
          },
          {
            "internalType": "uint8",
            "name": "conditionMask",
            "type": "uint8"
          },
          {
            "internalType": "bool",
            "name": "isPaymentMet",
            "type": "bool"
          },
          {
            "internalType": "bool",
            "name": "isUnlocked",
            "type": "bool"
          },
          {
            "internalType": "bool",
            "name": "exists",
            "type": "bool"
          }
        ],
        "internalType": "struct SealedMessageFHE.FinancialView",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "messageId",
        "type": "uint256"
      }
    ],
    "name": "getMessageParties",
    "outputs": [
      {
        "internalType": "address",
        "name": "sender",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "receiver",
        "type": "address"
      },
      {
        "internalType": "bool",
        "name": "exists",
        "type": "bool"
      },
      {
        "internalType": "string",
        "name": "dataCid",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "metadataCid",
        "type": "string"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "user",
        "type": "address"
      }
    ],
    "name": "getReceivedMessages",
    "outputs": [
      {
        "internalType": "uint256[]",
        "name": "",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "user",
        "type": "address"
      }
    ],
    "name": "getSentMessages",
    "outputs": [
      {
        "internalType": "uint256[]",
        "name": "",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "messageCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "messageId",
        "type": "uint256"
      }
    ],
    "name": "messageExists",
    "outputs": [
      {
        "internalType": "bool",
        "name": "exists",
        "type": "bool"
      },
      {
        "internalType": "bool",
        "name": "revoked",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "messageId",
        "type": "uint256"
      }
    ],
    "name": "payToUnlock",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "messageId",
        "type": "uint256"
      },
      {
        "internalType": "bytes32[]",
        "name": "handlesList",
        "type": "bytes32[]"
      },
      {
        "internalType": "bytes",
        "name": "abiEncodedCleartexts",
        "type": "bytes"
      },
      {
        "internalType": "bytes",
        "name": "decryptionProof",
        "type": "bytes"
      }
    ],
    "name": "receiveDecryption",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "messageId",
        "type": "uint256"
      }
    ],
    "name": "revokeMessage",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "receiver",
        "type": "address"
      },
      {
        "internalType": "externalEuint64",
        "name": "encryptedUnlockTimeHandle",
        "type": "bytes32"
      },
      {
        "internalType": "bytes",
        "name": "unlockProof",
        "type": "bytes"
      },
      {
        "internalType": "string",
        "name": "dataCid",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "metadataCid",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "requiredPayment",
        "type": "uint256"
      },
      {
        "internalType": "uint8",
        "name": "conditionMask",
        "type": "uint8"
      }
    ],
    "name": "sendMessage",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "messageId",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;
