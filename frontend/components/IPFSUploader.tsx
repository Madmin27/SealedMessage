"use client";

import { useState, useRef } from "react";

interface IPFSUploaderProps {
  onUploadComplete: (hash: string) => void;
  onError?: (error: string) => void;
}

export function IPFSUploader({ onUploadComplete, onError }: IPFSUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileType, setFileType] = useState<"image" | "video" | "file" | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const detectFileType = (file: File): "image" | "video" | "file" => {
    if (file.type.startsWith("image/")) return "image";
    if (file.type.startsWith("video/")) return "video";
    return "file";
  };

  const uploadToIPFS = async (file: File) => {
    setUploading(true);
    
    try {
      // Pinata (ücretsiz IPFS pinning servisi) kullanacağız
      // Alternatif: web3.storage, nft.storage, Infura IPFS
      const formData = new FormData();
      formData.append("file", file);

      // Pinata API kullanımı (ücretsiz plan: 1GB)
      const pinataApiKey = process.env.NEXT_PUBLIC_PINATA_API_KEY;
      const pinataSecretKey = process.env.NEXT_PUBLIC_PINATA_SECRET_KEY;

      if (!pinataApiKey || !pinataSecretKey) {
        throw new Error("IPFS credentials not configured");
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
        throw new Error(`Upload failed: ${response.statusText}`);
      }

  const data = await response.json();
  const ipfsHash = data.IpfsHash;

  onUploadComplete(ipfsHash);

      return ipfsHash;
    } catch (error) {
      console.error("IPFS upload error:", error);
      const errorMsg = error instanceof Error ? error.message : "Upload failed";
      onError?.(errorMsg);
      throw error;
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // File size check (max 100MB)
    if (file.size > 100 * 1024 * 1024) {
      onError?.("File too large. Max size: 100MB");
      return;
    }

    const type = detectFileType(file);
    setFileType(type);

    // Create preview
    if (type === "image" || type === "video") {
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      setPreview(null);
    }

    // Upload to IPFS
    await uploadToIPFS(file);
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFileChange}
        className="hidden"
        accept="image/*,video/*,.pdf,.doc,.docx,.txt"
      />

      {!preview && (
        <button
          type="button"
          onClick={handleClick}
          disabled={uploading}
          className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-cyber-blue/40 bg-midnight/40 px-4 py-8 text-text-light transition hover:border-cyber-blue hover:bg-midnight/60 disabled:opacity-50"
        >
          {uploading ? (
            <>
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-cyber-blue border-t-transparent"></div>
              <span className="text-sm">Uploading to IPFS...</span>
            </>
          ) : (
            <>
              <span className="text-2xl">📁</span>
              <span className="text-sm">Click to upload file (max 100MB)</span>
            </>
          )}
        </button>
      )}

      {preview && fileType === "image" && (
        <div className="relative rounded-lg overflow-hidden border border-neon-green/40">
          <img
            src={preview}
            alt="Preview"
            className="w-full h-auto max-h-64 object-contain bg-midnight/60"
          />
          <button
            type="button"
            onClick={() => {
              setPreview(null);
              setFileType(null);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
            className="absolute top-2 right-2 rounded-full bg-red-500 px-3 py-1 text-xs text-white hover:bg-red-600"
          >
            Remove
          </button>
        </div>
      )}

      {preview && fileType === "video" && (
        <div className="relative rounded-lg overflow-hidden border border-neon-green/40">
          <video
            src={preview}
            controls
            className="w-full h-auto max-h-64 bg-midnight/60"
          />
          <button
            type="button"
            onClick={() => {
              setPreview(null);
              setFileType(null);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
            className="absolute top-2 right-2 rounded-full bg-red-500 px-3 py-1 text-xs text-white hover:bg-red-600"
          >
            Remove
          </button>
        </div>
      )}

      {fileType === "file" && !preview && (
        <div className="rounded-lg border border-neon-green/40 bg-neon-green/10 p-4">
          <p className="text-sm text-neon-green">✅ File uploaded to IPFS</p>
        </div>
      )}
    </div>
  );
}
