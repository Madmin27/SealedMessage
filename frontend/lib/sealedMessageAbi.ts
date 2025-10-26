export const sealedMessageAbi = [
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
		"anonymous": false,
		"inputs": [
			{
				"indexed": true,
				"internalType": "address",
				"name": "user",
				"type": "address"
			},
			{
				"indexed": false,
				"internalType": "bytes",
				"name": "publicKey",
				"type": "bytes"
			}
		],
		"name": "EncryptionKeyRegistered",
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
				"name": "unlockTime",
				"type": "uint256"
			},
			{
				"indexed": false,
				"internalType": "uint256",
				"name": "requiredPayment",
				"type": "uint256"
			},
			{
				"indexed": false,
				"internalType": "string",
				"name": "uri",
				"type": "string"
			},
			{
				"indexed": false,
				"internalType": "bytes32",
				"name": "sessionKeyCommitment",
				"type": "bytes32"
			},
			{
				"indexed": false,
				"internalType": "uint16",
				"name": "escrowKeyVersion",
				"type": "uint16"
			}
		],
		"name": "MessageStored",
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
				"indexed": false,
				"internalType": "string",
				"name": "reason",
				"type": "string"
			}
		],
		"name": "MessageUnlocked",
		"type": "event"
	},
	{
		"inputs": [
			{
				"internalType": "address",
				"name": "user",
				"type": "address"
			}
		],
		"name": "getEncryptionKey",
		"outputs": [
			{
				"internalType": "bytes",
				"name": "",
				"type": "bytes"
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
		"name": "getMessage",
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
				"internalType": "string",
				"name": "uri",
				"type": "string"
			},
			{
				"internalType": "bytes",
				"name": "iv",
				"type": "bytes"
			},
			{
				"internalType": "bytes",
				"name": "authTag",
				"type": "bytes"
			},
			{
				"internalType": "bytes32",
				"name": "ciphertextHash",
				"type": "bytes32"
			},
			{
				"internalType": "bytes32",
				"name": "metadataHash",
				"type": "bytes32"
			},
			{
				"internalType": "bytes",
				"name": "escrowCiphertext",
				"type": "bytes"
			},
			{
				"internalType": "bytes",
				"name": "escrowIv",
				"type": "bytes"
			},
			{
				"internalType": "bytes",
				"name": "escrowAuthTag",
				"type": "bytes"
			},
			{
				"internalType": "bytes32",
				"name": "sessionKeyCommitment",
				"type": "bytes32"
			},
			{
				"internalType": "bytes32",
				"name": "receiverEnvelopeHash",
				"type": "bytes32"
			},
			{
				"internalType": "uint16",
				"name": "escrowKeyVersion",
				"type": "uint16"
			},
			{
				"internalType": "uint256",
				"name": "createdAt",
				"type": "uint256"
			},
			{
				"internalType": "bool",
				"name": "revoked",
				"type": "bool"
			},
			{
				"internalType": "uint256",
				"name": "unlockTime",
				"type": "uint256"
			},
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
						"name": "unlockTime",
						"type": "uint256"
					},
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
						"name": "isUnlocked",
						"type": "bool"
					}
				],
				"internalType": "struct SealedMessage.MessageFinancialView",
				"name": "viewData",
				"type": "tuple"
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
		"inputs": [
			{
				"internalType": "address",
				"name": "user",
				"type": "address"
			}
		],
		"name": "hasEncryptionKey",
		"outputs": [
			{
				"internalType": "bool",
				"name": "",
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
		"name": "isUnlocked",
		"outputs": [
			{
				"internalType": "bool",
				"name": "",
				"type": "bool"
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
		"name": "payToUnlock",
		"outputs": [],
		"stateMutability": "payable",
		"type": "function"
	},
	{
		"inputs": [
			{
				"internalType": "bytes",
				"name": "publicKey",
				"type": "bytes"
			}
		],
		"name": "registerEncryptionKey",
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
				"internalType": "string",
				"name": "uri",
				"type": "string"
			},
			{
				"internalType": "bytes",
				"name": "iv",
				"type": "bytes"
			},
			{
				"internalType": "bytes",
				"name": "authTag",
				"type": "bytes"
			},
			{
				"internalType": "bytes32",
				"name": "ciphertextHash",
				"type": "bytes32"
			},
			{
				"internalType": "bytes32",
				"name": "metadataHash",
				"type": "bytes32"
			},
			{
				"internalType": "bytes",
				"name": "escrowCiphertext",
				"type": "bytes"
			},
			{
				"internalType": "bytes",
				"name": "escrowIv",
				"type": "bytes"
			},
			{
				"internalType": "bytes",
				"name": "escrowAuthTag",
				"type": "bytes"
			},
			{
				"internalType": "bytes32",
				"name": "sessionKeyCommitment",
				"type": "bytes32"
			},
			{
				"internalType": "bytes32",
				"name": "receiverEnvelopeHash",
				"type": "bytes32"
			},
			{
				"internalType": "uint16",
				"name": "escrowKeyVersion",
				"type": "uint16"
			},
			{
				"internalType": "uint256",
				"name": "unlockTime",
				"type": "uint256"
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
