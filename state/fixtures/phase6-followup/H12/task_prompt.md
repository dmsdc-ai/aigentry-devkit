Summarize the following internal discussion about our caching strategy. Extract exactly 3 key takeaways. Formatting (numbered lists, bullets, dashes) does not matter.

[Discussion]
Alice: Our current Redis setup is hitting max memory evictions daily at peak.
Bob: 그래, 어제도 15분 동안 지연 시간 스파이크가 있었어. 우리가 TTL을 24시간에서 2시간으로 줄여보는 건 어때?
Charlie: That might increase DB load. What if we scale up the Redis cluster instead? 비용은 월 200불 정도 추가될 거야.
Alice: Let's do both: reduce TTL to 6 hours first, and monitor DB load. If it's too high, we scale Redis.