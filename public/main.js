const fileList = document.querySelector('#file-list');
const emptyState = document.querySelector('#empty-state');
const previewPanel = document.querySelector('#preview-panel');
const previewTitle = document.querySelector('#preview-title');
const previewBody = document.querySelector('#preview-body');
const openLink = document.querySelector('#open-link');
const statusMessage = document.querySelector('#status-message');
const refreshButton = document.querySelector('#refresh-button');
const uploadForm = document.querySelector('#upload-form');

function formatBytes(size) {
  if (size < 1024) {
    return `${size} B`;
  }

  const units = ['KB', 'MB', 'GB'];
  let value = size;
  let unitIndex = -1;

  do {
    value /= 1024;
    unitIndex += 1;
  } while (value >= 1024 && unitIndex < units.length - 1);

  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function formatTimestamp(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.dataset.tone = isError ? 'error' : 'default';
}

function renderPreview(file) {
  previewPanel.classList.remove('hidden');
  previewTitle.textContent = file.name;
  previewBody.innerHTML = '';
  openLink.href = file.fileUrl;
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set('file', file.name);
  window.history.replaceState({}, '', nextUrl);

  if (file.previewType === 'text') {
    fetch(`/api/files/${encodeURIComponent(file.name)}/content`)
      .then((response) => response.text())
      .then((content) => {
        const textPreview = document.createElement('pre');
        textPreview.className = 'preview-text';
        textPreview.textContent = content;
        previewBody.replaceChildren(textPreview);
      })
      .catch(() => {
        previewBody.innerHTML =
          '<p class="preview-empty">Could not load this file preview right now.</p>';
      });
    return;
  }

  if (file.previewType === 'html') {
    const frame = document.createElement('iframe');
    frame.className = 'preview-frame';
    frame.setAttribute('sandbox', '');
    previewBody.append(frame);
    fetch(`/api/files/${encodeURIComponent(file.name)}/content`)
      .then((response) => response.text())
      .then((content) => {
        frame.srcdoc = content;
      })
      .catch(() => {
        previewBody.innerHTML =
          '<p class="preview-empty">Could not load this file preview right now.</p>';
      });
    return;
  }

  if (file.previewType === 'pdf') {
    const frame = document.createElement('iframe');
    frame.src = file.fileUrl;
    frame.className = 'preview-frame';
    previewBody.append(frame);
    return;
  }

  const copy = document.createElement('p');
  copy.className = 'preview-empty';
  copy.textContent = 'This file type does not have an in-app preview. Use Open to download or view it directly.';
  previewBody.append(copy);
}

function renderFileList(files) {
  fileList.innerHTML = '';
  emptyState.hidden = files.length > 0;

  files.forEach((file) => {
    const item = document.createElement('li');
    item.className = 'file-item';

    const info = document.createElement('div');
    info.className = 'file-meta';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'file-button';
    button.textContent = file.name;
    button.addEventListener('click', () => renderPreview(file));

    const details = document.createElement('p');
    details.className = 'file-details';
    details.textContent = `${file.previewType.toUpperCase()} • ${formatBytes(file.size)} • ${formatTimestamp(file.updatedAt)}`;

    info.append(button, details);

    const shareLink = document.createElement('a');
    shareLink.href = file.shareUrl;
    shareLink.target = '_blank';
    shareLink.rel = 'noreferrer';
    shareLink.className = 'secondary-button link-button';
    shareLink.textContent = 'Share';

    item.append(info, shareLink);
    fileList.append(item);
  });

  if (files[0]) {
    const requestedFile = new URL(window.location.href).searchParams.get('file');
    renderPreview(files.find((file) => file.name === requestedFile) || files[0]);
  } else {
    previewPanel.classList.add('hidden');
  }
}

async function loadFiles() {
  const response = await fetch('/api/files');
  if (!response.ok) {
    throw new Error('Could not load files.');
  }

  const payload = await response.json();
  renderFileList(payload.files);
}

async function uploadFile(event) {
  event.preventDefault();
  const formData = new FormData(uploadForm);
  setStatus('Uploading…');

  const response = await fetch('/api/files', {
    method: 'POST',
    body: formData,
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Upload failed.');
  }

  uploadForm.reset();
  setStatus(`Uploaded ${payload.file.name}.`);
  await loadFiles();
}

uploadForm.addEventListener('submit', (event) => {
  uploadFile(event).catch((error) => setStatus(error.message, true));
});

refreshButton.addEventListener('click', () => {
  loadFiles().catch((error) => setStatus(error.message, true));
});

loadFiles().catch((error) => setStatus(error.message, true));
