const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { JSDOM } = require('jsdom');

async function flush(window) {
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

test('loads the requested file preview from the query string', async () => {
  const rootDirectory = path.join(__dirname, '..');
  const html = await fs.readFile(path.join(rootDirectory, 'public', 'index.html'), 'utf8');
  const script = await fs.readFile(path.join(rootDirectory, 'public', 'main.js'), 'utf8');

  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'http://localhost:3000/?file=target-notes.txt',
  });

  const files = [
    {
      name: 'first-file.txt',
      previewType: 'text',
      size: 12,
      updatedAt: '2026-09-24T19:00:00.000Z',
      fileUrl: '/files/first-file.txt',
      shareUrl: '/files/first-file.txt',
    },
    {
      name: 'target-notes.txt',
      previewType: 'text',
      size: 24,
      updatedAt: '2026-09-24T19:01:00.000Z',
      fileUrl: '/files/target-notes.txt',
      shareUrl: '/files/target-notes.txt',
    },
  ];

  dom.window.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input.url;

    if (url === '/api/files') {
      return {
        ok: true,
        json: async () => ({ files }),
      };
    }

    if (url === '/api/files/target-notes.txt/content') {
      return {
        ok: true,
        text: async () => 'requested preview content',
      };
    }

    if (url === '/api/files/first-file.txt/content') {
      return {
        ok: true,
        text: async () => 'first preview content',
      };
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  dom.window.eval(script);
  await flush(dom.window);
  await flush(dom.window);

  assert.equal(
    dom.window.document.querySelector('#preview-title').textContent,
    'target-notes.txt',
  );
  assert.equal(
    dom.window.document.querySelector('.preview-text').textContent,
    'requested preview content',
  );
  assert.match(dom.window.document.querySelector('#open-link').href, /target-notes\.txt$/);
});
