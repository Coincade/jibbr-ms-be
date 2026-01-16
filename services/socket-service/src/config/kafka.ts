import { initializeKafka, getKafkaClient } from '@jibbr/kafka-client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

// Aiven Kafka Configuration
const brokers = process.env.KAFKA_BROKERS?.split(',') || [];
const clientId = process.env.KAFKA_CLIENT_ID || 'socket-service';
const groupId = process.env.KAFKA_GROUP_ID || 'socket-service-group';

// Resolve CA certificate path
// If KAFKA_CA_CERT_PATH is set, use it (resolve relative to project root)
// Otherwise, default to project root/ca.pem
// __dirname in compiled code will be: services/socket-service/dist/config
// So we need to go up 4 levels to reach project root
let caCertPath: string;
if (process.env.KAFKA_CA_CERT_PATH) {
  if (path.isAbsolute(process.env.KAFKA_CA_CERT_PATH)) {
    caCertPath = process.env.KAFKA_CA_CERT_PATH;
  } else {
    // Relative path - resolve from project root (4 levels up from dist/config)
    const projectRoot = path.resolve(__dirname, '../../../../');
    const relativePath = process.env.KAFKA_CA_CERT_PATH.startsWith('./') 
      ? process.env.KAFKA_CA_CERT_PATH.substring(2) 
      : process.env.KAFKA_CA_CERT_PATH;
    caCertPath = path.join(projectRoot, relativePath);
  }
} else {
  // Default: project root/ca.pem (4 levels up from dist/config)
  const projectRoot = path.resolve(__dirname, '../../../../');
  caCertPath = path.join(projectRoot, 'ca.pem');
}

console.log('[Kafka Config] Resolved CA certificate path:', caCertPath);

// Aiven requires SSL and SASL authentication
const kafkaConfig = {
  brokers,
  clientId,
  groupId,
  ssl: {
    ca: caCertPath,
    rejectUnauthorized: true,
  },
  sasl: {
    mechanism: (process.env.KAFKA_SASL_MECHANISM || 'scram-sha-256') as 'plain' | 'scram-sha-256' | 'scram-sha-512',
    username: process.env.KAFKA_USERNAME || '',
    password: process.env.KAFKA_PASSWORD || '',
  },
};

// Initialize Kafka client
export const kafkaClient = initializeKafka(kafkaConfig);

// Kafka Topics
export const KAFKA_TOPICS = {
  MESSAGES: 'messages',
  NOTIFICATIONS: 'notifications',
  USER_EVENTS: 'user-events',
  WORKSPACE_EVENTS: 'workspace-events',
  CHANNEL_EVENTS: 'channel-events',
} as const;

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Kafka] SIGTERM received, disconnecting...');
  await kafkaClient.disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Kafka] SIGINT received, disconnecting...');
  await kafkaClient.disconnect();
  process.exit(0);
});
