import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  stages: [
    { duration: "5s", target: 20 },   // Warm up to 20 VUs
    { duration: "10s", target: 50 },  // Ramp up to 50 VUs
    { duration: "5s", target: 100 },  // Spike up to 100 VUs
    { duration: "15s", target: 100 }, // Hold spike load
    { duration: "5s", target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_failed: ["rate<0.01"], // Less than 1% request failure
    http_req_duration: ["p(95)<500"], // 95% of requests under 500ms
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

export default function () {
  const randomProductId = `SPIKE-PROD-${Math.floor(Math.random() * 20) + 1}`;
  const randomPrice = Math.floor(Math.random() * 500000) + 50000;
  const now = new Date().toISOString();

  const payload = JSON.stringify({
    id: randomProductId,
    sku: `SKU-${randomProductId}`,
    name: `Product ${randomProductId}`,
    quantity: Math.floor(Math.random() * 100) + 1,
    price: randomPrice,
    updatedAt: now,
  });

  const params = {
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `evt-spike-${randomProductId}-${__VU}-${__ITER}`,
    },
  };

  const res = http.post(`${BASE_URL}/api/v1/webhooks/products`, payload, params);

  check(res, {
    "status is 200": (r) => r.status === 200,
    "has valid status in body": (r) => {
      try {
        const body = JSON.parse(r.body);
        return ["INSERTED", "DUPLICATE_EVENT", "NO_CHANGE", "STALE"].includes(body.status);
      } catch {
        return false;
      }
    },
  });

  sleep(0.1);
}
