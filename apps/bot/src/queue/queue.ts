import { Queue } from 'bullmq';

import { createRedisOptions } from './redis.js';
import { JOB_NAME, QUEUE_NAME, type MessageJob } from './types.js';

export const messageQueue = new Queue<MessageJob>(QUEUE_NAME, {
  connection: createRedisOptions(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000
    },
    removeOnComplete: {
      count: 1000
    },
    removeOnFail: {
      count: 5000
    }
  }
});

export async function enqueueMessage(payload: MessageJob, jobId: string): Promise<void> {
  await messageQueue.add(JOB_NAME, payload, { jobId });
}
