import { Queue, Worker, Job } from "bullmq";
import { defaultQueueOptions, redisConnection } from "../config/queue.js";
import { sendEmail, mailHelper } from "../config/mail.js";

export const emailQueueName = "emailQueue";

interface EmailJobDataType{
    to: string;
    subject: string;
    body: string;
}


// * Temporarily disabled to stop Redis retry errors
// * Queue
export const emailQueue = new Queue(emailQueueName, {
  connection: redisConnection,
  defaultJobOptions: defaultQueueOptions,
});

// * Worker
export const emailWorker = new Worker(
  emailQueueName,
  async (job: Job) => {
    const data: EmailJobDataType = job.data;
    await mailHelper(data.to, data.subject, data.body);
  },
  {
    connection: redisConnection,
  }
);

// * Temporary mock queue for direct email sending
// export const emailQueue = {
//   add: async (queueName: string, data: EmailJobDataType) => {
//     console.log('📧 Sending email directly (queue disabled):', data.to);
//     try {
//       await mailHelper(data.to, data.subject, data.body);
//       console.log('✅ Email sent successfully');
//     } catch (error) {
//       console.error('❌ Email sending failed:', error);
//     }
//   }
// };
