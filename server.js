const express = require('express');
const multer = require('multer');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const DEFAULT_PORT = process.env.PORT || 3000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 120;
const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.json',
  '.csv',
  '.log',
  '.html',
  '.htm',
  '.css',
  '.js',
]);

function sanitizeFilename(filename) {
  return filename.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-');
}

function getPreviewType(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === '.pdf') {
    return 'pdf';
  }

  if (extension === '.html' || extension === '.htm') {
    return 'html';
  }

  if (TEXT_EXTENSIONS.has(extension)) {
    return 'text';
  }

  return 'download';
}

async function ensureDirectory(directory) {
  await fsp.mkdir(directory, { recursive: true });
}

async function readScratchFiles(uploadDirectory) {
  await ensureDirectory(uploadDirectory);
  const fileNames = await fsp.readdir(uploadDirectory);
  const files = await Promise.all(
    fileNames.map(async (fileName) => {
      const filePath = path.join(uploadDirectory, fileName);
      const stats = await fsp.stat(filePath);

      return {
        name: fileName,
        size: stats.size,
        updatedAt: stats.mtime.toISOString(),
        previewType: getPreviewType(fileName),
        fileUrl: `/files/${encodeURIComponent(fileName)}`,
        shareUrl:
          getPreviewType(fileName) === 'html'
            ? `/?file=${encodeURIComponent(fileName)}`
            : `/files/${encodeURIComponent(fileName)}`,
      };
    }),
  );

  return files.sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
}

function createRateLimit({ windowMs, maxRequests }) {
  const requestsByIp = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || 'unknown';
    const recentRequests = (requestsByIp.get(key) || []).filter(
      (timestamp) => now - timestamp < windowMs,
    );

    recentRequests.push(now);
    requestsByIp.set(key, recentRequests);

    if (recentRequests.length > maxRequests) {
      return res.status(429).json({ error: 'Too many requests. Please try again soon.' });
    }

    next();
  };
}

function createStorage(uploadDirectory) {
  return multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, uploadDirectory),
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname);
      const baseName = path.basename(file.originalname, extension) || 'scratch-file';
      const safeBaseName = sanitizeFilename(baseName);
      callback(null, `${Date.now()}-${randomUUID()}-${safeBaseName}${extension.toLowerCase()}`);
    },
  });
}

function createApp(options = {}) {
  const rootDirectory = options.rootDirectory || __dirname;
  const uploadDirectory = options.uploadDirectory || path.join(rootDirectory, 'uploads');
  fs.mkdirSync(uploadDirectory, { recursive: true });

  const upload = multer({
    storage: createStorage(uploadDirectory),
    limits: {
      fileSize: 20 * 1024 * 1024,
    },
  });

  const app = express();
  const fileReadLimiter = createRateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: RATE_LIMIT_MAX_REQUESTS,
  });
  app.use(express.static(path.join(rootDirectory, 'public')));

  app.get('/api/files', async (_req, res, next) => {
    try {
      const files = await readScratchFiles(uploadDirectory);
      res.json({ files });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/files', upload.single('scratchFile'), async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Select a file to upload.' });
      }

      const files = await readScratchFiles(uploadDirectory);
      const uploadedFile = files.find((file) => file.name === req.file.filename);
      res.status(201).json({ file: uploadedFile });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/files/:fileName/content', fileReadLimiter, async (req, res, next) => {
    try {
      const fileName = path.basename(req.params.fileName);
      const filePath = path.join(uploadDirectory, fileName);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found.' });
      }

      const previewType = getPreviewType(filePath);
      if (previewType !== 'text' && previewType !== 'html') {
        return res.status(400).json({ error: 'This file type cannot be previewed as text.' });
      }

      const content = await fsp.readFile(filePath, 'utf8');
      res.type('text/plain').send(content);
    } catch (error) {
      next(error);
    }
  });

  app.get('/files/:fileName', fileReadLimiter, async (req, res, next) => {
    try {
      const fileName = path.basename(req.params.fileName);
      const filePath = path.join(uploadDirectory, fileName);

      if (!fs.existsSync(filePath)) {
        return res.status(404).send('File not found.');
      }

      const previewType = getPreviewType(filePath);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader(
        'Content-Disposition',
        `${previewType === 'html' ? 'attachment' : 'inline'}; filename="${fileName}"`,
      );
      res.sendFile(filePath);
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _req, res, _next) => {
    const statusCode = error.code === 'LIMIT_FILE_SIZE' ? 413 : 500;
    res.status(statusCode).json({
      error: statusCode === 413 ? 'File is larger than the 20 MB limit.' : 'Something went wrong.',
    });
  });

  return { app, uploadDirectory };
}

async function startServer() {
  const { app, uploadDirectory } = createApp();
  await ensureDirectory(uploadDirectory);

  app.listen(DEFAULT_PORT, () => {
    console.log(`Scratchpad running at http://localhost:${DEFAULT_PORT}`);
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  createApp,
  getPreviewType,
  readScratchFiles,
  sanitizeFilename,
};
