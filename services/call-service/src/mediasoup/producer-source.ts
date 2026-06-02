import type { Producer } from 'mediasoup/node/lib/types.js';

export type ProducerSource = 'camera' | 'screen';

export const producerSourceFromAppData = (appData: unknown): ProducerSource => {
  const source = (appData as { source?: string } | undefined)?.source;
  return source === 'screen' ? 'screen' : 'camera';
};

export const producerSourceFromProducer = (producer: Producer): ProducerSource => {
  if (producer.kind !== 'video') return 'camera';
  return producerSourceFromAppData(producer.appData);
};
