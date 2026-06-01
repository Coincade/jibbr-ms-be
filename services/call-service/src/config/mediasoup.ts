import type { RtpCodecCapability, WorkerLogLevel, WorkerLogTag } from 'mediasoup/node/lib/types.js';

export const mediaCodecs: RtpCodecCapability[] = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    preferredPayloadType: 111,
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    preferredPayloadType: 96,
    clockRate: 90000,
    parameters: {
      'x-google-start-bitrate': 1000,
    },
  },
];

export const workerSettings = {
  logLevel: (process.env.MEDIASOUP_LOG_LEVEL || 'warn') as WorkerLogLevel,
  logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'] as WorkerLogTag[],
  rtcMinPort: Number.parseInt(process.env.MEDIASOUP_RTC_MIN_PORT || '40000', 10),
  rtcMaxPort: Number.parseInt(process.env.MEDIASOUP_RTC_MAX_PORT || '49999', 10),
};

export const getWebRtcTransportOptions = () => {
  const listenIp = process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0';
  const announcedIp = process.env.MEDIASOUP_ANNOUNCED_IP;

  return {
    listenIps: [
      {
        ip: listenIp,
        ...(announcedIp ? { announcedIp } : {}),
      },
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate: 1_000_000,
  };
};

/** Strip wrapping quotes some editors add in .env files. */
const stripEnvQuotes = (value: string | undefined): string | undefined => {
  if (!value) return value;
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

export const getIceServers = () => {
  const servers: { urls: string | string[]; username?: string; credential?: string }[] = [];

  const stunUrl = stripEnvQuotes(process.env.STUN_URL) || 'stun:stun.l.google.com:19302';
  servers.push({ urls: stunUrl });

  const turnUrl = stripEnvQuotes(process.env.TURN_URL);
  const turnUsername = stripEnvQuotes(process.env.TURN_USERNAME);
  const turnCredential = stripEnvQuotes(process.env.TURN_CREDENTIAL);
  if (turnUrl && turnUsername && turnCredential) {
    servers.push({
      urls: turnUrl,
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return servers;
};
