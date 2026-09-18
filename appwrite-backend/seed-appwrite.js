import 'dotenv/config';
import { Client, Databases, ID, Permission, Query, Role, Storage, Users } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';
import fs from 'node:fs/promises';
import { isAutoMode, isMockMode, seedMockUsers, withRetry } from './mock-appwrite.js';

const databaseId = process.env.APPWRITE_DATABASE_ID || 'osdag';
const collectionId = process.env.APPWRITE_COLLECTION_ID || 'files';
const bucketId = process.env.APPWRITE_BUCKET_ID || 'files';
const password = process.env.SEED_PASSWORD || 'Password123!';

if (isMockMode()) {
  const result = await seedMockUsers();
  await fs.writeFile('.seed-complete', new Date().toISOString());
  console.log(`Seeded local Appwrite mock: ${result.users} users, ${result.files} private files.`);
  process.exit(0);
}

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT || 'http://localhost:80/v1')
  .setProject(process.env.APPWRITE_PROJECT_ID || 'local-dev')
  .setKey(process.env.APPWRITE_API_KEY || 'local-dev-key');
const users = new Users(client);
const databases = new Databases(client);
const storage = new Storage(client);

try {
  await withRetry(async () => {
    for (const [index, email] of ['user1@test.com', 'user2@test.com', 'user3@test.com'].entries()) {
      let user;
      try {
        user = await users.create(ID.unique(), email, undefined, password, `Test User ${index + 1}`);
      } catch (error) {
        if (error.code !== 409) throw error;
        user = (await users.list([Query.equal('email', email)])).users[0];
      }
      const filename = `user-${index + 1}-document.txt`;
      const buffer = Buffer.from(`Private fixture for ${email}\n`);
      const file = await storage.createFile(
        bucketId,
        ID.unique(),
        InputFile.fromBuffer(buffer, filename),
        [Permission.read(Role.user(user.$id))],
      );
      await databases.createDocument(
        databaseId,
        collectionId,
        ID.unique(),
        { ownerId: user.$id, filename, storageFileId: file.$id, contentType: 'text/plain' },
        [Permission.read(Role.user(user.$id))],
      );
    }
  }, 'seeding Appwrite users and files');
  await fs.writeFile('.seed-complete', new Date().toISOString());
  console.log('Seeded 3 Appwrite users with one private file each.');
} catch (error) {
  if (!isAutoMode()) {
    console.error(`Appwrite seed failed in live mode. ${error.message}`);
    process.exit(1);
  }
  const result = await seedMockUsers();
  await fs.writeFile('.seed-complete', new Date().toISOString());
  console.warn(`Live Appwrite is unavailable. Falling back to local mock mode. ${error.message}`);
  console.log(`Seeded local Appwrite mock: ${result.users} users, ${result.files} private files.`);
}
