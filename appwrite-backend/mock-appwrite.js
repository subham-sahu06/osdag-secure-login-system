import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import process from 'node:process';

const statePath = path.join(process.cwd(), '.mock-appwrite.json');

export function isMockMode() {
  return process.env.APPWRITE_MODE === 'mock';
}

export function isAutoMode() {
  return process.env.APPWRITE_MODE !== 'live';
}

export async function withRetry(action, label, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  const endpoint = process.env.APPWRITE_ENDPOINT || '(missing APPWRITE_ENDPOINT)';
  const hint = `Unable to reach ${endpoint} while ${label}. Check APPWRITE_ENDPOINT, port mapping, project ID, and API key.`;
  const wrapped = new Error(`${hint} Original error: ${lastError?.message || lastError}`);
  wrapped.cause = lastError;
  throw wrapped;
}

export async function ensureMockSchema() {
  const state = await readState();
  state.schema = {
    databaseId: process.env.APPWRITE_DATABASE_ID || 'osdag',
    collectionId: process.env.APPWRITE_COLLECTION_ID || 'files',
    bucketId: process.env.APPWRITE_BUCKET_ID || 'files',
    attributes: ['ownerId', 'filename', 'storageFileId', 'contentType'],
    permissions: 'per-user read/create/update/delete',
  };
  await writeState(state);
  return state.schema;
}

export async function seedMockUsers() {
  const state = await readState();
  const schema = state.schema || await ensureMockSchema();
  const password = process.env.SEED_PASSWORD || 'Password123!';
  for (const [index, email] of ['user1@test.com', 'user2@test.com', 'user3@test.com'].entries()) {
    let user = state.users.find((item) => item.email === email);
    if (!user) {
      user = { $id: crypto.randomUUID(), email, name: `Test User ${index + 1}`, password };
      state.users.push(user);
    }
    if (!state.files.some((file) => file.ownerId === user.$id)) {
      const filename = `user-${index + 1}-document.txt`;
      state.files.push({
        $id: crypto.randomUUID(),
        ownerId: user.$id,
        filename,
        storageFileId: crypto.randomUUID(),
        contentType: 'text/plain',
        content: `Private fixture for ${email}\n`,
        permissions: [`user:${user.$id}`],
      });
    }
  }
  state.schema = schema;
  state.updatedAt = new Date().toISOString();
  await writeState(state);
  return { users: state.users.length, files: state.files.length, schema };
}

async function readState() {
  try {
    return JSON.parse(await fs.readFile(statePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { schema: null, users: [], files: [], sessions: [] };
  }
}

async function writeState(state) {
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}
