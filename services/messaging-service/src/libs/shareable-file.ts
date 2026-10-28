const SHARE_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'application/pdf',
  'text/csv',
  'application/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

const SHARE_MAX_SIZE = 2 * 1024 * 1024;
const SHARE_EXT = /\.(pdf|png|jpe?g|docx?|pptx|xlsx?|csv)$/i;

export function shareFileRejection(file: { mimetype?: string; originalname?: string; size: number }): string | null {
  const mime = (file.mimetype || '').toLowerCase();
  if (mime.startsWith('audio/') && /^voice-/i.test(file.originalname || '')) return null;
  const unknown = mime === '' || mime === 'text/plain' || mime === 'application/octet-stream';
  const allowed = SHARE_MIME.has(mime) || (unknown && SHARE_EXT.test(file.originalname || ''));
  if (!allowed) {
    return 'Only PDF, PNG, JPEG, Word, PowerPoint, Excel, and CSV files can be shared.';
  }
  if (file.size > SHARE_MAX_SIZE) {
    return `File "${file.originalname || 'file'}" is too large. Maximum size is 2MB`;
  }
  return null;
}
