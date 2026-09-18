import 'dotenv/config';
import fs from 'node:fs/promises';

const state = JSON.parse(await fs.readFile('.mock-appwrite.json', 'utf8'));
const owners = new Set(state.files.map((file) => file.ownerId));
const valid = state.schema?.databaseId && state.schema?.collectionId && state.schema?.bucketId
  && state.users.length >= 3 && state.files.length >= 3 && owners.size >= 3
  && state.files.every((file) => file.permissions?.includes(`user:${file.ownerId}`));
if (!valid) {
  console.error('Mock verification failed: expected schema, 3 users, and one owner-scoped file per user.');
  process.exit(1);
}
console.log(`Mock verification passed: ${state.users.length} users, ${state.files.length} files, ${owners.size} isolated owners.`);
