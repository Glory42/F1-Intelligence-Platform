import { neonConfig } from '@neondatabase/serverless';

// Routes the Neon HTTP driver to a local proxy (docker-compose.test.yml / docker-compose.dev.yml) so
// tests and local dev never spend Neon Free CU-hours. Production never sets NEON_FETCH_ENDPOINT.
export function configureLocalNeonProxy(endpoint: string | undefined = process.env.NEON_FETCH_ENDPOINT): boolean {
  if (!endpoint) return false;
  neonConfig.fetchEndpoint = endpoint;
  return true;
}
