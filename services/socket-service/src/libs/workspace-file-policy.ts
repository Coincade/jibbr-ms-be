import prisma from '../config/database.js';
import {
  mergeFileSharePolicies,
  normalizeFileSharePolicy,
  shareFileRejection,
  type FileSharePolicy,
} from '@jibbr/shared-utils';

const POLICY_SELECT = { fileUploadMaxMb: true, allowedFileTypes: true } as const;

export async function fileSharePolicyForChannel(channelId: string): Promise<FileSharePolicy> {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { workspace: { select: POLICY_SELECT } },
  });
  return normalizeFileSharePolicy(channel?.workspace);
}

export async function fileSharePolicyForConversation(conversationId: string): Promise<FileSharePolicy> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      workspace: { select: POLICY_SELECT },
      collaboration: {
        select: {
          workspaceA: { select: POLICY_SELECT },
          workspaceB: { select: POLICY_SELECT },
        },
      },
    },
  });
  if (!conversation) return normalizeFileSharePolicy(null);
  if (conversation.collaboration) {
    return mergeFileSharePolicies([
      normalizeFileSharePolicy(conversation.collaboration.workspaceA),
      normalizeFileSharePolicy(conversation.collaboration.workspaceB),
    ]);
  }
  return normalizeFileSharePolicy(conversation.workspace);
}

export function attachmentShareRejection(
  attachments: Array<{ mimeType?: string; originalName?: string; filename?: string; size?: number }>,
  policy: FileSharePolicy
): string | null {
  for (const attachment of attachments) {
    const rejection = shareFileRejection(
      {
        mimetype: attachment.mimeType,
        originalname: attachment.originalName || attachment.filename,
        size: typeof attachment.size === 'number' ? attachment.size : 0,
      },
      policy
    );
    if (rejection) return rejection;
  }
  return null;
}
