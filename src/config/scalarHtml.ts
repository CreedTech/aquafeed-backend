// Scalar CDN HTML template (works in CommonJS without ESM import issues)
const scalarHtml = `
<!DOCTYPE html>
<html>
<head>
    <title>AquaFeed API Documentation</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body>
    <script id="api-reference" data-url="/openapi.json"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>
`;

export default scalarHtml;
