import React from 'react';
import { MessagePreviewData, formatFileSize, getFileTypeIcon } from '@/types/message';

interface MessagePreviewProps {
  preview: MessagePreviewData;
  isExpanded?: boolean;
}

export const MessagePreview: React.FC<MessagePreviewProps> = ({ preview, isExpanded = false }) => {
  return (
    <div className="message-preview border-l-4 border-blue-500 pl-3 py-2 bg-gray-50 rounded">
      {/* Content Type Indicator */}
      <div className="flex items-center gap-2 mb-2">
        {preview.contentType === 'text' && <span className="text-lg">💬</span>}
        {preview.contentType === 'image' && <span className="text-lg">🖼️</span>}
        {preview.contentType === 'file' && <span className="text-lg">📎</span>}
        {preview.contentType === 'mixed' && <span className="text-lg">📦</span>}
        
        <span className="text-xs font-medium text-gray-600">
          {preview.contentType === 'text' && 'Text Message'}
          {preview.contentType === 'image' && 'Image'}
          {preview.contentType === 'file' && 'File Attachment'}
          {preview.contentType === 'mixed' && 'Message with Attachments'}
        </span>
      </div>

      {/* Thumbnail (if available) */}
      {preview.thumbnail && (
        <div className="mb-2">
          <img 
            src={preview.thumbnail} 
            alt="Preview" 
            className="w-10 h-10 object-cover rounded border border-gray-300"
            style={{ imageRendering: 'pixelated' }}
            title="25×25 preview thumbnail"
          />
        </div>
      )}

      {/* Preview Text */}
      {preview.previewText && preview.isUnlocked && (
        <p className="text-sm text-gray-700 italic mb-2">
          &ldquo;{preview.previewText}&rdquo;
        </p>
      )}
      {!preview.isUnlocked && (
        <p className="text-sm text-gray-500 italic mb-2">
          🔒 Encrypted content. Unlock to view.
        </p>
      )}

      {/* Attachment Info */}
      {preview.hasAttachment && (
        <div className="flex items-center gap-3 text-xs text-gray-600">
          <span className="flex items-center gap-1">
            📎 {preview.fileCount || 1} {preview.fileCount === 1 ? 'file' : 'files'}
          </span>
          {preview.totalSize && (
            <span className="flex items-center gap-1">
              💾 {formatFileSize(preview.totalSize)}
            </span>
          )}
        </div>
      )}

      {/* Status Badges */}
      <div className="flex gap-2 mt-2">
        {preview.isUnlocked && (
          <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">
            🔓 Unlocked
          </span>
        )}
        {preview.isRead && (
          <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
            ✓ Read
          </span>
        )}
      </div>
    </div>
  );
};

interface AttachmentBadgeProps {
  fileName: string;
  fileSize: number;
  mimeType: string;
  thumbnail?: string;
  onRemove?: () => void;
}

export const AttachmentBadge: React.FC<AttachmentBadgeProps> = ({ 
  fileName, 
  fileSize, 
  mimeType, 
  thumbnail,
  onRemove 
}) => {
  const icon = getFileTypeIcon(mimeType);
  
  return (
    <div className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg shadow-sm">
      {/* Thumbnail or Icon */}
      {thumbnail ? (
        <img 
          src={thumbnail} 
          alt={fileName} 
          className="w-8 h-8 object-cover rounded"
        />
      ) : (
        <span className="text-2xl">{icon}</span>
      )}
      
      {/* File Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">
          {fileName}
        </p>
        <p className="text-xs text-gray-500">
          {formatFileSize(fileSize)}
        </p>
      </div>
      
      {/* Remove Button */}
      {onRemove && (
        <button
          onClick={onRemove}
          className="ml-2 text-red-500 hover:text-red-700 transition-colors"
          type="button"
        >
          ✕
        </button>
      )}
    </div>
  );
};
