"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import advancedFormat from "dayjs/plugin/advancedFormat";
import duration from "dayjs/plugin/duration";
import { usePublicClient, useAccount, useNetwork } from "wagmi";
import type { PublicClient } from "viem";
import { sealedMessageAbi } from "../lib/sealedMessageAbi";
import { appConfig } from "../lib/env";
import { useContractAddress, useHasContract } from "../lib/useContractAddress";
import { MessageCard } from "./MessageCard";

dayjs.extend(relativeTime);
dayjs.extend(advancedFormat);
dayjs.extend(duration);

interface MessageListProps {
  refreshKey?: number;
}

interface MessageViewModel {
  id: bigint;
  sender: string;
  receiver: string;
  unlockTime: bigint;
  unlockDate: string;
  relative: string;
  unlocked: boolean;
  content: string | null;
  isRead: boolean;
  isSent: boolean;
  contractAddress?: string; // ✅ Hangi contract'tan geldiği
  timestamp?: bigint; // Mesajın gönderilme zamanı
  transactionHash?: string; // İşlem hash'i (mesaj gönderilirken)
  // V3 ödeme bilgileri
  requiredPayment?: bigint;
  paidAmount?: bigint;
  conditionType?: number; // 0: TIME_LOCK, 1: PAYMENT
  paymentTxHash?: string; // Ödeme yapıldığında transaction hash
  // Dosya desteği
  contentType?: number; // 0: TEXT, 1: IPFS_HASH, 2: ENCRYPTED
  fileMetadata?: {
    name: string;
    size: number;
    type: string;
  };
}

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'info' | 'warning';
}

async function fetchMessage(
  client: PublicClient,
  contractAddress: `0x${string}`,
  contractAbi: any, // Type union çok karmaşık, any kullan
  id: bigint,
  userAddress: string,
  account?: `0x${string}`,
  isV3?: boolean // V3 contract mu?
): Promise<MessageViewModel | null> {
  try {
    // getMessage() ile full message data al
    const messageData = await client.readContract({
      address: contractAddress,
      abi: contractAbi,
      functionName: "getMessage",
      args: [id]
    }) as any;

    // getMessageFinancialView() ile financial data al
    const financialData = await client.readContract({
      address: contractAddress,
      abi: contractAbi,
      functionName: "getMessageFinancialView",
      args: [id]
    }) as any;

    // Parse message data (struct)
    const sender = messageData.sender || messageData[0];
    const receiver = messageData.receiver || messageData[1];
    const createdAt = messageData.createdAt || messageData[8];
    const revoked = messageData.revoked || messageData[9];

    // Parse financial data (struct)
    const unlockTime = financialData.unlockTime || 0n;
    const requiredPayment = financialData.requiredPayment || 0n;
    const paidAmount = financialData.paidAmount || 0n;
    const conditionMask = financialData.conditionMask || 0;
    const isUnlocked = financialData.isUnlocked || false;

    const now = BigInt(Math.floor(Date.now() / 1000));
    const unlocked = isUnlocked;
    const isSent = sender.toLowerCase() === userAddress.toLowerCase();

    let content: string | null = null;
    if (unlocked && !isSent) {
      content = "[Click to read message]";
    }

    // Tarih formatlaması
    const unlockDate = dayjs(Number(unlockTime) * 1000);
    const relative = unlocked ? "Opened" : unlockDate.fromNow();

    return {
      id,
      sender,
      receiver,
      unlockTime,
      unlockDate: unlockDate.format("DD MMM YYYY HH:mm"),
      relative,
      unlocked,
      content,
      isRead: false, // SealedMessage'da isRead yok
      isSent,
      timestamp: createdAt,
      requiredPayment,
      paidAmount,
      conditionType: conditionMask,
      contentType: undefined,
      fileMetadata: undefined
    };
  } catch (err: any) {
    // Authorization hatası durumunda null dön (bu mesaj kullanıcıya ait değil)
    if (err.message?.includes("Not authorized")) {
      console.warn(`Mesaj #${id} için yetki yok, atlaniyor...`);
      return null;
    }
    // Diğer hatalar için throw et
    console.error(`❌ fetchMessage error for #${id}:`, err);
    throw err;
  }
}

// Transaction hash'lerini event log'larından çek
async function fetchTransactionHashes(
  client: PublicClient,
  contractAddress: `0x${string}`,
  contractAbi: any,
  messageIds: bigint[]
): Promise<Map<string, { sentTxHash?: string; paymentTxHash?: string }>> {
  const txHashMap = new Map<string, { sentTxHash?: string; paymentTxHash?: string }>();
  
  if (messageIds.length === 0) return txHashMap;

  try {
    const messageStoredEvent = contractAbi.find((item: any) => item.type === "event" && item.name === "MessageStored");
    const messagePaidEvent = contractAbi.find((item: any) => item.type === "event" && item.name === "MessagePaid");

    if (!messageStoredEvent || !messagePaidEvent) {
      throw new Error("Required contract events are missing from ABI");
    }

    // Son bloğu al
    const latestBlock = await client.getBlockNumber();
    
    // Son 10000 bloğu tara (yeni contract için yeterli)
    // Daha eski mesajlar için gerekirse artırılabilir
    const LOOKBACK_BLOCKS = 10000n;
    const startBlock = latestBlock > LOOKBACK_BLOCKS ? latestBlock - LOOKBACK_BLOCKS : 0n;
    
    // Block range'i parçalara böl (Scroll Sepolia için max 5000 block)
    const BLOCK_CHUNK_SIZE = 5000n;
    const chunks: Array<{ from: bigint; to: bigint }> = [];
    
    for (let from = startBlock; from <= latestBlock; from += BLOCK_CHUNK_SIZE) {
      const to = from + BLOCK_CHUNK_SIZE - 1n > latestBlock 
        ? latestBlock 
        : from + BLOCK_CHUNK_SIZE - 1n;
      chunks.push({ from, to });
    }


    // MessageStored event'lerini chunk chunk çek
    for (const chunk of chunks) {
      try {
        const sentLogs = await client.getLogs({
          address: contractAddress,
          event: messageStoredEvent as any,
          fromBlock: chunk.from,
          toBlock: chunk.to
        });

        // MessageStored event'lerinden transaction hash'leri çıkar
        sentLogs.forEach((log: any) => {
          const messageId = log.args?.messageId?.toString();
          if (messageId && messageIds.some(id => id.toString() === messageId)) {
            const existing = txHashMap.get(messageId) || {};
            txHashMap.set(messageId, { 
              ...existing, 
              sentTxHash: log.transactionHash 
            });
          }
        });
        
      } catch (chunkErr) {
        console.warn(`⚠️ Error fetching MessageStored logs for blocks ${chunk.from}-${chunk.to}:`, chunkErr);
      }
    }

    // MessagePaid event'lerini çek (ödeme yapılırken)
    for (const chunk of chunks) {
      try {
        const paymentLogs = await client.getLogs({
          address: contractAddress,
          event: messagePaidEvent as any,
          fromBlock: chunk.from,
          toBlock: chunk.to
        });

        paymentLogs.forEach((log: any) => {
          const messageId = log.args?.messageId?.toString();
          if (messageId && messageIds.some(id => id.toString() === messageId)) {
            const existing = txHashMap.get(messageId) || {};
            txHashMap.set(messageId, { 
              ...existing, 
              paymentTxHash: log.transactionHash 
            });
          }
        });
        
      } catch (chunkErr) {
        // MessagePaid event yoksa veya hata varsa (sessiz geç)
      }
    }
    

  } catch (err) {
    console.error('❌ fetchTransactionHashes error:', err);
  }

  return txHashMap;
}

export function MessageList({ refreshKey }: MessageListProps) {
  const client = usePublicClient();
  const { address: userAddress } = useAccount();
  const { chain } = useNetwork();
  const contractAddress = useContractAddress();
  const hasContract = useHasContract();
  
  // Artık sadece Sealed kullanıyoruz
  const isSealedContract = true;
  
  // Sealed ABI kullan
  const contractAbi = sealedMessageAbi;
  
  const [items, setItems] = useState<MessageViewModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [mounted, setMounted] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [unlockedMessageIds, setUnlockedMessageIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'unread' | 'unlocked' | 'locked' | 'paid' | 'unpaid' | 'pending' | 'files'>('all');
  const [hiddenMessages, setHiddenMessages] = useState<Set<string>>(() => {
    // Load from localStorage on mount
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('hiddenMessages');
      if (saved) {
        try {
          return new Set(JSON.parse(saved));
        } catch {
          return new Set();
        }
      }
    }
    return new Set();
  });
  const AUTO_REFRESH_SECONDS = 300;
  const [autoRefreshSecondsLeft, setAutoRefreshSecondsLeft] = useState<number>(AUTO_REFRESH_SECONDS);
  const autoRefreshLabel = useMemo(() => {
    const minutes = Math.floor(autoRefreshSecondsLeft / 60);
    const seconds = autoRefreshSecondsLeft % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }, [autoRefreshSecondsLeft]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Save hidden messages to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('hiddenMessages', JSON.stringify(Array.from(hiddenMessages)));
    }
  }, [hiddenMessages]);

  // Toast bildirimi göster
  const showToast = useCallback((message: string, type: 'success' | 'info' | 'warning' = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  }, []);

  const loadMessages = useCallback(async () => {
    if (!client || !hasContract || !contractAddress || !userAddress) {
      return;
    }

    setLoading(true);
    setError(null);
    setAutoRefreshSecondsLeft(AUTO_REFRESH_SECONDS);

    try {
      // SealedMessage contract için tek yükleme stratejisi
      if (isSealedContract) {
        // SealedMessage contract: messageCount ile iterate et
        try {
          const messageCountResult = await client.readContract({
            address: contractAddress,
            abi: contractAbi as any,
            functionName: "messageCount",
            args: []
          });
          
          const messageCount = Number(messageCountResult);
          
          const allMessages: MessageViewModel[] = [];
          
          // Her mesajın metadata'sını yükle
          for (let i = 0; i < messageCount; i++) {
            try {
              // getMessage() ile full data al
              const messageData = await client.readContract({
                address: contractAddress,
                abi: contractAbi as any,
                functionName: "getMessage",
                args: [BigInt(i)]
              }) as any;

              // getMessageFinancialView() ile financial data al
              const financialData = await client.readContract({
                address: contractAddress,
                abi: contractAbi as any,
                functionName: "getMessageFinancialView",
                args: [BigInt(i)]
              }) as any;

              // Parse data
              const sender = messageData.sender || messageData[0];
              const receiver = messageData.receiver || messageData[1];
              const unlockTime = financialData.unlockTime || 0n;
              const isUnlocked = financialData.isUnlocked || false;
              const conditionMask = financialData.conditionMask || 0;
              const requiredPayment = financialData.requiredPayment || 0n;
              
              // Kullanıcının gönderdiği VEYA aldığı mesajları filtrele
              const isSender = sender.toLowerCase() === userAddress.toLowerCase();
              const isReceiver = receiver.toLowerCase() === userAddress.toLowerCase();
              
              if (isSender || isReceiver) {
                allMessages.push({
                  id: BigInt(i),
                  sender: sender,
                  receiver: receiver,
                  unlockTime: unlockTime,
                  unlockDate: dayjs.unix(Number(unlockTime)).format('YYYY-MM-DD HH:mm:ss'),
                  unlocked: isUnlocked,
                  isRead: false,
                  isSent: isSender,
                  contractAddress: contractAddress,
                  conditionType: conditionMask,
                  requiredPayment: requiredPayment,
                  contentType: 2, // ENCRYPTED
                  relative: dayjs.unix(Number(unlockTime)).fromNow(),
                  content: "[Encrypted message 🔐]"
                });
              }
            } catch (err) {
              console.warn(`⚠️ Couldn't load message ${i}:`, err);
            }
          }
          
          setItems(allMessages);
          setLastUpdated(new Date());
          setAutoRefreshSecondsLeft(AUTO_REFRESH_SECONDS);
        } catch (err) {
          console.error('❌ Error loading messages:', err);
          setError('Failed to load messages');
        }
        setLoading(false);
        return; // EXIT early - don't run V2/V3.2 code
      }
      
  // V3.2 / V2 contract için artık destek yok - sadece SealedMessage
      setItems([]);
      setLastUpdated(new Date());
      setLoading(false);

    } catch (err: any) {
      console.error("MessageList error:", err);
      setError(`Error: ${err.message || "An error occurred while loading messages"}. Please refresh the page.`);
    } finally {
      setLoading(false);
    }
  }, [client, hasContract, contractAddress, userAddress, unlockedMessageIds, showToast, AUTO_REFRESH_SECONDS]);

  useEffect(() => {
    if (mounted && client && hasContract && contractAddress && userAddress) {
      loadMessages();
    }
  }, [refreshKey, mounted, client, hasContract, contractAddress, userAddress, loadMessages]);

  useEffect(() => {
    if (!mounted || !client || !hasContract || !contractAddress || !userAddress) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setAutoRefreshSecondsLeft((prev) => {
        if (prev <= 1) {
          void loadMessages();
          return AUTO_REFRESH_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, [mounted, client, hasContract, contractAddress, userAddress, loadMessages, AUTO_REFRESH_SECONDS]);

  if (!mounted) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-sm text-slate-400">
        <p>Loading...</p>
      </div>
    );
  }

  if (!userAddress) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-sm text-slate-400">
        <p>Connect your wallet...</p>
      </div>
    );
  }

  // Warning for networks without deployed contract
  if (!hasContract || !contractAddress) {
    return (
      <div className="rounded-xl border border-orange-700/50 bg-orange-900/20 p-6 shadow-lg backdrop-blur">
        <div className="flex items-start gap-3">
          <span className="text-2xl">⚠️</span>
          <div>
            <h3 className="font-semibold text-orange-300">Contract not deployed on this network yet</h3>
            <p className="mt-2 text-sm text-orange-200/80">
              SealedMessage is active on these networks:
            </p>
            <ul className="mt-2 space-y-1 text-sm text-orange-200/80">
              <li>✅ Sepolia Testnet</li>
              <li>✅ Base Sepolia</li>
              <li>✅ Monad Testnet</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className="space-y-4">
      {/* Toast Notifications */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`
              animate-in slide-in-from-right duration-300
              rounded-lg border px-4 py-3 shadow-lg
              ${toast.type === 'success' ? 'border-green-500/50 bg-green-900/80 text-green-100' : ''}
              ${toast.type === 'info' ? 'border-blue-500/50 bg-blue-900/80 text-blue-100' : ''}
              ${toast.type === 'warning' ? 'border-yellow-500/50 bg-yellow-900/80 text-yellow-100' : ''}
            `}
          >
            {toast.message}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex flex-col">
          <h2 className="text-lg font-semibold text-aurora">Messages</h2>
          {contractAddress && (
            <p className="text-xs text-slate-400">
              Viewing data from <span className="text-sky-300 font-semibold">SealedMessage</span>
              {" "}
              (<span className="font-mono text-slate-500">{`${contractAddress.slice(0, 6)}…${contractAddress.slice(-4)}`}</span>)
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadMessages}
            disabled={loading}
            className="
              rounded-lg border border-aurora/40 bg-aurora/10 px-4 py-2 text-sm text-aurora 
              transition-all hover:bg-aurora/20 hover:border-aurora/60
              disabled:opacity-50 disabled:cursor-not-allowed
            "
          >
            {loading ? "⟳" : `Refresh (auto in ${autoRefreshLabel})`}
          </button>
          
          {/* 🗑️ Cache Temizleme Butonu */}
          <button
            onClick={() => {
              // Eski contract cache'lerini temizle
              const keys = Object.keys(localStorage);
              const msgKeys = keys.filter(k => k.includes('-msg-') || k.startsWith('msg-'));
              msgKeys.forEach(k => localStorage.removeItem(k));
              showToast(`🗑️ ${msgKeys.length} cache entry cleared`, 'success');
              setTimeout(() => loadMessages(), 500);
            }}
            className="
              rounded-lg border border-red-500/40 bg-red-900/20 px-4 py-2 text-sm text-red-300 
              transition-all hover:bg-red-900/30 hover:border-red-500/60
            "
            title="Eski contract cache'lerini temizle"
          >
            🗑️ Clear Cache
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/50 bg-red-900/20 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Filter Buttons */}
      <div className="flex gap-2 flex-wrap items-center">
        <span className="text-xs text-slate-400 mr-2">Filter:</span>
        {['all', 'unread', 'locked', 'unlocked', 'pending', 'paid', 'unpaid', 'files'].map((filterOption) => (
          <button
            key={filterOption}
            onClick={() => setFilter(filterOption as any)}
            className={`
              px-3 py-1.5 rounded-lg text-xs font-medium transition-all
              ${filter === filterOption 
                ? 'bg-aurora text-white shadow-lg shadow-aurora/20' 
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
              }
            `}
          >
            {filterOption === 'all' && '📋 All'}
            {filterOption === 'unread' && '🆕 Unread'}
            {filterOption === 'locked' && '🔒 Locked'}
            {filterOption === 'unlocked' && '🔓 Unlocked'}
            {filterOption === 'pending' && '⏳ Pending'}
            {filterOption === 'paid' && '✅ Paid'}
            {filterOption === 'unpaid' && '❌ Unpaid'}
            {filterOption === 'files' && '📎 Files'}
          </button>
        ))}
        {hiddenMessages.size > 0 && (
          <button
            onClick={() => setHiddenMessages(new Set())}
            className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 transition-all"
          >
            🔄 Show Hidden ({hiddenMessages.size})
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-aurora border-t-transparent"></div>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-center text-sm text-slate-300">
          <p className="mb-2 text-4xl">📭</p>
          <p>No messages yet.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {items
            .filter((item) => {
              // Filter by hidden status
              if (hiddenMessages.has(item.id.toString())) return false;
              
              // Filter by type
              if (filter === 'all') return true;
              
              // Unread: Unlocked ve henüz okunmamış (sadece alıcılar için)
              if (filter === 'unread') return !item.isSent && item.unlocked && !item.isRead;
              
              // Locked: Henüz unlock olmamış
              if (filter === 'locked') return !item.unlocked;
              
              // Unlocked: Unlock olmuş
              if (filter === 'unlocked') return item.unlocked;
              
              // Pending: Time-locked ve süresi dolmamış (alıcı için)
              if (filter === 'pending') {
                return !item.isSent && !item.unlocked && item.conditionType === 0 && item.unlockTime > BigInt(Math.floor(Date.now() / 1000));
              }
              
              // Paid: Payment-locked VE ödeme yapılmış (paidAmount > 0)
              if (filter === 'paid') {
                return item.conditionType === 1 && item.paidAmount && item.paidAmount > 0n;
              }
              
              // Unpaid: Payment-locked ANCAK henüz ödeme yapılmamış
              if (filter === 'unpaid') {
                return item.conditionType === 1 && (!item.paidAmount || item.paidAmount === 0n);
              }
              
              // Files: IPFS dosya içeren
              if (filter === 'files') return item.contentType === 1;
              
              return true;
            })
            .sort((a, b) => {
              // Sort by message ID descending (newest first)
              return Number(b.id) - Number(a.id);
            })
            .map((item, index) => {
            // Safeguard: undefined değerleri kontrol et (0n geçerli!)
            if (item.id === undefined || item.unlockTime === undefined) {
              console.warn('⚠️ Invalid message item:', item);
              return null;
            }
            return (
              <MessageCard
                key={`msg-${item.id.toString()}-${item.unlockTime.toString()}-${item.isSent ? 's' : 'r'}-${index}`}
                id={item.id}
                sender={item.sender}
                receiver={item.receiver}
                unlockTime={item.unlockTime}
                unlockDate={item.unlockDate}
                unlocked={item.unlocked}
                isRead={item.isRead}
                isSent={item.isSent}
                index={index}
                contractAddress={item.contractAddress} // ✅ Contract address geç
                requiredPayment={item.requiredPayment}
                paidAmount={item.paidAmount}
                conditionType={item.conditionType}
                transactionHash={item.transactionHash}
                paymentTxHash={item.paymentTxHash}
                contentType={item.contentType}
                onHide={() => {
                  const newHidden = new Set(hiddenMessages);
                  newHidden.add(item.id.toString());
                  setHiddenMessages(newHidden);
                  // Save to localStorage
                  localStorage.setItem('hiddenMessages', JSON.stringify(Array.from(newHidden)));
                }}
                // onMessageRead kaldırıldı - mesaj okununca sayfayı yenilemesin
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
