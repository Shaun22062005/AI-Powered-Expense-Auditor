import { QdrantClient } from '@qdrant/js-client-rest';

const qdrantUrl = process.env.QDRANT_URL!;
const qdrantApiKey = process.env.QDRANT_API_KEY!;

export const qdrant = new QdrantClient({
  url: qdrantUrl,
  apiKey: qdrantApiKey,
});

export async function ensureCollection(collectionName: string) {
  const collections = await qdrant.getCollections();
  const exists = collections.collections.some((c) => c.name === collectionName);

  if (!exists) {
    await qdrant.createCollection(collectionName, {
      vectors: {
        size: 3072, // Google text-embedding-004 size
        distance: 'Cosine',
      },
    });
  }
}
