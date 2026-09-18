import 'dotenv/config';
import { Client, Databases, ID, Permission, Role, Storage } from 'node-appwrite';
import { ensureMockSchema, isAutoMode, isMockMode, withRetry } from './mock-appwrite.js';

const databaseId = process.env.APPWRITE_DATABASE_ID || 'osdag';
const collectionId = process.env.APPWRITE_COLLECTION_ID || 'files';
const bucketId = process.env.APPWRITE_BUCKET_ID || 'files';

if (isMockMode()) {
  const schema = await ensureMockSchema();
  console.log(`Appwrite mock ready: database=${schema.databaseId}, collection=${schema.collectionId}, bucket=${schema.bucketId}`);
  process.exit(0);
}

const required = ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length && !isAutoMode()) {
  console.error(`Appwrite setup requires: ${missing.join(', ')}. Set APPWRITE_MODE=mock for offline verification.`);
  process.exit(1);
}

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT || 'http://localhost:80/v1')
  .setProject(process.env.APPWRITE_PROJECT_ID || 'local-dev')
  .setKey(process.env.APPWRITE_API_KEY || 'local-dev-key');
const databases = new Databases(client);
const storage = new Storage(client);

async function ignoreExists(action) {
  try { return await action(); } catch (error) {
    if (error.code === 409) return null;
    throw error;
  }
}

try {
  await withRetry(async () => {
    await ignoreExists(() => databases.create(ID.unique(), databaseId, 'Osdag Secure Login'));
    await ignoreExists(() => databases.createCollection(databaseId, collectionId, 'User Files', [Permission.create(Role.users()), Permission.read(Role.users())]));
    await ignoreExists(() => databases.createStringAttribute(databaseId, collectionId, 'ownerId', 36, true));
    await ignoreExists(() => databases.createStringAttribute(databaseId, collectionId, 'filename', 255, true));
    await ignoreExists(() => databases.createStringAttribute(databaseId, collectionId, 'storageFileId', 36, true));
    await ignoreExists(() => databases.createStringAttribute(databaseId, collectionId, 'contentType', 255, false));
    await ignoreExists(() => storage.createBucket(bucketId, 'User Files', [Permission.create(Role.users()), Permission.read(Role.users())], false, true, 20 * 1024 * 1024, ['pdf', 'txt', 'csv', 'png', 'jpg', 'jpeg']));
  }, 'creating the Appwrite schema');
  console.log(`Appwrite ready: database=${databaseId}, collection=${collectionId}, bucket=${bucketId}`);
} catch (error) {
  if (!isAutoMode()) {
    console.error(`Appwrite setup failed in live mode. ${error.message}`);
    process.exit(1);
  }
  const schema = await ensureMockSchema();
  console.warn(`Live Appwrite is unavailable. Falling back to local mock mode. ${error.message}`);
  console.log(`Appwrite mock ready: database=${schema.databaseId}, collection=${schema.collectionId}, bucket=${schema.bucketId}`);
}
