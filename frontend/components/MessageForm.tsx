"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState, useRef } from "react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import relativeTime from "dayjs/plugin/relativeTime";
import { useAccount, usePrepareContractWrite, useContractWrite, useWaitForTransaction, useNetwork } from "wagmi";
import { chronoMessageV2Abi } from "../lib/abi-v2";
import { chronoMessageV3_2Abi } from "../lib/abi-v3.2";
import { appConfig } from "../lib/env";
import { isAddress } from "viem";
import { useContractAddress, useHasContract } from "../lib/useContractAddress";
import { useVersioning } from "./VersionProvider";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(relativeTime);

interface MessageFormProps {
  onSubmitted?: () => void;
}

export function MessageForm({ onSubmitted }: MessageFormProps) {
  const { isConnected, address: userAddress } = useAccount();
  const { chain } = useNetwork();
  const contractAddress = useContractAddress();
  const hasContract = useHasContract();
  const { getSelectedVersion } = useVersioning();
  const activeVersion = getSelectedVersion(chain?.id);

  const [receiver, setReceiver] = useState("");
  const [content, setContent] = useState("");
  const [conditionType, setConditionType] = useState<"unlock-time" | "for-fee">("unlock-time"); // Yeni: koşul tipi
  const [unlockMode, setUnlockMode] = useState<"preset" | "custom">("preset");
  const [presetDuration, setPresetDuration] = useState<number>(10); // 10 saniye (anlık mesajlaşma için)
  const [unlock, setUnlock] = useState<string>("");
  const [feeAmount, setFeeAmount] = useState<string>("0.001"); // Yeni: ücret miktarı
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [successToast, setSuccessToast] = useState(false);
  const [userTimezone, setUserTimezone] = useState<string>("UTC");
  const [selectedTimezone, setSelectedTimezone] = useState<string>("Europe/Istanbul");
  const [isPresetsOpen, setIsPresetsOpen] = useState(false); // Quick Select açık/kapalı durumu
  
  // Dosya ekleri için state
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [ipfsHash, setIpfsHash] = useState<string>("");
  const [uploadingFile, setUploadingFile] = useState(false);
  const [contentType, setContentType] = useState<0 | 1>(0); // 0=TEXT, 1=IPFS_HASH
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Form validation state
  const [isFormValid, setIsFormValid] = useState(false);

  // Prevent hydration mismatch & Set default time on client side
  useEffect(() => {
    setMounted(true);
    // Client-side'da local timezone ile default değer ata
    // datetime-local input tarayıcının lokal saatinde değer bekler
    const localTime = new Date();
    // +2 saat ekleme - şu anki saati göster
    
    // YYYY-MM-DDTHH:mm formatında lokal saat (UTC'ye çevirme!)
    const year = localTime.getFullYear();
    const month = String(localTime.getMonth() + 1).padStart(2, '0');
    const day = String(localTime.getDate()).padStart(2, '0');
    const hours = String(localTime.getHours()).padStart(2, '0');
    const minutes = String(localTime.getMinutes()).padStart(2, '0');
    const formatted = `${year}-${month}-${day}T${hours}:${minutes}`;
    
    setUnlock(formatted);
    // Kullanıcının timezone'unu al
    setUserTimezone(dayjs.tz.guess());
  }, []);

  // Unlock timestamp hesaplama (preset veya custom)
  const unlockTimestamp = useMemo(() => {
    if (unlockMode === "preset") {
      return Math.floor(Date.now() / 1000) + presetDuration;
    }
    // Custom mode: kullanıcının seçtiği timezone'da parse et
    if (!unlock) return Math.floor(Date.now() / 1000); // Boş ise şu an
    
    try {
      const parsed = dayjs.tz(unlock, selectedTimezone);
      if (!parsed.isValid()) {
        console.warn("Geçersiz tarih:", unlock);
        return Math.floor(Date.now() / 1000);
      }
      return parsed.unix();
    } catch (err) {
      console.error("Tarih parse hatası:", err);
      return Math.floor(Date.now() / 1000);
    }
  }, [unlockMode, presetDuration, unlock, selectedTimezone]);

  // Form validation
  useEffect(() => {
    let valid = false;
    
    // Ortak validationlar
    const baseValid = isConnected &&
      !!receiver &&
      isAddress(receiver) &&
      receiver.toLowerCase() !== userAddress?.toLowerCase() &&
      (content.trim().length > 0 || ipfsHash.length > 0); // Mesaj veya dosya olmalı
    
    if (conditionType === "unlock-time") {
      // TIME_LOCK: zaman gelecekte olmalı
      valid = baseValid && unlockTimestamp > Math.floor(Date.now() / 1000);
    } else if (conditionType === "for-fee") {
      // PAYMENT: ücret > 0 olmalı (zaman şartı yok)
      const fee = parseFloat(feeAmount || "0");
      valid = baseValid && fee >= 0.0001; // MIN_PAYMENT
    }
    
    setIsFormValid(valid);
  }, [isConnected, receiver, userAddress, content, unlockTimestamp, conditionType, feeAmount, ipfsHash]);
  
  // Dosya yükleme fonksiyonu
  const handleFileSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    // Dosya boyutu kontrolü (max 25MB - güvenlik için düşürüldü)
    const maxSize = 25 * 1024 * 1024; // 25MB
    if (file.size > maxSize) {
      setError(`❌ Dosya çok büyük! Maksimum: 25MB (Seçilen: ${(file.size / 1024 / 1024).toFixed(2)}MB)`);
      return;
    }
    
    // GÜVENLİK: Desteklenen dosya tipleri (beyaz liste)
    const allowedTypes = {
      // Resimler
      'image/png': '.png',
      'image/jpeg': '.jpg/.jpeg',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/svg+xml': '.svg',
      // Dökümanlar
      'application/pdf': '.pdf',
      'text/plain': '.txt',
      // Arşivler (izin verildi)
      'application/zip': '.zip',
      'application/x-rar-compressed': '.rar',
      'application/x-7z-compressed': '.7z',
      // Video (küçük boyutlar için)
      'video/mp4': '.mp4',
      'video/webm': '.webm'
      // NOT: APK kaldırıldı (güvenlik riski)
    };
    
    // GÜVENLİK: Dosya uzantısı ve MIME type kontrolü
    const fileExtension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] || '';
    const isTypeAllowed = Object.keys(allowedTypes).includes(file.type);
    
    if (!isTypeAllowed) {
      const allowedFormats = Object.values(allowedTypes).join(', ');
      setError(`❌ Desteklenmeyen dosya tipi!\n\n✅ İzin verilen formatlar:\n${allowedFormats}\n\n⚠️ Güvenlik nedeniyle sadece bu formatlar kabul edilir.`);
      return;
    }
    
    // Uzantı doğrulaması (MIME type spoofing önlemi)
    const expectedExt = allowedTypes[file.type as keyof typeof allowedTypes];
    if (expectedExt && !expectedExt.split('/').some(ext => fileExtension === ext)) {
      setError(`⚠️ Dosya uzantısı (${fileExtension}) dosya tipi ile uyuşmuyor! Olası güvenlik riski.`);
      return;
    }
    
    setAttachedFile(file);
    setError(null);
    
    // IPFS'e yükle
    await uploadToIPFS(file);
  };
  
  const uploadToIPFS = async (file: File) => {
    setUploadingFile(true);
    setError(null);
    
    try {
      // Pinata ücretsiz IPFS servisi
      const formData = new FormData();
      formData.append("file", file);
      
      // Demo için public Pinata gateway kullan (production'da kendi API key'inizi ekleyin)
      // NOT: Bu demo amaçlıdır, production için .env.local dosyasına ekleyin:
      // NEXT_PUBLIC_PINATA_API_KEY=your_key
      // NEXT_PUBLIC_PINATA_SECRET_KEY=your_secret
      
      const pinataApiKey = process.env.NEXT_PUBLIC_PINATA_API_KEY;
      const pinataSecretKey = process.env.NEXT_PUBLIC_PINATA_SECRET_KEY;
      
      if (!pinataApiKey || !pinataSecretKey) {
        throw new Error("⚠️ IPFS credentials not configured. Please add NEXT_PUBLIC_PINATA_API_KEY and NEXT_PUBLIC_PINATA_SECRET_KEY to .env.local");
      }
      
      const response = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
        method: "POST",
        headers: {
          pinata_api_key: pinataApiKey,
          pinata_secret_api_key: pinataSecretKey,
        },
        body: formData,
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Upload failed: ${errorData.error || response.statusText}`);
      }
      
      const data = await response.json();
      const hash = data.IpfsHash;
      
      console.log("✅ Uploaded to IPFS:", hash);
      setIpfsHash(hash);
      setContentType(1); // IPFS_HASH
      
      // Dosya metadata'sını delimiter ile birleştir (smart contract'ta parse edilebilir)
      // Format: hash|fileName|fileSize|fileType
      const metadata = `${hash}|${file.name}|${file.size}|${file.type}`;
      setContent(metadata); // Contract'a bu string gönderilecek
      
    } catch (err) {
      console.error("❌ IPFS upload error:", err);
      const errorMsg = err instanceof Error ? err.message : "Upload failed";
      setError(`IPFS Upload Error: ${errorMsg}`);
      setAttachedFile(null);
      setIpfsHash("");
    } finally {
      setUploadingFile(false);
    }
  };
  
  const removeAttachment = () => {
    setAttachedFile(null);
    setIpfsHash("");
    setContentType(0); // TEXT
    setContent(""); // İçeriği temizle
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Prepare contract write with proper parameters
  const shouldPrepare = isFormValid && 
    !!contractAddress && 
    !!receiver && 
    isAddress(receiver) &&
    !!content;
  // unlockTimestamp > 0 kontrolünü kaldırdık - for-fee modunda sıfır olacak

  // V3.2 için ayrı kontrol
  const isV3_2Contract = activeVersion?.key === 'v3.2';
  
  // Debug logging
  useEffect(() => {
    console.log('🔍 Contract Version Check:', {
      activeVersion: activeVersion?.key,
      isV3_2Contract,
      conditionType,
      feeAmount
    });
  }, [activeVersion, isV3_2Contract, conditionType, feeAmount]);
  
  // V2 Contract Write
  const { config: configV2 } = usePrepareContractWrite({
    address: contractAddress,
    abi: chronoMessageV2Abi,
    functionName: "sendMessage",
    args: shouldPrepare && !isV3_2Contract
      ? [receiver as `0x${string}`, content, BigInt(unlockTimestamp)]
      : undefined,
    enabled: shouldPrepare && !isV3_2Contract
  });

  // V3.2 Contract Write - TIME_LOCK mode
  const { config: configV3_2_Time } = usePrepareContractWrite({
    address: contractAddress,
    abi: chronoMessageV3_2Abi,
    functionName: "sendTimeLockedMessage",
    args: shouldPrepare && isV3_2Contract && conditionType === "unlock-time"
      ? [receiver as `0x${string}`, content, contentType, BigInt(unlockTimestamp)] // contentType eklendi
      : undefined,
    enabled: shouldPrepare && isV3_2Contract && conditionType === "unlock-time"
  });

  // V3.2 Contract Write - PAYMENT mode
  const feeInWei = feeAmount ? BigInt(Math.floor(parseFloat(feeAmount) * 1e18)) : 0n;
  
  console.log('💰 PAYMENT Mode Prepare:', {
    shouldPrepare,
    isV3_2Contract,
    conditionType,
    feeAmount,
    feeInWei: feeInWei.toString(),
    enabled: shouldPrepare && isV3_2Contract && conditionType === "for-fee" && feeInWei > 0n,
    contractAddress,
    receiver,
    content
  });
  
  const { config: configV3_2_Payment } = usePrepareContractWrite({
    address: contractAddress,
    abi: chronoMessageV3_2Abi,
    functionName: "sendPaymentLockedMessage",
    args: shouldPrepare && isV3_2Contract && conditionType === "for-fee" && feeInWei > 0n
      ? [receiver as `0x${string}`, content, contentType, feeInWei] // contentType eklendi
      : undefined,
    enabled: shouldPrepare && isV3_2Contract && conditionType === "for-fee" && feeInWei > 0n
  });

  // Write hooks
  const v2Write = useContractWrite(configV2);
  const v3_2_TimeWrite = useContractWrite(configV3_2_Time);
  const v3_2_PaymentWrite = useContractWrite(configV3_2_Payment);

  // Aktif versiyona ve condition type'a göre write fonksiyonunu seç
  let activeWrite;
  if (isV3_2Contract) {
    // V3.2: PAYMENT veya TIME_LOCK
    activeWrite = conditionType === "for-fee" ? v3_2_PaymentWrite : v3_2_TimeWrite;
    console.log('✅ Using SealedMessage v3.2:', conditionType === "for-fee" ? 'PAYMENT' : 'TIME_LOCK');
  } else {
    // V2
    activeWrite = v2Write;
    console.log('✅ Using SealedMessage v2');
  }
  
  const { data, isLoading: isPending, write } = activeWrite;
  
  const { isLoading: isConfirming, isSuccess } = useWaitForTransaction({ 
    hash: data?.hash 
  });

  // UTC ve local time gösterimi
  const unlockTimeDisplay = useMemo(() => {
    if (!mounted) return { local: "", utc: "", relative: "", selected: "" };
    
    try {
      const timestamp = unlockTimestamp * 1000;
      const localTime = dayjs(timestamp).format("DD MMM YYYY, HH:mm");
      const utcTime = dayjs(timestamp).utc().format("DD MMM YYYY, HH:mm");
      const selectedTime = dayjs(timestamp).tz(selectedTimezone).format("DD MMM YYYY, HH:mm");
      const relative = dayjs(timestamp).fromNow();
      
      return { local: localTime, utc: utcTime, selected: selectedTime, relative };
    } catch (err) {
      console.error("Tarih display hatası:", err);
      return { local: "---", utc: "---", selected: "---", relative: "---" };
    }
  }, [unlockTimestamp, mounted, selectedTimezone]);

  useEffect(() => {
    if (isSuccess) {
      console.log("✅ MessageForm: Message sent successfully");
      setReceiver("");
      setContent("");
      setAttachedFile(null);
      setIpfsHash("");
      setContentType(0);
      setError(null);
      setSuccessToast(true);
      setTimeout(() => setSuccessToast(false), 5000);
      // setTimeout ile callback'i ayır
      setTimeout(() => {
        onSubmitted?.();
      }, 100);
    }
  }, [isSuccess]); // onSubmitted'ı bağımlılıklardan kaldırdık

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    
    if (!isConnected) {
      setError("Önce cüzdanınızı bağlayın.");
      return;
    }
    if (!receiver || !isAddress(receiver)) {
      setError("Geçerli bir alıcı adresi girin.");
      return;
    }
    if (receiver.toLowerCase() === userAddress?.toLowerCase()) {
      setError("❌ Kendine mesaj gönderemezsiniz! Lütfen farklı bir alıcı adresi girin.");
      return;
    }
    if (content.trim().length === 0) {
      setError("Mesaj içeriği boş olamaz.");
      return;
    }
    
    // Validation'ı condition type'a göre yap
    if (conditionType === "unlock-time") {
      // TIME_LOCK validation
      if (unlockMode === "custom" && !dayjs(unlock).isValid()) {
        setError("Please select a valid date.");
        return;
      }
      if (unlockTimestamp <= Math.floor(Date.now() / 1000)) {
        setError("Unlock time must be in the future.");
        return;
      }
    } else if (conditionType === "for-fee") {
      // PAYMENT validation
      const fee = parseFloat(feeAmount || "0");
      if (fee < 0.0001) {
        setError("Minimum fee is 0.0001 ETH.");
        return;
      }
    }

    if (!write) {
      setError("Contract write function not available. Please check your network connection and try again.");
      return;
    }

    setError(null);
    
    try {
      write(); // No arguments needed - they're in the config from usePrepareContractWrite
    } catch (err) {
      setError(`Transaction failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  // Prevent hydration mismatch
  if (!mounted) {
    return (
      <div className="space-y-4 rounded-xl border border-cyber-blue/30 bg-midnight/80 p-6 shadow-glow-blue">
        <p className="text-sm text-text-light/60">Loading...</p>
      </div>
    );
  }

  // Connect your wallet
  if (!isConnected) {
    return (
      <div className="space-y-4 rounded-xl border border-cyber-blue/30 bg-midnight/80 p-6 shadow-glow-blue">
        <p className="text-sm text-text-light/60">Connect your wallet...</p>
      </div>
    );
  }

  // Show warning if no contract
  if (!hasContract || !contractAddress) {
    return (
      <div className="space-y-4 rounded-xl border border-orange-700/50 bg-orange-900/20 p-6 shadow-lg backdrop-blur">
        <div className="flex items-start gap-3">
          <span className="text-2xl">⚠️</span>
          <div>
            <h3 className="font-semibold text-orange-300">No Contract on This Network</h3>
            <p className="mt-2 text-sm text-orange-200/80">
              SealedMessage is not deployed on this network yet. Please select one of the supported networks:
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
    <>
      {/* Success Toast */}
      {successToast && (
        <div className="fixed top-4 right-4 z-50 animate-in slide-in-from-right duration-300">
          <div className="rounded-lg border border-green-500/50 bg-green-900/80 px-4 py-3 shadow-lg">
            <p className="text-green-100 flex items-center gap-2">
              <span>✅</span> Message sent successfully!
            </p>
          </div>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-xl border border-cyber-blue/30 bg-midnight/80 p-6 shadow-glow-blue"
      >
      {activeVersion && (
        <div className="rounded-lg border border-cyber-blue/40 bg-cyber-blue/10 px-4 py-2 text-xs text-cyber-blue">
          <p>
            Active contract: <span className="font-semibold">{activeVersion.label}</span>
            {" "}
            (<span className="font-mono">{`${activeVersion.address.slice(0, 6)}…${activeVersion.address.slice(-4)}`}</span>)
          </p>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <label htmlFor="receiver" className="text-sm font-semibold uppercase tracking-wide text-cyber-blue">
          Receiver Address
        </label>
        <input
          id="receiver"
          type="text"
          value={receiver}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setReceiver(event.target.value)}
          placeholder="0x..."
          className={`rounded-lg border px-4 py-3 font-mono text-sm text-text-light outline-none transition focus:ring-2 ${
            receiver && receiver.toLowerCase() === userAddress?.toLowerCase()
              ? 'border-red-500 bg-red-950/30 focus:border-red-500 focus:ring-red-500/60'
              : 'border-cyber-blue/40 bg-midnight/60 focus:border-cyber-blue focus:ring-cyber-blue/60'
          }`}
        />
        {receiver && receiver.toLowerCase() === userAddress?.toLowerCase() ? (
          <p className="text-xs text-red-400">
            ⚠️ Bu sizin adresiniz! Kendine mesaj gönderemezsiniz.
          </p>
        ) : (
          <p className="text-xs text-text-light/60">
            🔒 Only this address can read the message (not even the sender!)
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="content" className="text-sm font-semibold uppercase tracking-wide text-cyber-blue">
          Message
        </label>
        <textarea
          id="content"
          value={content}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setContent(event.target.value)}
          placeholder="Write and Seal"
          disabled={!!attachedFile} // Dosya ekliyse mesaj yazılamaz
          className="min-h-[120px] rounded-lg border border-cyber-blue/40 bg-midnight/60 px-4 py-3 text-text-light outline-none transition focus:border-cyber-blue focus:ring-2 focus:ring-cyber-blue/60 disabled:opacity-50 disabled:cursor-not-allowed"
        />
        
        {/* Dosya Ekleme Butonu */}
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf,text/plain,application/zip,application/x-rar-compressed,application/x-7z-compressed,video/mp4,video/webm"
            onChange={handleFileSelect}
            className="hidden"
          />
          
          {!attachedFile ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingFile}
              className="flex items-center gap-2 rounded-lg border border-purple-500/40 bg-purple-900/20 px-4 py-2 text-sm font-medium text-purple-300 transition hover:bg-purple-900/30 hover:border-purple-500/60 disabled:opacity-50"
            >
              <span>📎</span>
              {uploadingFile ? "Yükleniyor..." : "Dosya Ekle"}
            </button>
          ) : (
            <div className="flex-1 flex items-center justify-between rounded-lg border border-green-500/40 bg-green-900/20 px-4 py-2">
              <div className="flex items-center gap-2 text-sm text-green-300">
                <span>
                  {attachedFile.type.startsWith('image/') ? '🖼️' : 
                   attachedFile.type === 'application/pdf' ? '📄' :
                   attachedFile.type.startsWith('video/') ? '🎬' :
                   attachedFile.type === 'application/vnd.android.package-archive' ? '📱' : '📎'}
                </span>
                <span className="font-medium">{attachedFile.name}</span>
                <span className="text-xs text-green-400/60">
                  ({(attachedFile.size / 1024 / 1024).toFixed(2)} MB)
                </span>
                {ipfsHash && (
                  <span className="text-xs text-green-400 font-mono">
                    ✅ IPFS: {ipfsHash.slice(0, 8)}...
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={removeAttachment}
                className="text-red-400 hover:text-red-300 transition"
              >
                ❌
              </button>
            </div>
          )}
        </div>
        
        <p className="text-xs text-text-light/60">
          {attachedFile 
            ? "📎 Ekli dosya mesajınızla birlikte IPFS'e yüklendi ve blockchain'e kaydedilecek"
            : "💡 İsteğe bağlı: Resim, PDF, Video veya APK dosyası ekleyebilirsiniz (max 50MB)"
          }
        </p>
      </div>
      
      {/* Condition Type Selection - Tab Buttons */}
      <div className="flex flex-col">
        <label className="text-sm font-semibold uppercase tracking-wide text-text-light/80 mb-3">
          Unlock Condition
        </label>
        
        {/* Condition Type Tabs */}
        <div className="flex gap-0">
          <button
            type="button"
            onClick={() => setConditionType("unlock-time")}
            className={`flex-1 rounded-t-lg px-4 py-3 text-sm font-semibold transition border-t-2 border-l-2 border-r border-b-0 ${
              conditionType === "unlock-time"
                ? "bg-neon-green/20 border-neon-green text-neon-green shadow-glow-green"
                : "bg-midnight/40 border border-cyber-blue/30 text-text-light/60 hover:text-text-light"
            }`}
          >
            ⏰ Unlock Time
          </button>
          <button
            type="button"
            onClick={() => setConditionType("for-fee")}
            className={`flex-1 rounded-t-lg px-4 py-3 text-sm font-semibold transition border-t-2 border-r-2 border-l border-b-0 ${
              conditionType === "for-fee"
                ? "bg-cyan-500/20 border-cyan-400 text-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.4)]"
                : "bg-midnight/40 border border-cyber-blue/30 text-text-light/60 hover:text-text-light"
            }`}
          >
            💰 For a Fee
          </button>
        </div>

        {/* Content Area - Matches Active Tab Color */}
        <div className={`rounded-b-lg rounded-tr-lg border-2 border-t-0 p-4 transition ${
          conditionType === "unlock-time"
            ? "border-neon-green bg-neon-green/10"
            : "border-cyan-400 bg-cyan-500/10"
        }`}>
        
        {/* Unlock Time Content */}
        {conditionType === "unlock-time" && (
          <div className="flex flex-col gap-3">
        
        {/* Mode Selection */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setUnlockMode("preset");
              setIsPresetsOpen(!isPresetsOpen);
            }}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition ${
              unlockMode === "preset"
                ? "bg-aurora/20 border-2 border-aurora text-aurora"
                : "bg-midnight/40 border border-cyber-blue/30 text-text-light/60 hover:text-text-light"
            }`}
          >
            ⚡ Quick Select {unlockMode === "preset" && (isPresetsOpen ? "▼" : "▶")}
          </button>
          <button
            type="button"
            onClick={() => {
              setUnlockMode("custom");
              setIsPresetsOpen(false); // Custom'a geçince preset'leri kapat
            }}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition ${
              unlockMode === "custom"
                ? "bg-aurora/20 border-2 border-aurora text-aurora"
                : "bg-midnight/40 border border-cyber-blue/30 text-text-light/60 hover:text-text-light"
            }`}
          >
            📅 Custom Date
          </button>
        </div>

        {/* Preset Durations */}
        {unlockMode === "preset" && isPresetsOpen && (
          <div className="grid grid-cols-3 gap-2 animate-in slide-in-from-top duration-200">
            {[
              { label: "⚡ Now (10s)", value: 10 },
              { label: "30 seconds", value: 30 },
              { label: "1 minute", value: 60 },
              { label: "5 minutes", value: 300 },
              { label: "15 minutes", value: 900 },
              { label: "1 hour", value: 3600 },
              { label: "2 hours", value: 7200 },
              { label: "6 hours", value: 21600 },
              { label: "1 day", value: 86400 },
              { label: "3 days", value: 259200 },
              { label: "1 week", value: 604800 },
              { label: "1 month", value: 2592000 }
            ].map(({ label, value }) => (
              <button
                key={value}
                type="button"
                onClick={() => setPresetDuration(value)}
                className={`rounded-lg px-3 py-2 text-sm transition ${
                  presetDuration === value
                    ? "bg-neon-orange/20 border-2 border-neon-orange text-neon-orange shadow-glow-orange"
                    : "bg-midnight/40 border border-cyber-blue/30 text-text-light hover:border-cyber-blue/60"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Custom Date Picker */}
        {unlockMode === "custom" && (
          <div className="space-y-3">
            <input
              id="unlock"
              type="datetime-local"
              value={unlock}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setUnlock(event.target.value)}
              className="w-full rounded-lg border border-cyber-blue/40 bg-midnight/60 px-4 py-3 text-text-light outline-none transition focus:border-neon-orange focus:ring-2 focus:ring-neon-orange/60"
            />
            
            {/* Timezone Seçici */}
            <div className="flex flex-col gap-2">
              <label htmlFor="timezone" className="text-xs font-medium text-text-light/60">
                🌐 Saat Dilimi (Timezone)
              </label>
              <select
                id="timezone"
                value={selectedTimezone}
                onChange={(e) => setSelectedTimezone(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950/70 px-4 py-2 text-sm text-slate-100 outline-none transition focus:border-neon-orange focus:ring-2 focus:ring-neon-orange/60"
              >
                <optgroup label="🇹🇷 Türkiye">
                  <option value="Europe/Istanbul">İstanbul (UTC+3)</option>
                </optgroup>
                <optgroup label="🇪🇺 Avrupa">
                  <option value="Europe/London">London (UTC+0)</option>
                  <option value="Europe/Paris">Paris (UTC+1)</option>
                  <option value="Europe/Berlin">Berlin (UTC+1)</option>
                  <option value="Europe/Moscow">Moscow (UTC+3)</option>
                </optgroup>
                <optgroup label="🇺🇸 Amerika">
                  <option value="America/New_York">New York (UTC-5)</option>
                  <option value="America/Chicago">Chicago (UTC-6)</option>
                  <option value="America/Denver">Denver (UTC-7)</option>
                  <option value="America/Los_Angeles">Los Angeles (UTC-8)</option>
                </optgroup>
                <optgroup label="🌏 Asya">
                  <option value="Asia/Dubai">Dubai (UTC+4)</option>
                  <option value="Asia/Kolkata">Kolkata (UTC+5:30)</option>
                  <option value="Asia/Singapore">Singapore (UTC+8)</option>
                  <option value="Asia/Tokyo">Tokyo (UTC+9)</option>
                  <option value="Asia/Shanghai">Shanghai (UTC+8)</option>
                </optgroup>
                <optgroup label="🌍 Other">
                  <option value="UTC">UTC (Universal Time)</option>
                  <option value="Australia/Sydney">Sydney (UTC+10)</option>
                </optgroup>
              </select>
              <p className="text-xs text-text-light/50 italic">
                💡 The date/time you enter will be interpreted in this timezone
              </p>
            </div>
          </div>
        )}

        {/* Time Display */}
        {mounted && (
          <div className="rounded-lg bg-midnight/40 border border-cyber-blue/30 p-3 space-y-2 text-xs">
            {unlockMode === "custom" && (
              <div className="flex items-center justify-between">
                <span className="text-text-light/60">🕒 Selected Timezone:</span>
                <span className="text-sunset font-mono font-semibold">{unlockTimeDisplay.selected}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-text-light/60">🌍 Your Time:</span>
              <span className="text-slate-200 font-mono">{unlockTimeDisplay.local}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-light/60">🌐 Universal Time (UTC):</span>
              <span className="text-slate-200 font-mono">{unlockTimeDisplay.utc}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-light/60">⏱️ Time Remaining:</span>
              <span className="text-green-400 font-semibold">{unlockTimeDisplay.relative}</span>
            </div>
            <div className="pt-2 border-t border-slate-700">
              <p className="text-text-light/50 italic">
                ℹ️ Blockchain uses UTC time. The message will unlock at this UTC time regardless of the recipient's location.
              </p>
            </div>
          </div>
        )}
      </div>
        )}
        
        {/* For a Fee Content */}
        {conditionType === "for-fee" && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text-light/80">
              💰 Alıcı, mesajı açmak için belirtilen ücreti ödeyecek.
            </p>
            
            {/* V3.2 Security Notice */}
            {isV3_2Contract && (
              <div className="rounded-lg bg-green-500/10 border border-green-400/40 p-3 text-xs text-green-300">
                <p className="font-semibold">🔒 V3.2 Security Fix:</p>
                <p className="mt-1">Ücretli mesajlar <strong>sadece ödeme ile</strong> açılır. Zaman kilidi kullanılmaz.</p>
              </div>
            )}
            
            <div className="flex flex-col gap-2">
              <label htmlFor="feeAmount" className="text-sm font-semibold text-cyan-400">
                Fee Amount (in native token)
              </label>
              <input
                id="feeAmount"
                type="number"
                step="0.0001"
                min="0.0001"
                value={feeAmount}
                onChange={(e) => setFeeAmount(e.target.value)}
                placeholder="0.001 (minimum 0.0001)"
                className="rounded-lg border border-cyan-400/40 bg-midnight/60 px-4 py-3 text-text-light outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/60"
              />
              <p className="text-xs text-text-light/60">
                💡 Alıcı bu ücreti ödeyerek mesajı anında açabilir (min: 0.0001)
              </p>
            </div>
            
            <div className="rounded-lg bg-cyan-500/10 border border-cyan-400/30 p-3 text-xs text-cyan-300">
              <p>⚡ <strong>Instant Unlock:</strong> Ücret ödendiğinde mesaj hemen açılır</p>
              <p className="mt-1">🔒 <strong>Secure:</strong> Ücret akıllı kontrat tarafından yönetilir</p>
              <p className="mt-1">💸 <strong>Payment:</strong> Ödeme doğrudan size gönderilir (protokol ücreti %1)</p>
            </div>
          </div>
        )}
        
        </div>
      </div>
      
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      <button
        type="submit"
        disabled={isPending || isConfirming}
        className="w-full rounded-lg bg-gradient-to-r from-aurora via-sky-500 to-sunset px-4 py-3 text-center text-sm font-semibold uppercase tracking-widest text-slate-900 transition hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending || isConfirming ? "Sending transaction..." : "Send Message"}
      </button>
      {data?.hash ? (
        <p className="text-xs text-text-light/60">
          İşlem hash&apos;i: {data.hash.slice(0, 10)}...{data.hash.slice(-6)}
        </p>
      ) : null}
    </form>
    </>
  );
}
