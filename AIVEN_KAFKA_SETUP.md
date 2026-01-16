# Aiven Kafka Implementation Guide

This guide provides detailed steps for implementing Apache Kafka from Aiven in your Turbo Repo microservices architecture.

## 📋 Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Step 1: Aiven Kafka Setup](#step-1-aiven-kafka-setup)
4. [Step 2: Kafka Client Package](#step-2-kafka-client-package)
5. [Step 3: Service Integration](#step-3-service-integration)
6. [Step 4: Environment Variables](#step-4-environment-variables)
7. [Step 5: Testing](#step-5-testing)
8. [Troubleshooting](#troubleshooting)

---

## Overview

### What We're Implementing

- **Aiven Kafka**: Managed Kafka service (cloud-hosted) for asynchronous communication between services

### Architecture

```
Services communicate via Aiven Kafka
    ↓
Aiven Kafka (Cloud)
    ↓
┌─────────────────────────────────────┐
│  Event-Driven Communication         │
│  - Message events                   │
│  - Notification events              │
│  - User lifecycle events           │
│  - Workspace/Channel events         │
└─────────────────────────────────────┘
```

### Why Aiven?

- **Managed Service**: No need to maintain Kafka infrastructure
- **High Availability**: Built-in replication and failover
- **Security**: SSL/TLS encryption and SASL authentication
- **Scalability**: Easy to scale up/down
- **Monitoring**: Built-in monitoring and metrics

---

## Prerequisites

- Aiven account (sign up at https://aiven.io)
- Node.js 18+ installed
- Basic understanding of microservices architecture
- Your services already set up in the turbo repo

---

## Step 1: Aiven Kafka Setup

### 1.1 Create Aiven Account

1. Go to https://aiven.io and sign up
2. Verify your email address
3. Complete the onboarding process

### 1.2 Create Kafka Service

1. **Navigate to Services** in Aiven Console
2. **Click "Create Service"**
3. **Select "Apache Kafka"**
4. **Configure Service:**
   - **Service Name**: `jibbr-kafka` (or your preferred name)
   - **Cloud Provider**: Choose your preferred region (AWS, GCP, Azure)
   - **Region**: Select closest to your users
   - **Plan**: Start with `startup-2` (2GB RAM) for development, scale up for production
   - **Kafka Version**: Latest stable (recommended)
   - **Enable Schema Registry**: Optional (for Avro schemas)

5. **Click "Create Service"**
6. Wait 5-10 minutes for service provisioning

### 1.3 Get Connection Details

Once the service is created:

1. **Go to Service Overview**
2. **Click "Connection Information"**
3. **Copy the following:**
   - **Bootstrap Servers**: `your-project.aivencloud.com:12345`
   - **Service URI**: `kafka://username:password@your-project.aivencloud.com:12345`
   - **CA Certificate**: Download the CA certificate file

4. **Go to "Users" tab**
5. **Create a new user** (or use default `avnadmin`)
   - Click "Add user"
   - Choose a username (e.g., `messaging-service-user`)
   - Note the password (you'll need this for authentication)
   - Grant appropriate ACLs (Access Control Lists) for topics

### 1.4 Create Topics

1. **Go to "Topics" tab** in Aiven Console
2. **Click "Create Topic"**
3. **Create the following topics:**

   | Topic Name | Partitions | Replication | Description |
   |------------|------------|--------------|-------------|
   | `messages` | 3 | 2 | Message events (created, updated, deleted) |
   | `notifications` | 3 | 2 | Notification events |
   | `user-events` | 3 | 2 | User lifecycle events (created, updated, deleted) |
   | `workspace-events` | 3 | 2 | Workspace events (created, updated, deleted) |
   | `channel-events` | 3 | 2 | Channel events (created, updated, deleted) |

4. **For each topic:**
   - Set **Partitions**: 3 (for parallelism)
   - Set **Replication**: 2 (for high availability)
   - **Retention**: 7 days (or as per your needs)
   - **Cleanup Policy**: `delete` (or `compact` for keyed messages)

### 1.5 Download CA Certificate

1. **Go to "Overview" tab**
2. **Click "Download CA Certificate"**
3. **Save the file** as `ca.pem` in your project root
4. **Keep this file secure** - it's needed for SSL connection

### 1.6 Set Up ACLs (Access Control Lists)

For each user you created, set up ACLs:

1. **Go to "ACLs" tab**
2. **Click "Add ACL"**
3. **Configure for each user:**
   - **Principal**: Your username (e.g., `messaging-service-user`)
   - **Pattern Type**: `LITERAL` or `PREFIXED`
   - **Resource Type**: `TOPIC`
   - **Resource Name**: Topic name (e.g., `messages`)
   - **Operation**: `READ`, `WRITE`, `CREATE`, `DESCRIBE` (as needed)
   - **Permission Type**: `ALLOW`

   Example ACLs for `messaging-service-user`:
   - `READ` on `messages` topic
   - `WRITE` on `messages` topic
   - `READ` on `notifications` topic
   - `WRITE` on `notifications` topic

---

## Step 2: Kafka Client Package

### 2.1 Create Kafka Package Structure

```bash
mkdir -p packages/kafka-client/src
```

### 2.2 Package.json

Create `packages/kafka-client/package.json`:

```json
{
  "name": "@jibbr/kafka-client",
  "version": "1.0.0",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "kafkajs": "^2.2.4"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
```

### 2.3 Kafka Client Implementation (Aiven-Compatible)

Create `packages/kafka-client/src/index.ts`:

```typescript
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
      } : undefined,
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
```

### 2.4 TypeScript Config

Create `packages/kafka-client/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

## Step 3: Service Integration

### 3.1 Add Kafka to Service Package.json

For each service that needs Kafka, add to `package.json`:

```json
{
  "dependencies": {
    "@jibbr/kafka-client": "*"
  }
}
```

### 3.2 Example: Using Aiven Kafka in Messaging Service

Create `services/messaging-service/src/config/kafka.ts`:

```typescript
import { initializeKafka, getKafkaClient } from '@jibbr/kafka-client';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

// Aiven Kafka Configuration
const brokers = process.env.KAFKA_BROKERS?.split(',') || [];
const clientId = process.env.KAFKA_CLIENT_ID || 'messaging-service';
const groupId = process.env.KAFKA_GROUP_ID || 'messaging-service-group';

// Aiven requires SSL and SASL authentication
const kafkaConfig = {
  brokers,
  clientId,
  groupId,
  ssl: {
    // Path to Aiven CA certificate
    ca: process.env.KAFKA_CA_CERT_PATH || path.join(process.cwd(), 'ca.pem'),
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
```

### 3.3 Example: Publishing Messages

In your controller or service (e.g., `services/messaging-service/src/controllers/message.controller.ts`):

```typescript
import { kafkaClient, KAFKA_TOPICS } from '../config/kafka';

// Publish a message event when a message is created
async function publishMessageCreatedEvent(message: any) {
  try {
    await kafkaClient.sendMessage(KAFKA_TOPICS.MESSAGES, [
      {
        key: message.id,
        value: JSON.stringify({
          type: 'message.created',
          data: {
            id: message.id,
            content: message.content,
            userId: message.userId,
            channelId: message.channelId,
            conversationId: message.conversationId,
            createdAt: message.createdAt,
          },
          timestamp: new Date().toISOString(),
        }),
        headers: {
          'content-type': 'application/json',
          'service': 'messaging-service',
          'event-type': 'message.created',
        },
      },
    ]);
    console.log('[Kafka] Published message.created event:', message.id);
  } catch (error) {
    console.error('[Kafka] Failed to publish message event:', error);
    // In production, implement retry logic or fallback
  }
}

// Use in your controller
export const sendMessage = async (req: Request, res: Response) => {
  // ... existing message creation logic ...
  
  // After creating the message, publish event
  await publishMessageCreatedEvent(newMessage);
  
  return res.status(201).json({ message: "Message sent", data: newMessage });
};
```

### 3.4 Example: Consuming Messages

Create `services/messaging-service/src/services/kafka-consumer.service.ts`:

```typescript
import { kafkaClient, KAFKA_TOPICS } from '../config/kafka';
import { EachMessagePayload } from '@jibbr/kafka-client';

// Start consuming messages
export async function startMessageConsumer() {
  try {
    await kafkaClient.consumeMessages(
      'messaging-service-group',
      [KAFKA_TOPICS.USER_EVENTS, KAFKA_TOPICS.WORKSPACE_EVENTS],
      async (payload: EachMessagePayload) => {
        const topic = payload.topic;
        const message = JSON.parse(payload.message.value?.toString() || '{}');
        
        console.log(`[Kafka] Received message from topic ${topic}:`, message);
        
        // Process the message based on topic
        switch (topic) {
          case KAFKA_TOPICS.USER_EVENTS:
            await handleUserEvent(message);
            break;
          case KAFKA_TOPICS.WORKSPACE_EVENTS:
            await handleWorkspaceEvent(message);
            break;
          default:
            console.warn('[Kafka] Unknown topic:', topic);
        }
      }
    );
    console.log('[Kafka] Message consumer started');
  } catch (error) {
    console.error('[Kafka] Failed to start consumer:', error);
    throw error;
  }
}

async function handleUserEvent(message: any) {
  switch (message.type) {
    case 'user.created':
      console.log('Processing user.created event:', message.data);
      // Handle user creation (e.g., create default workspace, send welcome notification)
      break;
    case 'user.updated':
      console.log('Processing user.updated event:', message.data);
      // Handle user update (e.g., update cached user data)
      break;
    case 'user.deleted':
      console.log('Processing user.deleted event:', message.data);
      // Handle user deletion (e.g., cleanup user data)
      break;
    default:
      console.warn('Unknown user event type:', message.type);
  }
}

async function handleWorkspaceEvent(message: any) {
  switch (message.type) {
    case 'workspace.created':
      console.log('Processing workspace.created event:', message.data);
      // Handle workspace creation
      break;
    case 'workspace.updated':
      console.log('Processing workspace.updated event:', message.data);
      // Handle workspace update
      break;
    default:
      console.warn('Unknown workspace event type:', message.type);
  }
}
```

Initialize the consumer in your service's `index.ts`:

```typescript
// services/messaging-service/src/index.ts
import { startMessageConsumer } from './services/kafka-consumer.service';

// ... existing code ...

// Start Kafka consumer after service initialization
startMessageConsumer().catch((error) => {
  console.error('Failed to start Kafka consumer:', error);
  // Don't crash the service, but log the error
});
```

---

## Step 4: Environment Variables

### 4.1 Update ENV_VARIABLES.md

Add Aiven Kafka configuration section:

```markdown
### **Aiven Kafka Configuration**

All services that use Kafka need these variables:

```env
# Aiven Kafka Connection
KAFKA_BROKERS=your-project.aivencloud.com:12345
KAFKA_CLIENT_ID=messaging-service
KAFKA_GROUP_ID=messaging-service-group

# Aiven Authentication
KAFKA_USERNAME=avnadmin
KAFKA_PASSWORD=your-aiven-password
KAFKA_SASL_MECHANISM=scram-sha-256

# SSL Configuration
KAFKA_CA_CERT_PATH=./ca.pem
```

**Usage:**
- `KAFKA_BROKERS` - Comma-separated list of Aiven Kafka broker addresses
- `KAFKA_CLIENT_ID` - Unique identifier for this service instance
- `KAFKA_GROUP_ID` - Consumer group ID (for message consumption)
- `KAFKA_USERNAME` - Aiven service username (usually `avnadmin` or custom user)
- `KAFKA_PASSWORD` - Aiven service password
- `KAFKA_SASL_MECHANISM` - SASL mechanism (`scram-sha-256` or `scram-sha-512`)
- `KAFKA_CA_CERT_PATH` - Path to Aiven CA certificate file
```

### 4.2 Service-Specific .env Files

**messaging-service/.env:**
```env
# ... existing variables ...

# Aiven Kafka Configuration
KAFKA_BROKERS=your-project.aivencloud.com:12345
KAFKA_CLIENT_ID=messaging-service
KAFKA_GROUP_ID=messaging-service-group
KAFKA_USERNAME=messaging-service-user
KAFKA_PASSWORD=your-aiven-password-here
KAFKA_SASL_MECHANISM=scram-sha-256
KAFKA_CA_CERT_PATH=./ca.pem
```

**socket-service/.env:**
```env
# ... existing variables ...

# Aiven Kafka Configuration
KAFKA_BROKERS=your-project.aivencloud.com:12345
KAFKA_CLIENT_ID=socket-service
KAFKA_GROUP_ID=socket-service-group
KAFKA_USERNAME=socket-service-user
KAFKA_PASSWORD=your-aiven-password-here
KAFKA_SASL_MECHANISM=scram-sha-256
KAFKA_CA_CERT_PATH=./ca.pem
```

### 4.3 Add CA Certificate to Project

1. **Copy the CA certificate** you downloaded from Aiven to your project root
2. **Name it `ca.pem`**
3. **Add to `.gitignore`** (recommended for security):
   ```
   ca.pem
   *.pem
   ```

---

## Step 5: Testing

### 5.1 Install Dependencies

```bash
# Install root dependencies
npm install

# Install kafka-client package dependencies
cd packages/kafka-client
npm install
cd ../..
```

### 5.2 Test Aiven Kafka Connection

Create a test script `test-kafka.ts` in project root:

```typescript
import { initializeKafka } from '@jibbr/kafka-client';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

async function testKafka() {
  const brokers = process.env.KAFKA_BROKERS?.split(',') || [];
  
  if (brokers.length === 0) {
    console.error('❌ KAFKA_BROKERS not set in environment');
    process.exit(1);
  }

  const kafkaClient = initializeKafka({
    brokers,
    clientId: 'test-client',
    ssl: {
      ca: process.env.KAFKA_CA_CERT_PATH || path.join(process.cwd(), 'ca.pem'),
      rejectUnauthorized: true,
    },
    sasl: {
      mechanism: (process.env.KAFKA_SASL_MECHANISM || 'scram-sha-256') as 'scram-sha-256',
      username: process.env.KAFKA_USERNAME || '',
      password: process.env.KAFKA_PASSWORD || '',
    },
  });

  try {
    console.log('🔌 Connecting to Aiven Kafka...');
    
    // Test producer
    const producer = await kafkaClient.getProducer();
    console.log('✅ Producer connected');
    
    // Send test message
    await kafkaClient.sendMessage('test-topic', [
      {
        key: 'test-key',
        value: JSON.stringify({ 
          message: 'Hello from Aiven Kafka!',
          timestamp: new Date().toISOString(),
        }),
      },
    ]);
    console.log('✅ Successfully sent message to Aiven Kafka');

    // Test consumer
    console.log('📥 Starting consumer...');
    let messageReceived = false;
    
    await kafkaClient.consumeMessages(
      'test-group',
      ['test-topic'],
      async (payload) => {
        const value = payload.message.value?.toString();
        console.log('✅ Successfully received message:', value);
        messageReceived = true;
        await kafkaClient.disconnect();
        process.exit(0);
      }
    );

    // Wait for message (with timeout)
    setTimeout(() => {
      if (!messageReceived) {
        console.log('⏱️  Timeout waiting for message');
        kafkaClient.disconnect().then(() => process.exit(1));
      }
    }, 10000);
  } catch (error) {
    console.error('❌ Kafka test failed:', error);
    await kafkaClient.disconnect();
    process.exit(1);
  }
}

testKafka();
```

Run the test:
```bash
# Make sure you have the environment variables set
npx ts-node test-kafka.ts
```

### 5.3 Monitor in Aiven Console

1. **Go to Aiven Console**
2. **Navigate to your Kafka service**
3. **Check "Metrics" tab** for:
   - Message throughput
   - Consumer lag
   - Broker health
4. **Check "Topics" tab** to see message counts
5. **Check "Messages" tab** to view recent messages

---

## Troubleshooting

### Aiven Kafka Connection Issues

1. **Verify credentials:**
   ```bash
   # Check environment variables are set
   echo $KAFKA_BROKERS
   echo $KAFKA_USERNAME
   ```

2. **Check CA certificate:**
   ```bash
   # Verify certificate file exists
   ls -la ca.pem
   
   # Check certificate is valid
   openssl x509 -in ca.pem -text -noout
   ```

3. **Test connection manually (using kafkacat):**
   ```bash
   # Install kafkacat: brew install kafkacat (Mac) or apt-get install kafkacat (Linux)
   kafkacat -b your-project.aivencloud.com:12345 \
     -X security.protocol=SASL_SSL \
     -X sasl.mechanisms=SCRAM-SHA-256 \
     -X sasl.username=avnadmin \
     -X sasl.password=your-password \
     -X ssl.ca.location=./ca.pem \
     -L  # List topics
   ```

4. **Check Aiven service status:**
   - Go to Aiven Console
   - Verify service is "RUNNING"
   - Check for any alerts or warnings
   - Review service logs

### Common Errors

**Error: "Connection timeout"**
- Check firewall rules allow outbound connections
- Verify broker address is correct
- Check Aiven service is running
- Verify network connectivity

**Error: "Authentication failed"**
- Verify username and password are correct
- Check SASL mechanism matches Aiven configuration
- Ensure user exists in Aiven
- Verify ACLs are set up correctly

**Error: "SSL certificate verification failed"**
- Verify CA certificate path is correct
- Check certificate file is readable
- Ensure certificate matches your Aiven service
- Try downloading the certificate again from Aiven

**Error: "Topic does not exist"**
- Verify topic exists in Aiven Console
- Check topic name spelling
- Ensure user has CREATE permission if auto-create is disabled

**Error: "Not authorized to access topic"**
- Check ACLs are configured correctly
- Verify user has READ/WRITE permissions
- Review ACL configuration in Aiven Console

---

## Security Best Practices

1. **Never commit credentials:**
   - Add `.env` files to `.gitignore`
   - Use environment variables in production
   - Use secrets management (AWS Secrets Manager, HashiCorp Vault, etc.)

2. **Rotate passwords regularly:**
   - Change Aiven passwords periodically
   - Use different users for different services
   - Implement password rotation policy

3. **Limit access:**
   - Create separate Aiven users for each service
   - Use least privilege principle for ACLs
   - Grant only necessary permissions

4. **Monitor usage:**
   - Set up alerts in Aiven Console
   - Monitor message throughput
   - Watch for unusual patterns
   - Review access logs

5. **Secure certificate storage:**
   - Don't commit CA certificates to git
   - Use secure storage for certificates in production
   - Rotate certificates if compromised

---

## Cost Optimization

1. **Choose right plan:**
   - Start with `startup-2` for development
   - Scale up only when needed
   - Monitor usage in Aiven Console

2. **Optimize retention:**
   - Set appropriate message retention periods
   - Use log compaction for keyed messages
   - Clean up unused topics

3. **Monitor usage:**
   - Check Aiven billing dashboard
   - Set up cost alerts
   - Review and optimize regularly

4. **Use appropriate replication:**
   - Development: 1 replica (cheaper)
   - Production: 2-3 replicas (for HA)

---

## Next Steps

1. **Production Setup:**
   - Set up separate Aiven projects for dev/staging/prod
   - Configure proper ACLs for each environment
   - Set up monitoring and alerts

2. **Advanced Kafka:**
   - Implement schema registry (Aiven provides this)
   - Set up dead letter queues
   - Implement message replay
   - Use Kafka Streams for stream processing

3. **Monitoring:**
   - Integrate with Prometheus/Grafana
   - Set up Aiven metrics dashboard
   - Configure alerting for consumer lag
   - Monitor message throughput

4. **Error Handling:**
   - Implement retry logic with exponential backoff
   - Set up dead letter queues
   - Add circuit breakers
   - Implement message idempotency

---

## Additional Resources

- [Aiven Documentation](https://docs.aiven.io/)
- [Aiven Kafka Guide](https://docs.aiven.io/docs/products/kafka)
- [KafkaJS Documentation](https://kafka.js.org/)
- [Apache Kafka Documentation](https://kafka.apache.org/documentation/)
