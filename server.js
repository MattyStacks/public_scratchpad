const express = require('express');
const { rateLimit } = require('express-rate-limit');
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

function toHeaderFilename(filename) {
  return filename.replace(/["\\\r\n]/g, '-');
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
  const files = (
    await Promise.all(
      fileNames.map(async (fileName) => {
      const filePath = path.join(uploadDirectory, fileName);
      const stats = await fsp.stat(filePath);

      if (!stats.isFile()) {
        return null;
      }

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
    )
  ).filter(Boolean);

  return files.sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
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
  const rateLimitWindowMs = options.rateLimitWindowMs || RATE_LIMIT_WINDOW_MS;
  const rateLimitMaxRequests = options.rateLimitMaxRequests || RATE_LIMIT_MAX_REQUESTS;
  fs.mkdirSync(uploadDirectory, { recursive: true });

  const upload = multer({
    storage: createStorage(uploadDirectory),
    limits: {
      fileSize: 20 * 1024 * 1024,
    },
  });

  const app = express();
  const fileReadLimiter = rateLimit({
    windowMs: rateLimitWindowMs,
    limit: rateLimitMaxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again soon.' },
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

  async function resolveScratchFile(fileName) {
    const safeFileName = path.basename(fileName);
    const filePath = path.join(uploadDirectory, safeFileName);

    try {
      const stats = await fsp.stat(filePath);
      if (!stats.isFile()) {
        return null;
      }

      return { filePath, fileName: safeFileName };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }

      throw error;
    }
  }

  app.get('/api/files/:fileName/content', fileReadLimiter, async (req, res, next) => {
    try {
      const scratchFile = await resolveScratchFile(req.params.fileName);
      if (!scratchFile) {
        return res.status(404).json({ error: 'File not found.' });
      }

      const previewType = getPreviewType(scratchFile.filePath);
      if (previewType !== 'text' && previewType !== 'html') {
        return res.status(400).json({ error: 'This file type cannot be previewed as text.' });
      }

      const content = await fsp.readFile(scratchFile.filePath, 'utf8');
      res.type('text/plain').send(content);
    } catch (error) {
      next(error);
    }
  });

  app.get('/files/:fileName', fileReadLimiter, async (req, res, next) => {
    try {
      const scratchFile = await resolveScratchFile(req.params.fileName);
      if (!scratchFile) {
        return res.status(404).send('File not found.');
      }

      const previewType = getPreviewType(scratchFile.filePath);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader(
        'Content-Disposition',
        `${previewType === 'html' ? 'attachment' : 'inline'}; filename="${toHeaderFilename(
          scratchFile.fileName,
        )}"`,
      );
      res.sendFile(scratchFile.filePath);
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
