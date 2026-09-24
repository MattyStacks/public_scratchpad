# public_scratchpad

A tiny Node-based scratchpad for quickly sharing HTML files, PDFs, text files, and other loose documents.

## What it does

- Upload files from the browser
- Generate direct share links for each uploaded file
- Preview HTML, text-like files, and PDFs in-app
- Keep everything in a simple local `uploads/` directory

## Run it locally

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

## Notes

- Uploaded files are stored in `uploads/`
- Individual files are served from `/files/<generated-name>`
- HTML files use a scratchpad preview link so the markup renders inside a sandboxed iframe instead of running in the app origin
- Files larger than 20 MB are rejected