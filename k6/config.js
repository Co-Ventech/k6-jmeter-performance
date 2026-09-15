const failDemo = __ENV.FAIL_DEMO === '1';

export const BASE_URL = (__ENV.API_BASE_URL || 'https://api.practicesoftwaretesting.com').replace(/\/$/, '');

export const ENDPOINTS = [
  { name: 'POST /users/register', key: 'register' },
  { name: 'POST /users/login', key: 'login' },
  { name: 'GET /products', key: 'products' },
  { name: 'POST /carts', key: 'cart_create' },
  { name: 'POST /carts/:id', key: 'cart_add' },
  { name: 'GET /carts/:id', key: 'cart_get' },
  { name: 'DELETE /carts/:id', key: 'cart_delete' },
];

export function thresholds() {
  const p95 = failDemo ? '1' : __ENV.P95_MS || '3000';
  return {
    http_req_failed: ['rate<0.05'],
    http_req_duration: [`p(95)<${p95}`],
    checks: ['rate>0.95'],
  };
}

export function loadOptions() {
  return {
    scenarios: {
      load: {
        executor: 'constant-vus',
        vus: Number(__ENV.VUS || 5),
        duration: __ENV.DURATION || '30s',
      },
    },
    thresholds: thresholds(),
    summaryTrendStats: ['min', 'avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  };
}

export function stressOptions() {
  return {
    scenarios: {
      stress: {
        executor: 'ramping-vus',
        startVUs: 1,
        stages: [
          { duration: '20s', target: 8 },
          { duration: '20s', target: 8 },
          { duration: '15s', target: 0 },
        ],
      },
    },
    thresholds: thresholds(),
    summaryTrendStats: ['min', 'avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  };
}

export function spikeOptions() {
  return {
    scenarios: {
      spike: {
        executor: 'ramping-vus',
        startVUs: 1,
        stages: [
          { duration: '10s', target: 2 },
          { duration: '10s', target: 12 },
          { duration: '10s', target: 2 },
          { duration: '5s', target: 0 },
        ],
      },
    },
    thresholds: thresholds(),
    summaryTrendStats: ['min', 'avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  };
}
