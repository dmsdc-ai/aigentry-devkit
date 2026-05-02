다음 장애 보고서를 읽고, 장애를 유발한 핵심 컴포넌트(Component)와 해당 컴포넌트의 실패 원인(Root Cause) 쌍을 모두 추출하세요.
단, 다음 3가지 조건을 **모두** 만족하는 컴포넌트만 추출해야 합니다:
1. 장애 발생 시간이 09:00 AM 이후여야 합니다.
2. 'Critical Path'에 속해 있다고 명시적으로 언급되어야 합니다.
3. Fallback 메커니즘이 존재하지만 그 Fallback 마저도 실패(Failed)한 경우여야 합니다.
출력 형식은 무관합니다.

[Incident Report]
At 08:30 AM, the AuthGateway started dropping connections due to expired certificates (Critical Path, Fallback: token cache, Failed).
At 09:15 AM, the UserProfileService experienced high latency because of a bad index, but it was on a secondary path (Fallback: Read replica, Failed).
At 09:30 AM, the CheckoutService started failing because the PaymentGateway timeout was too short. This service is on the Critical Path. Its fallback (Offline Queue) also failed.
At 09:45 AM, the ProductCatalog went down due to Redis eviction. It's on the Critical Path, and its fallback (Static Cache) successfully served traffic.
At 10:00 AM, the OrderQueue eventually crashed due to OOM (Out of Memory). It is a Critical Path component, and its fallback mechanism failed to activate.
Meanwhile, at 10:15 AM, the NotificationWorker dropped messages because of a malformed API key configuration. It is on the Critical Path, and its fallback (Email Queue) failed due to rate limits.
