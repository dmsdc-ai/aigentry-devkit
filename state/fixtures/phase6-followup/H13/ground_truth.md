{
  "routes": [
    {
      "path": "/api/v1/user",
      "backend": "user-svc-legacy",
      "priority": 27,
      "rewrite": "/api/v2/user"
    },
    {
      "path": "/api/v1/auth",
      "backend": "auth-svc-v2",
      "priority": 23
    },
    {
      "path": "/assets",
      "backend": "static-cdn-svc",
      "priority": 21
    }
  ]
}