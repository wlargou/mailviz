import {
  DocumentPdf,
  Image,
  Document,
  DataTable,
  PresentationFile,
  DocumentBlank,
  Music,
  Video,
  Zip,
  Code,
} from '@carbon/icons-react';

export interface FileTypeInfo {
  label: string;
  icon: typeof DocumentPdf;
  category: 'pdf' | 'image' | 'spreadsheet' | 'presentation' | 'document' | 'video' | 'audio' | 'archive' | 'code' | 'other';
  previewable: boolean;
}

const mimeMap: Record<string, FileTypeInfo> = {
  'application/pdf': { label: 'PDF', icon: DocumentPdf, category: 'pdf', previewable: true },
  'image/png': { label: 'PNG Image', icon: Image, category: 'image', previewable: true },
  'image/jpeg': { label: 'JPEG Image', icon: Image, category: 'image', previewable: true },
  'image/gif': { label: 'GIF Image', icon: Image, category: 'image', previewable: true },
  'image/webp': { label: 'WebP Image', icon: Image, category: 'image', previewable: true },
  'image/svg+xml': { label: 'SVG Image', icon: Image, category: 'image', previewable: true },
  'image/bmp': { label: 'BMP Image', icon: Image, category: 'image', previewable: true },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { label: 'Excel', icon: DataTable, category: 'spreadsheet', previewable: false },
  'application/vnd.ms-excel': { label: 'Excel', icon: DataTable, category: 'spreadsheet', previewable: false },
  'text/csv': { label: 'CSV', icon: DataTable, category: 'spreadsheet', previewable: false },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { label: 'PowerPoint', icon: PresentationFile, category: 'presentation', previewable: false },
  'application/vnd.ms-powerpoint': { label: 'PowerPoint', icon: PresentationFile, category: 'presentation', previewable: false },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { label: 'Word', icon: Document, category: 'document', previewable: false },
  'application/msword': { label: 'Word', icon: Document, category: 'document', previewable: false },
  'text/plain': { label: 'Text', icon: Document, category: 'document', previewable: true },
  'text/html': { label: 'HTML', icon: Code, category: 'code', previewable: false },
  'application/json': { label: 'JSON', icon: Code, category: 'code', previewable: false },
  'application/zip': { label: 'ZIP', icon: Zip, category: 'archive', previewable: false },
  'application/x-rar-compressed': { label: 'RAR', icon: Zip, category: 'archive', previewable: false },
  'application/gzip': { label: 'GZIP', icon: Zip, category: 'archive', previewable: false },
  'video/mp4': { label: 'MP4 Video', icon: Video, category: 'video', previewable: false },
  'audio/mpeg': { label: 'MP3 Audio', icon: Music, category: 'audio', previewable: false },
};

export function getFileTypeInfo(mimeType: string, filename?: string): FileTypeInfo {
  if (mimeMap[mimeType]) return mimeMap[mimeType];

  // Fallback by mime prefix
  if (mimeType.startsWith('image/')) return { label: 'Image', icon: Image, category: 'image', previewable: true };
  if (mimeType.startsWith('video/')) return { label: 'Video', icon: Video, category: 'video', previewable: false };
  if (mimeType.startsWith('audio/')) return { label: 'Audio', icon: Music, category: 'audio', previewable: false };
  if (mimeType.startsWith('text/')) return { label: 'Text', icon: Document, category: 'document', previewable: false };

  // Fallback by extension
  if (filename) {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext === 'pdf') return mimeMap['application/pdf'];
    if (['xlsx', 'xls'].includes(ext || '')) return mimeMap['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
    if (['pptx', 'ppt'].includes(ext || '')) return mimeMap['application/vnd.openxmlformats-officedocument.presentationml.presentation'];
    if (['docx', 'doc'].includes(ext || '')) return mimeMap['application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
  }

  return { label: 'File', icon: DocumentBlank, category: 'other', previewable: false };
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
