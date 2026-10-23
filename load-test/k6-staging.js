// Read-only load test of public staging endpoints.
// Does not call login, register, password reset, uploads, or other writes.
//
//   k6 run load-test/k6-staging.js

import http from 'k6/http';
import { check } from 'k6';

const SERVICES = [
  {
    name: 'auth',
    base: 'https://jibbr-dev-auth-6ib5s.ondigitalocean.app',
    paths: ['/health', '/api/client/version-status'],
  },
  {
    name: 'upload',
    base: 'https://jibbr-dev-upload-6yets.ondigitalocean.app',
    paths: ['/health', '/api/client/version-status'],
  },
  {
    name: 'messaging',
    base: 'https://jibbr-dev-messaging-jgk48.ondigitalocean.app',
    paths: ['/health', '/health/outbox', '/api/client/version-status'],
  },
  {
    name: 'socket',
    base: 'https://jibbr-dev-socket-emtnf.ondigitalocean.app',
    paths: ['/health', '/health/realtime', '/api/client/version-status'],
  },
  {
    name: 'call',
    base: 'https://call.jibbr.in',
    paths: ['/health', '/api/client/version-status'],
  },
];

const durationThresholds = {};
for (const service of SERVICES) {
  durationThresholds[`http_req_duration{service:${service.name}}`] = ['p(95)<2000'];
  durationThresholds[`http_req_failed{service:${service.name}}`] = ['rate<0.05'];
}

export const options = {
  scenarios: {
    staging_public: {
      executor: 'ramping-arrival-rate',
      startRate: 2,
      timeUnit: '1s',
      preAllocatedVUs: 40,
      maxVUs: 200,
      stages: [
        { duration: '20s', target: 5 },
        { duration: '45s', target: 15 },
        { duration: '20s', target: 30 },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<2000', 'p(99)<4000'],
    ...durationThresholds,
  },
  discardResponseBodies: false,
};

export default function () {
  const requests = [];
  for (const service of SERVICES) {
    for (const path of service.paths) {
      requests.push([
        'GET',
        `${service.base}${path}`,
        null,
        {
          timeout: '15s',
          tags: { service: service.name, name: `${service.name} ${path}` },
        },
      ]);
    }
  }

  const responses = http.batch(requests);
  for (const response of responses) {
    check(response, {
      'status is 200': (res) => res.status === 200,
    });
  }
}
