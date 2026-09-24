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

  const { app } = createApp({ rootDirectory, uploadDirectory });
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

    const listResponse = await fetch(`${baseUrl}/api/files`);
    assert.equal(listResponse.status, 200);

    const listPayload = await listResponse.json();
    assert.equal(listPayload.files.length, 1);

    const fileResponse = await fetch(`${baseUrl}${listPayload.files[0].url}`);
    assert.equal(fileResponse.status, 200);
    assert.equal(await fileResponse.text(), 'hello scratchpad');
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await fs.rm(rootDirectory, { recursive: true, force: true });
  }
});
