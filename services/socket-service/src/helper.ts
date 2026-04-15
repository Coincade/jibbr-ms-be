import { ZodError } from 'zod';
import ejs from 'ejs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import moment from 'moment';
import prisma from './config/database.js';

export const formatError = (error: ZodError) => {
  const errors: any = {};

  error.errors?.forEach((issue) => {
    errors[issue.path?.[0]] = issue.message;
  });
  return errors;
};

export const renderEmailEjs = async (
  fileName: string,
  payload: any
): Promise<string> => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const html: string = await ejs.renderFile(
    __dirname + `/views/emails/${fileName}.ejs`,
    payload
  );
  return html;
};

export const checkDateHourDiff = (date: Date | string): number => {
  const now = moment();
  const tokenSendAt = moment(date);
  const difference = moment.duration(now.diff(tokenSendAt)).asHours();
  return difference;
};

export const isFileAttachmentsEnabledForChannel = async (
  channelId: string
): Promise<boolean> => {
  try {
    const channel = await prisma.channel.findUnique({
      where: {
        id: channelId,
        deletedAt: null,
      },
      select: {
        workspace: {
          select: {
            fileAttachmentsEnabled: true,
          },
        },
      },
    });

    return channel?.workspace?.fileAttachmentsEnabled ?? true;
  } catch (error) {
    console.error(
      'Error checking file attachments setting for channel:',
      error
    );
    return true;
  }
};

export const isFileAttachmentsEnabledForConversation = async (
  conversationId: string
): Promise<boolean> => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: {
        id: conversationId,
      },
      select: {
        workspace: {
          select: {
            fileAttachmentsEnabled: true,
          },
        },
      },
    });

    return conversation?.workspace?.fileAttachmentsEnabled ?? true;
  } catch (error) {
    console.error(
      'Error checking file attachments setting for conversation:',
      error
    );
    return true;
  }
};

/**
 * Check if a user can send file attachments to a channel.
 * Admins and moderators can send attachments even when file attachments are disabled.
 */
export const canUserSendAttachmentsToChannel = async (
  channelId: string,
  userId: string
): Promise<boolean> => {
  try {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId, deletedAt: null },
      select: {
        workspaceId: true,
        workspace: { select: { fileAttachmentsEnabled: true } },
      },
    });
    if (!channel) return true;
    if (channel.workspace.fileAttachmentsEnabled) return true;

    const member = await prisma.member.findFirst({
      where: { workspaceId: channel.workspaceId, userId, isActive: true },
      select: { role: true },
    });
    return member?.role === 'ADMIN' || member?.role === 'MODERATOR';
  } catch (error) {
    console.error('Error checking canUserSendAttachmentsToChannel:', error);
    return true;
  }
};

/**
 * Check if a user can send file attachments to a conversation (DM).
 * Admins and moderators can send attachments even when file attachments are disabled.
 */
export const canUserSendAttachmentsToConversation = async (
  conversationId: string,
  userId: string
): Promise<boolean> => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        workspaceId: true,
        workspace: { select: { fileAttachmentsEnabled: true } },
      },
    });
    if (!conversation) return true;
    if (conversation.workspace.fileAttachmentsEnabled) return true;

    const member = await prisma.member.findFirst({
      where: { workspaceId: conversation.workspaceId, userId, isActive: true },
      select: { role: true },
    });
    return member?.role === 'ADMIN' || member?.role === 'MODERATOR';
  } catch (error) {
    console.error('Error checking canUserSendAttachmentsToConversation:', error);
    return true;
  }
};

export const isTownhallChannelName = (name?: string | null): boolean => {
  return (name ?? '').trim().toLowerCase() === 'townhall';
};

export const canUserForwardInTownhall = async (
  workspaceId: string,
  userId: string
): Promise<boolean> => {
  try {
    const member = await prisma.member.findFirst({
      where: { workspaceId, userId, isActive: true },
      select: { role: true },
    });
    return member?.role === 'ADMIN' || member?.role === 'MODERATOR';
  } catch (error) {
    console.error('Error checking canUserForwardInTownhall:', error);
    return false;
  }
};


