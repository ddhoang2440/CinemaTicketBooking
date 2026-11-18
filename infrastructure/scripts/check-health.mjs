/**
 * Health check verification script for all 3 backend Express services (D-04 Revised).
 * Usage: node infrastructure/scripts/check-health.mjs
 */

const services = [
  { name: 'core-service', url: process.env.CORE_HEALTH_URL ?? 'http://localhost:4001/health' },
  { name: 'payment-service', url: process.env.PAYMENT_HEALTH_URL ?? 'http://localhost:4002/health' },
  {
    name: 'notification-service',
    url: process.env.NOTIFICATION_HEALTH_URL ?? 'http://localhost:4003/health',
  },
];

let hasFailure = false;

for (const svc of services) {
  try {
    const response = await fetch(svc.url);
    if (!response.ok) {
      console.error(`[FAIL] ${svc.name} (${svc.url}) -> HTTP ${response.status}`);
      hasFailure = true;
      continue;
    }
    const body = await response.json();
    console.log(
      `[OK]   ${svc.name} (${svc.url}) -> status=${body?.data?.status}, schema=${body?.data?.schema}`,
    );
  } catch (error) {
    console.error(
      `[FAIL] ${svc.name} (${svc.url}) -> ${error instanceof Error ? error.message : String(error)}`,
    );
    hasFailure = true;
  }
}

if (hasFailure) {
  process.exitCode = 1;
}
