다음 장애 보고서를 읽고, 장애를 유발한 핵심 컴포넌트(Component)와 해당 컴포넌트의 실패 원인(Root Cause) 쌍을 모두 추출하세요.
출력 형식은 중요하지 않으며(JSON, 마크다운 표, 평문 리스트 등 무관), 데이터의 정확성만 평가합니다.

[Incident Report]
At 10:00 AM, the CheckoutService started failing because the PaymentGateway timeout was too short. This caused a backlog in the OrderQueue. The OrderQueue eventually crashed due to OOM (Out of Memory). Meanwhile, the NotificationWorker dropped messages because of a malformed API key configuration.