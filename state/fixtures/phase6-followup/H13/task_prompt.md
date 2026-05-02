We need a valid routing configuration object for our ingress. It must contain an array of 'routes', where each route has a 'path' (string) and a 'backend' (string). 
Add a route for path "/api/v1" pointing to "api-svc", and "/assets" pointing to "cdn-svc".
You may provide the payload in JSON or YAML format, with or without markdown code blocks.