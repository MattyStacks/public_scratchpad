const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../server');

test('uploads, lists, and serves scratch files', async () => {
  const rootDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'scratchpad-root-'));
  const uploadDirectory = path.join(rootDirectory, 'uploads');
  const publicDirectory = path.join(rootDirectory, 'public');
  await fs.mkdir(publicDirectory, { recursive: true });
  await fs.writeFile(path.join(publicDirectory, 'index.html'), '<!doctype html><title>test</title>');

  const { app } = createApp({
    rootDirectory,
    uploadDirectory,
    rateLimitMaxRequests: 6,
    rateLimitWindowMs: 60_000,
  });
  const server = app.listen(0);

  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const formData = new FormData();
    formData.append('scratchFile', new Blob(['hello scratchpad'], { type: 'text/plain' }), 'notes.txt');

    const uploadResponse = await fetch(`${baseUrl}/api/files`, {
      method: 'POST',
      body: formData,
    });

    assert.equal(uploadResponse.status, 201);
    const uploadPayload = await uploadResponse.json();
    assert.equal(uploadPayload.file.previewType, 'text');
    assert.match(uploadPayload.file.name, /\.txt$/);

    const htmlFormData = new FormData();
    htmlFormData.append(
      'scratchFile',
      new Blob(['<h1>Hello HTML</h1>'], { type: 'text/html' }),
      'demo.html',
    );

    const htmlUploadResponse = await fetch(`${baseUrl}/api/files`, {
      method: 'POST',
      body: htmlFormData,
    });

    assert.equal(htmlUploadResponse.status, 201);
    const htmlUploadPayload = await htmlUploadResponse.json();
    assert.equal(htmlUploadPayload.file.previewType, 'html');
    assert.match(htmlUploadPayload.file.shareUrl, /^\/*\?file=/);

    const listResponse = await fetch(`${baseUrl}/api/files`);
    assert.equal(listResponse.status, 200);

    const listPayload = await listResponse.json();
    assert.equal(listPayload.files.length, 2);

    const htmlFile = listPayload.files.find((file) => file.previewType === 'html');
    assert.ok(htmlFile);

    const htmlContentResponse = await fetch(
      `${baseUrl}/api/files/${encodeURIComponent(htmlFile.name)}/content`,
    );
    assert.equal(htmlContentResponse.status, 200);
    assert.equal(await htmlContentResponse.text(), '<h1>Hello HTML</h1>');

    const htmlFileResponse = await fetch(`${baseUrl}${htmlFile.fileUrl}`);
    assert.equal(htmlFileResponse.status, 200);
    assert.match(htmlFileResponse.headers.get('content-disposition') || '', /attachment/);

    const textFile = listPayload.files.find((file) => file.previewType === 'text');
    assert.ok(textFile);

    const fileResponse = await fetch(`${baseUrl}${textFile.fileUrl}`);
    assert.equal(fileResponse.status, 200);
    assert.equal(await fileResponse.text(), 'hello scratchpad');

    await fs.mkdir(path.join(uploadDirectory, 'nested'), { recursive: true });

    const directoryResponse = await fetch(`${baseUrl}/files/nested`);
    assert.equal(directoryResponse.status, 404);

    const missingPreviewResponse = await fetch(`${baseUrl}/api/files/nested/content`);
    assert.equal(missingPreviewResponse.status, 404);

    const limitedResponses = await Promise.all([
      fetch(`${baseUrl}/api/files/${encodeURIComponent(textFile.name)}/content`),
      fetch(`${baseUrl}/api/files/${encodeURIComponent(textFile.name)}/content`),
      fetch(`${baseUrl}/api/files/${encodeURIComponent(textFile.name)}/content`),
      fetch(`${baseUrl}/api/files/${encodeURIComponent(textFile.name)}/content`),
    ]);

    assert.equal(limitedResponses.at(-1).status, 429);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await fs.rm(rootDirectory, { recursive: true, force: true });
  }
});
