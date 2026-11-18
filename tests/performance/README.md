# Performance Testing (`tests/performance`)

Reserved for `autocannon` API latency benchmarks and Lighthouse frontend checks per [`docs/03-quality/TESTING.md`](../../docs/03-quality/TESTING.md):

- List endpoints (`GET /api/v1/movies`, `GET /api/v1/showtimes`): target `< 200ms`
- Seat state endpoint (`GET /api/v1/showtimes/{id}/seats`): target `< 100ms`

Do not record benchmark numbers until real endpoints and seeded data are measured.

