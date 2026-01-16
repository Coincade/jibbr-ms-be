import { Kafka, KafkaConfig, Producer, Consumer, EachMessagePayload, logLevel } from 'kafkajs';
import * as fs from 'fs';
import * as path from 'path';

export interface KafkaClientConfig {
  brokers: string[];
  clientId: string;
  groupId?: string;
  // Aiven-specific configuration
  ssl?: {
    ca?: string | Buffer;  // CA certificate path or buffer
    rejectUnauthorized?: boolean;
  };
  sasl?: {
    mechanism: 'plain' | 'scram-sha-256' | 'scram-sha-512';
    username: string;
    password: string;
  };
}

export class KafkaClient {
  private kafka: Kafka;
  private producer: Producer | null = null;
  private consumers: Map<string, Consumer> = new Map();

  constructor(config: KafkaClientConfig) {
    // Load CA certificate if provided as path
    let caCertificate: Buffer | undefined;
    if (config.ssl?.ca && typeof config.ssl.ca === 'string') {
      const caPath = path.isAbsolute(config.ssl.ca) 
        ? config.ssl.ca 
        : path.join(process.cwd(), config.ssl.ca);
      
      if (fs.existsSync(caPath)) {
        caCertificate = fs.readFileSync(caPath);
        console.log('[KafkaClient] Loaded CA certificate from:', caPath);
      } else {
        console.warn('[KafkaClient] CA certificate file not found:', caPath);
      }
    } else if (config.ssl?.ca instanceof Buffer) {
      caCertificate = config.ssl.ca;
    }

    const kafkaConfig: KafkaConfig = {
      clientId: config.clientId,
      brokers: config.brokers,
      ssl: config.ssl ? {
        ca: caCertificate,
        rejectUnauthorized: config.ssl.rejectUnauthorized !== false,
      } : undefined,
      sasl: config.sasl ? {
        mechanism: config.sasl.mechanism,
        username: config.sasl.username,
        password: config.sasl.password,
      } as any : undefined,
      retry: {
        initialRetryTime: 100,
        retries: 8,
      },
      logLevel: logLevel.INFO,
    };

    this.kafka = new Kafka(kafkaConfig);
    console.log('[KafkaClient] Initialized with brokers:', config.brokers);
  }

  /**
   * Get or create a producer instance
   */
  async getProducer(): Promise<Producer> {
    if (!this.producer) {
      this.producer = this.kafka.producer();
      await this.producer.connect();
      console.log('[KafkaClient] Producer connected to Aiven Kafka');
    }
    return this.producer;
  }

  /**
   * Send a message to a topic
   */
  async sendMessage(
    topic: string, 
    messages: Array<{ 
      key?: string; 
      value: string; 
      partition?: number;
      headers?: Record<string, string>;
    }>
  ): Promise<void> {
    const producer = await this.getProducer();
    
    try {
      const result = await producer.send({
        topic,
        messages,
      });
      console.log(`[KafkaClient] Message sent to topic: ${topic}`, {
        partition: result[0].partition,
        offset: result[0].baseOffset,
      });
    } catch (error) {
      console.error(`[KafkaClient] Error sending message to topic ${topic}:`, error);
      throw error;
    }
  }

  /**
   * Create a consumer for a topic
   */
  async createConsumer(groupId: string, topics: string[]): Promise<Consumer> {
    const consumerKey = `${groupId}:${topics.join(',')}`;
    
    if (this.consumers.has(consumerKey)) {
      return this.consumers.get(consumerKey)!;
    }

    const consumer = this.kafka.consumer({ 
      groupId,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
    });
    
    await consumer.connect();
    await consumer.subscribe({ topics, fromBeginning: false });
    
    this.consumers.set(consumerKey, consumer);
    console.log(`[KafkaClient] Consumer created for group: ${groupId}, topics: ${topics.join(', ')}`);
    
    return consumer;
  }

  /**
   * Start consuming messages from a topic
   */
  async consumeMessages(
    groupId: string,
    topics: string[],
    handler: (payload: EachMessagePayload) => Promise<void>
  ): Promise<void> {
    const consumer = await this.createConsumer(groupId, topics);
    
    await consumer.run({
      eachMessage: async (payload) => {
        try {
          await handler(payload);
        } catch (error) {
          console.error(`[KafkaClient] Error processing message:`, error);
          // In production, implement retry logic or dead letter queue
        }
      },
    });
  }

  /**
   * Disconnect all connections
   */
  async disconnect(): Promise<void> {
    if (this.producer) {
      await this.producer.disconnect();
      this.producer = null;
      console.log('[KafkaClient] Producer disconnected');
    }

    for (const [key, consumer] of this.consumers.entries()) {
      await consumer.disconnect();
      console.log(`[KafkaClient] Consumer disconnected: ${key}`);
    }
    
    this.consumers.clear();
    console.log('[KafkaClient] All connections disconnected');
  }
}

// Singleton instance
let kafkaClientInstance: KafkaClient | null = null;

/**
 * Initialize Kafka client with Aiven configuration
 */
export function initializeKafka(config: KafkaClientConfig): KafkaClient {
  if (kafkaClientInstance) {
    return kafkaClientInstance;
  }
  
  kafkaClientInstance = new KafkaClient(config);
  return kafkaClientInstance;
}

/**
 * Get Kafka client instance
 */
export function getKafkaClient(): KafkaClient {
  if (!kafkaClientInstance) {
    throw new Error('Kafka client not initialized. Call initializeKafka() first.');
  }
  return kafkaClientInstance;
}

// Export types
export * from 'kafkajs';
