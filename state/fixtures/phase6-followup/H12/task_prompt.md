다음 내부 논의 내용을 요약하여 3개의 핵심 요점(Takeaways)을 추출하세요.
단, 요점을 추출할 때 다음 **우선순위 규칙**을 엄격히 준수해야 합니다:
1. 'Approved' 또는 'Finalized'된 기술적 완화 조치(Technical Mitigations)를 가장 먼저 추출하세요.
2. 단순한 의견 제시나 추측성 아이디어(Speculative ideas)는 'Approved' 조치가 없을 경우에만 추출하세요.
3. 동일한 컴포넌트에 대해 여러 조치가 언급된 경우, 'Immediate Cost'가 낮은 조치를 우선시하세요.
추출한 요점은 숫자가 있는 리스트 형식으로 작성하세요.

[Discussion]
Alice: Our current Redis setup is hitting max memory evictions daily at peak load.
Bob: 그래, 어제도 15분 동안 지연 시간 스파이크가 있었어. 우리가 TTL을 24시간에서 2시간으로 줄여보는 건 어때?
Eve: (Speculative) What if we move everything to Memcached? It's open-source and free, so no extra cost.
Charlie: Memcached is a significant refactor and out of scope for now. Also, scaling the Redis cluster would cost an additional $200/mo, which management marked as 'Secondary Priority'.
Dana: (Approved) Let's finalize the TTL reduction to 6 hours (instead of 2) as an immediate safe mitigation. The cost is zero.
Alice: (Finalized) Good. And we will only scale the cluster if the DB load hits 75% after the TTL change.
