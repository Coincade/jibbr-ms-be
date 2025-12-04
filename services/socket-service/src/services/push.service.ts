import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import prisma from '../config/database.js';

const expo = new Expo({
  accessToken: process.env.EXPO_ACCESS_TOKEN,
});

interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, any>;
}

export class PushService {
  private static chunkAndSend = async (messages: ExpoPushMessage[]) => {
    const chunks = expo.chunkPushNotifications(messages);

    for (const chunk of chunks) {
      try {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        PushService.handleTickets(chunk, tickets);
      } catch (error) {
        console.error(
          '[PushService] Error sending push notification chunk:',
          error
        );
      }
    }
  };

  private static handleTickets = async (
    messages: ExpoPushMessage[],
    tickets: ExpoPushTicket[]
  ) => {
    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      const token = messages[i]?.to;

      if (ticket.status === 'error' && token && typeof token === 'string') {
        console.error(
          '[PushService] Push ticket error:',
          ticket.details || ticket.message
        );

        const error = ticket.details?.error;
        if (
          error === 'DeviceNotRegistered' ||
          error === 'MessageRateExceeded' ||
          error === 'InvalidCredentials'
        ) {
          await prisma.userPushToken.deleteMany({
            where: { token },
          });
        }
      }
    }
  };

  static async sendToTokens(tokens: string[], payload: PushPayload) {
    const messages: ExpoPushMessage[] = [];

    for (const token of tokens) {
      if (!Expo.isExpoPushToken(token)) {
        console.warn(`[PushService] Invalid Expo push token ${token}`);
        continue;
      }

      messages.push({
        to: token,
        sound: 'default',
        title: payload.title,
        body: payload.body,
        data: payload.data || {},
        priority: 'high',
        badge: 1,
        channelId: 'default',
        ttl: 86400,
      });
    }

    if (!messages.length) {
      return;
    }

    await PushService.chunkAndSend(messages);
  }

  static async sendToUser(userId: string, payload: PushPayload) {
    const tokenRecords = await prisma.userPushToken.findMany({
      where: { userId },
      select: { token: true },
    });

    if (!tokenRecords.length) {
      return;
    }

    await PushService.sendToTokens(
      tokenRecords.map((record) => record.token),
      payload
    );
  }
}

export default PushService;


