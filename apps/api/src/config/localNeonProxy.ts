import { neonConfig } from '@neondatabase/serverless';

// Routes the Neon HTTP driver to docker-compose.test.yml's local proxy so tests and their
// migrations never spend Neon Free CU-hours. Never called from the Worker entry point.
export function configureLocalNeonProxy(endpoint: string | undefined = process.env.NEON_FETCH_ENDPOINT): boolean {
  if (!endpoint) return false;
  neonConfig.fetchEndpoint = endpoint;
  return true;
}
