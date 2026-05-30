/**
 * Public Preview System for V5-Secure Messages
 *
 * These data structures are stored UNENCRYPTED on IPFS so anyone can
 * see a rich preview before deciding to unlock/decrypt a message.
 */

export type PublicPreviewData = {
  version: 1;
  /** "text" | "text+file" | "text+image" */
  type: "text" | "text+file" | "text+image";
  /** Character count of the encrypted message body */
  messageLength: number;
  /** Optional file attachment info (public) */
  fileInfo?: {
    name: string;
    size: number;
    mimeType: string;
  };
  /** IPFS CID of a tiny thumbnail (for images) */
  thumbnailCid?: string;
};

/**
 * Get a human-readable file-type label like "📦 ZIP", "🖼️ JPEG", "📄 PDF"
 */
export function getFileTypeLabel(mimeType: string, _fileName?: string): string {
  const mt = mimeType.toLowerCase();
  if (mt.startsWith("image/")) {
    const ext = mt.replace("image/", "").toUpperCase();
    return `🖼️ ${ext === "jpeg" ? "JPEG" : ext === "png" ? "PNG" : ext === "gif" ? "GIF" : ext === "webp" ? "WEBP" : ext === "svg+xml" ? "SVG" : "IMG"}`;
  }
  if (mt.startsWith("video/")) return "🎥 VIDEO";
  if (mt.startsWith("audio/")) return "🎵 AUDIO";
  if (mt.includes("pdf")) return "📄 PDF";
  if (mt.includes("zip") || mt.includes("rar") || mt.includes("tar") || mt.includes("gz") || mt.includes("7z")) return "📦 ARCHIVE";
  if (mt.includes("word") || mt.includes("document") || mt.includes("msword")) return "📝 DOC";
  if (mt.includes("sheet") || mt.includes("excel") || mt.includes("spreadsheet")) return "📊 XLS";
  if (mt.includes("presentation") || mt.includes("powerpoint") || mt.includes("slides")) return "📽️ PPT";
  const ext = _fileName?.split(".").pop()?.toUpperCase();
  if (ext === "EXE") return "⚙️ EXE";
  if (ext === "DLL") return "🔧 DLL";
  if (ext === "ISO") return "💿 ISO";
  if (ext === "TORRENT") return "🧲 TORRENT";
  return `📎 ${ext || "FILE"}`;
}

/**
 * Generate a short (≤120 chars) public preview text from message content + optional file.
 * This replaces the old manual publicNote input.
 */
export function generatePreviewText(content: string, file: File | null): string {
  const msgLen = content.trim().length;

  if (!file) {
    return `📝 ${msgLen} chars`;
  }

  const fileLabel = getFileTypeLabel(file.type, file.name);
  const sizeStr = formatSizeShort(file.size);
  const namePart = file.name.length > 20 ? file.name.slice(0, 17) + "…" : file.name;

  // Keep the total under 120 chars
  const preview = `📝 ${msgLen} chars + ${fileLabel} ${namePart} (${sizeStr})`;
  return preview.length > 120 ? preview.slice(0, 117) + "…" : preview;
}

/**
 * Format file size in a short human-readable form.
 */
export function formatSizeShort(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Determine if a file is an image type.
 */
export function isImageFile(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith("image/");
}

/**
 * Get the category string for PublicPreviewData.type.
 */
export function getPreviewType(file: File | null): "text" | "text+file" | "text+image" {
  if (!file) return "text";
  return isImageFile(file.type) ? "text+image" : "text+file";
}

/**
 * Generate a tiny thumbnail Blob (maxSize × maxSize, JPEG) from an image File.
 * Returns null if the file isn't an image or processing fails.
 */
export async function generateThumbnailBlob(
  imageFile: File,
  maxSize = 50
): Promise<Blob | null> {
  if (!isImageFile(imageFile.type)) return null;

  try {
    const buffer = await imageFile.arrayBuffer();
    const blob = new Blob([buffer], { type: imageFile.type });
    const url = URL.createObjectURL(blob);

    const result = await new Promise<Blob | null>((resolve) => {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);

        // Compute thumbnail dimensions preserving aspect ratio
        let { width, height } = img;
        if (width > height) {
          if (width > maxSize) {
            height = Math.round((height * maxSize) / width);
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width = Math.round((width * maxSize) / height);
            height = maxSize;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(null); return; }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (thumbBlob) => resolve(thumbBlob),
          "image/jpeg",
          0.6
        );
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });

    return result;
  } catch {
    return null;
  }
}
