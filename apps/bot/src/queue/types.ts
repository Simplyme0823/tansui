export const QUEUE_NAME = 'telegram-messages';
export const JOB_NAME = 'telegram-message';

export type ChatType = 'private' | 'group' | 'supergroup' | 'channel' | string;

export type MessageJob = {
  updateId?: number;
  chatId: number;
  chatType: ChatType;
  messageId: number;
  text: string;
  fromId: number;
  fromUsername?: string;
  fromFirstName?: string;
  fromLastName?: string;
  botUsername?: string;
};
