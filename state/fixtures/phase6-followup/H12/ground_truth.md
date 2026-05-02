1. Redis is hitting max memory evictions and causing latency spikes.
2. TTL will be reduced to 6 hours as an initial mitigation.
3. If DB load becomes too high due to the TTL change, the Redis cluster will be scaled up (costs ~$200/mo).