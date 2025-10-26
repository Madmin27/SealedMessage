export interface MessageMetadata {
  // Basic info
  version: string;
  timestamp: number;
  
  // Content info
  contentType: 'text' | 'image' | 'file' | 'mixed';
  messageText?: string;
  
  // Attachment info
  hasAttachment: boolean;
  attachments?: MessageAttachment[];
  
  // Preview data
  preview?: {
    text?: string; // First 100 chars
    thumbnail?: string; // Base64 encoded small image (5x5 or 50x50)
  };
}

export interface MessageAttachment {
  type: 'image' | 'video' | 'audio' | 'document' | 'other';
  name: string;
  size: number; // bytes
  mimeType: string;
  
  // For images
  dimensions?: {
    width: number;
    height: number;
  };
  
  // Thumbnail for visual files
  thumbnail?: string; // Base64 encoded
  
  // IPFS hash for the file (encrypted separately)
  ipfsHash?: string;
}

export interface EncryptedMessage {
  // Encrypted content
  ciphertext: Uint8Array;
  
  // Metadata (encrypted separately or stored on-chain)
  metadata: MessageMetadata;
  
  // Crypto params
  iv: Uint8Array;
  authTag: Uint8Array;
  
  // IPFS
  ipfsUri: string;
}

export interface MessagePreviewData {
  id: string;
  sender: string;
  receiver: string;
  
  // Quick info (without decrypting)
  hasAttachment: boolean;
  contentType?: string;
  fileCount?: number;
  totalSize?: number;
  
  // Visual preview (if available)
  thumbnail?: string;
  
  // Preview text (encrypted but extracted)
  previewText?: string;
  
  // Timestamps
  createdAt: number;
  unlockTime: number;
  
  // Status
  isUnlocked: boolean;
  isRead: boolean;
}

// Helper: Format file size
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Helper: Get file type icon
export function getFileTypeIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType.startsWith('video/')) return '🎥';
  if (mimeType.startsWith('audio/')) return '🎵';
  if (mimeType.startsWith('application/pdf')) return '📄';
  if (mimeType.includes('word') || mimeType.includes('document')) return '📝';
  if (mimeType.includes('sheet') || mimeType.includes('excel')) return '📊';
  if (mimeType.includes('zip') || mimeType.includes('rar')) return '📦';
  return '📎';
}

// Helper: Generate thumbnail from image
export async function generateThumbnail(
  imageFile: File, 
  maxSize: number = 50
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Calculate thumbnail dimensions (preserve aspect ratio)
        let width = img.width;
        let height = img.height;
        
        if (width > height) {
          if (width > maxSize) {
            height = (height * maxSize) / width;
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width = (width * maxSize) / height;
            height = maxSize;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        ctx?.drawImage(img, 0, 0, width, height);
        
        // Convert to base64
        const thumbnail = canvas.toDataURL('image/jpeg', 0.7);
        resolve(thumbnail);
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(imageFile);
  });
}

// Helper: Extract preview text
export function extractPreviewText(text: string, maxLength: number = 100): string {
  if (!text) return '';
  const cleaned = text.trim().replace(/\s+/g, ' ');
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.substring(0, maxLength) + '...';
}
