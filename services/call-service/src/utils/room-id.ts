export const conversationRoomId = (conversationId: string): string => `conv:${conversationId}`;

export const isConversationRoom = (roomId: string): boolean => roomId.startsWith('conv:');

export const conversationIdFromRoom = (roomId: string): string | null =>
  isConversationRoom(roomId) ? roomId.slice(5) : null;
