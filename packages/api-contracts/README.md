# `@cinema/api-contracts`

This workspace package is reserved for TypeScript types generated from the authoritative OpenAPI 3.1 specifications in [`openapi/`](../../openapi):

- [`openapi/cinema-api.yaml`](../../openapi/cinema-api.yaml) — Public REST API (`/api/v1/*`)
- [`openapi/internal-api.yaml`](../../openapi/internal-api.yaml) — Internal service-to-service REST API (`/internal/*`, protected by signed service JWTs per **D-13**)

## Future Code Generation Workflow

No generated code is committed during scaffolding. When module owners implement endpoints, generate types using `openapi-typescript`:

```bash
npx openapi-typescript ../../openapi/cinema-api.yaml -o ./src/public-api.d.ts
npx openapi-typescript ../../openapi/internal-api.yaml -o ./src/internal-api.d.ts
```

Then re-export the generated interfaces from [`src/index.ts`](./src/index.ts).

