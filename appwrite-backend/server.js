import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { Account, Client, Databases, ID, InputFile, Permission, Query, Role, Storage } from 'node-appwrite';

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const port = Number(process.env.PORT || 8001);
const databaseId = process.env.APPWRITE_DATABASE_ID || 'osdag';
const collectionId = process.env.APPWRITE_COLLECTION_ID || 'files';
const bucketId = process.env.APPWRITE_BUCKET_ID || 'files';
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use('/login', rateLimit({ windowMs: 60_000, limit: 5, standardHeaders: true }));

function clientForSession(req) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) throw Object.assign(new Error('Unauthorized'), { status: 401 });
  return new Client().setEndpoint(process.env.APPWRITE_ENDPOINT).setProject(process.env.APPWRITE_PROJECT_ID).setSession(token);
}

async function context(req) {
  const client = clientForSession(req);
  const account = new Account(client);
  return { client, account, user: await account.get() };
}

function sendError(res, error) {
  const status = error.status || error.code || 500;
  res.status(status >= 400 && status < 600 ? status : 500).json({ error: status === 401 ? 'Unauthorized' : error.message || 'Request failed' });
}

app.post('/register', async (req, res) => {
  try {
    const { email, password, name = '' } = req.body;
    if (!email || !password || password.length < 8) return res.status(400).json({ error: 'Valid email and password are required' });
    const client = new Client().setEndpoint(process.env.APPWRITE_ENDPOINT).setProject(process.env.APPWRITE_PROJECT_ID);
    const user = await new Account(client).create(ID.unique(), email.toLowerCase(), password, name);
    res.status(201).json({ id: user.$id, email: user.email });
  } catch (error) { sendError(res, error); }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const client = new Client().setEndpoint(process.env.APPWRITE_ENDPOINT).setProject(process.env.APPWRITE_PROJECT_ID);
    const session = await new Account(client).createEmailPasswordSession(email.toLowerCase(), password);
    res.json({ token: session.secret, access_token: session.secret, token_type: 'bearer', expires_at: session.expire });
  } catch (error) { res.status(401).json({ error: 'Invalid credentials' }); }
});

app.post('/logout', async (req, res) => {
  try { await (await context(req)).account.deleteSession('current'); res.json({ message: 'Successfully logged out' }); }
  catch (error) { sendError(res, error); }
});

app.get('/me', async (req, res) => {
  try { const { user } = await context(req); res.json({ id: user.$id, email: user.email, name: user.name }); }
  catch (error) { sendError(res, error); }
});

app.get('/files', async (req, res) => {
  try {
    const { client, user } = await context(req);
    const documents = await new Databases(client).listDocuments(databaseId, collectionId, [Query.equal('ownerId', user.$id)]);
    res.json(documents.documents.map(({ $id, ownerId, filename, contentType, storageFileId }) => ({ id: $id, owner_id: ownerId, filename, filepath: storageFileId, content_type: contentType })));
  } catch (error) { sendError(res, error); }
});

app.get('/files/:id', async (req, res) => {
  try {
    const { client, user } = await context(req);
    const document = await new Databases(client).getDocument(databaseId, collectionId, req.params.id);
    if (document.ownerId !== user.$id) return res.status(403).json({ error: 'Access forbidden' });
    res.json({ id: document.$id, owner_id: document.ownerId, filename: document.filename, filepath: document.storageFileId, content_type: document.contentType });
  } catch (error) { sendError(res, error); }
});

app.get('/files/:id/download', async (req, res) => {
  try {
    const { client, user } = await context(req);
    const document = await new Databases(client).getDocument(databaseId, collectionId, req.params.id);
    if (document.ownerId !== user.$id) return res.status(403).json({ error: 'Access forbidden' });
    const bytes = await new Storage(client).getFileDownload(bucketId, document.storageFileId);
    res.type(document.contentType || 'application/octet-stream').attachment(document.filename).send(Buffer.from(bytes));
  } catch (error) { sendError(res, error); }
});

app.post('/files/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'File is required' });
    const { client, user } = await context(req);
    const storage = new Storage(client);
    const file = await storage.createFile(bucketId, ID.unique(), InputFile.fromBuffer(req.file.buffer, req.file.originalname), [Permission.read(Role.user(user.$id))]);
    const document = await new Databases(client).createDocument(databaseId, collectionId, ID.unique(), { ownerId: user.$id, filename: req.file.originalname, storageFileId: file.$id, contentType: req.file.mimetype }, [Permission.read(Role.user(user.$id)), Permission.update(Role.user(user.$id)), Permission.delete(Role.user(user.$id))]);
    res.status(201).json({ id: document.$id, owner_id: user.$id, filename: req.file.originalname, filepath: file.$id, content_type: req.file.mimetype });
  } catch (error) { sendError(res, error); }
});

app.listen(port, () => console.log(`Appwrite bridge listening on http://localhost:${port}`));
