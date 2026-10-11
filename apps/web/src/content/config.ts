import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const docs = defineCollection({
  loader: glob({
    pattern: ['**/*.md', '!adr/**', '!plans/**'],
    base: '../../docs',
  }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    order: z.number().optional().default(99),
  }),
});

export const collections = { docs };
