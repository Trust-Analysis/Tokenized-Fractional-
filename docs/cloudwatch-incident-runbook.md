# Incident Response Runbook: Service Degradation (High CPU & Memory)

This runbook outlines the steps for on-call engineers responding to CloudWatch alarms triggered by high resource utilization (`CPUUtilization > 80%` or `MemoryUtilization > 85%`) on production instances.

## Alarm Definitions

1. **`rwa-production-cpu-utilization-high`**
   - **Threshold:** Average CPU > 80% over two consecutive 5-minute periods.
   - **Impact:** Slow response times, potential API gateway timeouts, dropped WebSocket connections.
2. **`rwa-production-memory-utilization-high`**
   - **Threshold:** Average Memory > 85% over two consecutive 5-minute periods.
   - **Impact:** Risk of OOM (Out of Memory) kills by the Linux kernel, crashing Node.js backend processes.

---

## Triage & Investigation Steps

### Step 1: Acknowledge & Inspect
- Acknowledge the alert in PagerDuty / Slack channel.
- Open the AWS CloudWatch Console to view the metric graph and verify if the spike is sustained or transient.

### Step 2: Identify the Bottleneck Process
SSH into the affected instance or check logs via CloudWatch Logs / Docker:
```bash
# Check top resource consuming processes
top -b -n 1 | head -n 20

# Check container resource stats if running via Docker
docker stats --no-stream
```
### Step 3: Mitigation Actions
* If CPU is spiking due to high traffic:

    * Check Nginx / API Gateway request rates.

    * Scale out the service or verify if rate-limiting (Redis tiered rate-limiter) is active.

* If Memory is spiking (potential memory leak):

    * Check Node.js heap usage: ```node --version```

    * Restart the backend container gracefully to clear memory pools if OOM is imminent:

```Bash
docker compose restart backend
```

### Step 4: Post-Incident
* File a post-mortem ticket if the service outage lasted longer than 15 minutes.

* Tune alarm thresholds or auto-scaling parameters if the spike was caused by normal organic load growth.