import { cache } from '../../lib/cache';

// CLOUDINARY_URL format: cloudinary://API_KEY:API_SECRET@CLOUD_NAME
function parseCloudinaryUrl(): { cloudName: string; apiKey: string; apiSecret: string } {
  const url = process.env.CLOUDINARY_URL;
  if (!url) throw new Error('CLOUDINARY_URL env var is not set');
  const parsed = new URL(url);
  return {
    apiKey: parsed.username,
    apiSecret: parsed.password,
    cloudName: parsed.hostname,
  };
}

const FOLDER_PREFIX = 'stories-app/recommendations';
const CACHE_KEY = 'recommendations:list';

export interface Recommendation {
  name: string;
  url: string;
}

interface CloudinaryResource {
  public_id: string;
  format: string;
}

interface CloudinaryResponse {
  resources: CloudinaryResource[];
}

function publicIdToName(publicId: string): string {
  const filename = publicId.split('/').pop() ?? publicId;
  return filename.replace(/_/g, ' ');
}

async function fetchFromCloudinary(): Promise<Recommendation[]> {
  const { cloudName, apiKey, apiSecret } = parseCloudinaryUrl();
  const url = `https://api.cloudinary.com/v1_1/${cloudName}/resources/image?type=upload&prefix=${encodeURIComponent(FOLDER_PREFIX)}&max_results=100`;
  const credentials = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');

  const res = await fetch(url, {
    headers: { Authorization: `Basic ${credentials}` },
  });

  if (!res.ok) {
    throw new Error(`Cloudinary API error: ${res.status} ${res.statusText}`);
  }

  const body = (await res.json()) as CloudinaryResponse;

  return body.resources.map((r) => ({
    name: publicIdToName(r.public_id),
    // Build a versionless URL matching the original delivery format.
    // The versioned secure_url Cloudinary returns causes timeouts for Hebrew filenames.
    url: `https://res.cloudinary.com/${cloudName}/image/upload/${r.public_id}.${r.format}`,
  }));
}

export async function getRecommendations(): Promise<Recommendation[]> {
  const cached = cache.get<Recommendation[]>(CACHE_KEY);
  if (cached) return cached;

  const data = await fetchFromCloudinary();
  cache.set(CACHE_KEY, data);
  return data;
}
