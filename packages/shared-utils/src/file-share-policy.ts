export const FILE_SHARE_TYPE_IDS = [
  'images',
  'pdf',
  'word',
  'spreadsheets',
  'presentations',
  'video',
  'other',
] as const;

export const FILE_UPLOAD_SIZE_OPTIONS = [2, 5, 10, 20] as const;

export type FileShareTypeId = (typeof FILE_SHARE_TYPE_IDS)[number];
export type FileUploadSizeMb = (typeof FILE_UPLOAD_SIZE_OPTIONS)[number];

export interface FileSharePolicy {
  maxMb: FileUploadSizeMb;
  types: FileShareTypeId[];
}

export const DEFAULT_ALLOWED_FILE_TYPES: FileShareTypeId[] = [
  'images',
  'pdf',
  'word',
  'spreadsheets',
  'presentations',
];

const TYPE_LABEL: Record<FileShareTypeId, string> = {
  images: 'Image',
  pdf: 'PDF',
  word: 'Word',
  spreadsheets: 'Spreadsheet',
  presentations: 'PowerPoint',
  video: 'Video',
  other: 'Other',
};

const EXT_TYPE: Array<{ ext: RegExp; type: FileShareTypeId }> = [
  { ext: /\.(png|jpe?g)$/i, type: 'images' },
  { ext: /\.pdf$/i, type: 'pdf' },
  { ext: /\.docx?$/i, type: 'word' },
  { ext: /\.(xlsx?|csv)$/i, type: 'spreadsheets' },
  { ext: /\.pptx?$/i, type: 'presentations' },
  { ext: /\.(mp4|m4v|mov|webm|mkv|avi|mpeg|mpg|wmv|flv|3gp|3gpp|ogv)$/i, type: 'video' },
  { ext: /\.(txt|zip)$/i, type: 'other' },
];

const MIME_TYPE: Array<{ test: (mime: string) => boolean; type: FileShareTypeId }> = [
  { test: (mime) => mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/jpg', type: 'images' },
  { test: (mime) => mime === 'application/pdf', type: 'pdf' },
  {
    test: (mime) =>
      mime === 'application/msword' ||
      mime === 'application/vnd.ms-word' ||
      mime === 'application/x-msword' ||
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    type: 'word',
  },
  {
    test: (mime) =>
      mime === 'application/vnd.ms-excel' ||
      mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mime === 'text/csv' ||
      mime === 'application/csv',
    type: 'spreadsheets',
  },
  {
    test: (mime) =>
      mime === 'application/vnd.ms-powerpoint' ||
      mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    type: 'presentations',
  },
  { test: (mime) => mime.startsWith('video/'), type: 'video' },
  {
    test: (mime) => mime === 'application/zip' || mime === 'application/x-zip-compressed',
    type: 'other',
  },
];

export function defaultFileSharePolicy(): FileSharePolicy {
  return { maxMb: 2, types: [...DEFAULT_ALLOWED_FILE_TYPES] };
}

export function isFileUploadSizeMb(value: number): value is FileUploadSizeMb {
  return (FILE_UPLOAD_SIZE_OPTIONS as readonly number[]).includes(value);
}

export function normalizeFileSharePolicy(input?: {
  fileUploadMaxMb?: number | null;
  allowedFileTypes?: string[] | null;
  maxMb?: number | null;
  types?: string[] | null;
} | null): FileSharePolicy {
  const rawMax = input?.fileUploadMaxMb ?? input?.maxMb;
  const maxMb = typeof rawMax === 'number' && isFileUploadSizeMb(rawMax) ? rawMax : 2;
  const rawTypes = input?.allowedFileTypes ?? input?.types ?? DEFAULT_ALLOWED_FILE_TYPES;
  const types = FILE_SHARE_TYPE_IDS.filter((id) => rawTypes.includes(id));
  return { maxMb, types };
}

export function mergeFileSharePolicies(policies: FileSharePolicy[]): FileSharePolicy {
  if (policies.length === 0) return defaultFileSharePolicy();
  const maxMb = FILE_UPLOAD_SIZE_OPTIONS.filter((size) =>
    policies.every((policy) => policy.maxMb >= size)
  ).pop() ?? 2;
  const types = FILE_SHARE_TYPE_IDS.filter((id) => policies.every((policy) => policy.types.includes(id)));
  return { maxMb, types };
}

function isVoiceNote(mime: string, name: string): boolean {
  return mime.startsWith('audio/') && /^voice-/i.test(name);
}

function classifyFile(mime: string, name: string): FileShareTypeId | null {
  const generic = mime === '' || mime === 'application/octet-stream' || mime === 'text/plain';
  if (generic) {
    return EXT_TYPE.find((rule) => rule.ext.test(name))?.type ?? null;
  }
  return MIME_TYPE.find((rule) => rule.test(mime))?.type ?? EXT_TYPE.find((rule) => rule.ext.test(name))?.type ?? null;
}

export function shareFileRejection(
  file: { mimetype?: string; originalname?: string; size: number },
  policy: FileSharePolicy = defaultFileSharePolicy()
): string | null {
  const mime = (file.mimetype || '').toLowerCase();
  const name = file.originalname || 'file';
  if (isVoiceNote(mime, name)) return null;

  const type = classifyFile(mime, name);
  if (!type || !policy.types.includes(type)) {
    return type
      ? `${TYPE_LABEL[type]} files can't be shared in this workspace.`
      : "This file type can't be shared in this workspace.";
  }
  if (!(file.size > 0)) return `File "${name}" is empty.`;
  const maxBytes = policy.maxMb * 1024 * 1024;
  if (file.size > maxBytes) {
    return `File "${name}" is too large. Maximum size is ${policy.maxMb}MB`;
  }
  return null;
}
