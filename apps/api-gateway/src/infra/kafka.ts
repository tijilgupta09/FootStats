// ═══════════════════════════════════════════════════════════════
// FootStats — Kafka Producer & Consumer Setup
// ═══════════════════════════════════════════════════════════════

import { Kafka, type Producer, type Consumer, type EachMessagePayload } from 'kafkajs';
import { config } from '../config';

let kafka: Kafka | null = null;
let producer: Producer | null = null;

function getKafka(): Kafka {
  if (!kafka) {
    kafka = new Kafka({
      clientId: config.kafka.clientId,
      brokers: config.kafka.brokers as string[],
      retry: {
        initialRetryTime: 300,
        retries: 8,
      },
    });
  }
  return kafka;
}

/**
 * Returns a shared Kafka producer instance, connecting lazily.
 */
export async function getProducer(): Promise<Producer> {
  if (!producer) {
    producer = getKafka().producer({
      allowAutoTopicCreation: true,
      idempotent: true,
    });
    await producer.connect();
    console.log('[Kafka] Producer connected');
  }
  return producer;
}

/**
 * Publish a message to a Kafka topic with optional key for partition affinity.
 */
export async function publishMessage(
  topic: string,
  value: Record<string, unknown>,
  key?: string,
): Promise<void> {
  const prod = await getProducer();
  await prod.send({
    topic,
    messages: [
      {
        key: key ?? null,
        value: JSON.stringify(value),
        timestamp: Date.now().toString(),
      },
    ],
  });
}

/**
 * Create and connect a Kafka consumer for a specific topic group.
 */
export async function createConsumer(
  groupId: string,
  topics: string[],
  handler: (payload: EachMessagePayload) => Promise<void>,
): Promise<Consumer> {
  const consumer = getKafka().consumer({
    groupId,
    sessionTimeout: 30000,
    heartbeatInterval: 3000,
  });

  await consumer.connect();
  console.log(`[Kafka] Consumer '${groupId}' connected`);

  for (const topic of topics) {
    await consumer.subscribe({ topic, fromBeginning: false });
  }

  await consumer.run({
    eachMessage: async (payload) => {
      try {
        await handler(payload);
      } catch (err) {
        console.error(
          `[Kafka] Consumer '${groupId}' error on ${payload.topic}:${payload.partition}:`,
          err,
        );
      }
    },
  });

  return consumer;
}

/**
 * Graceful shutdown for the shared producer.
 */
export async function closeKafka(): Promise<void> {
  if (producer) {
    await producer.disconnect();
    producer = null;
    console.log('[Kafka] Producer disconnected');
  }
}
