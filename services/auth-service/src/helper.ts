import { ZodError } from "zod";
import ejs from "ejs";
import path from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import moment from "moment";
import prisma from "./config/database.js";

export const formatError = (error: ZodError) => {
    let errors:any = {};

    error.errors?.map((issue) => {
        errors[issue.path?.[0]] = issue.message;
    })
    return errors;
}

export const renderEmailEjs = async (fileName: string, payload: any): Promise<string> => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const html: string = await ejs.renderFile(__dirname + `/views/emails/${fileName}.ejs`, payload);
    return html;
} 

export const checkDateHourDiff = (date: Date | string,): number => {
    const now = moment();
    const tokenSendAt = moment(date);
    const difference = moment.duration(now.diff(tokenSendAt)).asHours();
    return difference;
}

/**
 * Check if file attachments are enabled for a workspace
 * @param workspaceId - The workspace ID to check
 * @returns Promise<boolean> - True if attachments are enabled, false otherwise
 */
export const isFileAttachmentsEnabled = async (workspaceId: string): Promise<boolean> => {
    try {
        const workspace = await prisma.workspace.findUnique({
            where: {
                id: workspaceId,
                isActive: true,
                deletedAt: null,
            },
            select: {
                fileAttachmentsEnabled: true,
            },
        });

        return workspace?.fileAttachmentsEnabled ?? true; // Default to true if workspace not found
    } catch (error) {
        console.error('Error checking file attachments setting:', error);
        return true; // Default to true on error
    }
}

/**
 * Check if file attachments are enabled for a channel's workspace
 * @param channelId - The channel ID to check
 * @returns Promise<boolean> - True if attachments are enabled, false otherwise
 */
export const isFileAttachmentsEnabledForChannel = async (channelId: string): Promise<boolean> => {
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

        return channel?.workspace?.fileAttachmentsEnabled ?? true; // Default to true if channel/workspace not found
    } catch (error) {
        console.error('Error checking file attachments setting for channel:', error);
        return true; // Default to true on error
    }
}

/**
 * Check if file attachments are enabled for a conversation's workspace
 * @param conversationId - The conversation ID to check
 * @returns Promise<boolean> - True if attachments are enabled for the workspace, false otherwise
 */
export const isFileAttachmentsEnabledForConversation = async (conversationId: string): Promise<boolean> => {
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
        console.error('Error checking file attachments setting for conversation:', error);
        return true; // Default to true on error
    }
}
