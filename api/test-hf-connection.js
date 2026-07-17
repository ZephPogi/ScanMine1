/**
 * test-hf-connection.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Isolated smoke-test for the Hugging Face YOLOv8 + TrOCR hybrid endpoint.
 *
 * What this script validates:
 *   ✅  Axios can reach the HF Space URL
 *   ✅  FormData appends the image buffer under the key 'file'
 *   ✅  FastAPI returns HTTP 200 with a { text: "..." } body
 *   ✅  Cold-start timeouts are caught and reported clearly
 *   ✅  Any 422 / 4xx / 5xx errors are printed in detail
 *
 * Usage:
 *   node api/test-hf-connection.js
 *   node api/test-hf-connection.js path/to/your/image.jpg
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

// ── Config ──────────────────────────────────────────────────────────────────

// Replace with your real HF Space subdomain when you're ready, e.g.:
//   "https://zephpogi-scanmine-trocr.hf.space/extract-text"
const HF_ENDPOINT = 'https://zephpogi-scanmine-trocr.hf.space/extract-text';

// How long to wait (ms).  120 s accommodates a cold-start wake-up.
const TIMEOUT_MS = 120_000;

// Default sample image: use the first real .jpg we can find in uploads/
const DEFAULT_IMAGE = resolveDefaultImage();

// ── Helpers ─────────────────────────────────────────────────────────────────

function resolveDefaultImage() {
  // CLI override: node test-hf-connection.js /path/to/image.jpg
  const arg = process.argv[2];
  if (arg) {
    const resolved = path.resolve(arg);
    if (fs.existsSync(resolved)) return resolved;
    console.error(`[WARN] Provided path does not exist: ${resolved}`);
  }

  // Fall back to a known upload from the uploads directory
  const candidates = [
    path.join(__dirname, '..', 'uploads', '1777603143826-994306566.jpg'),
    path.join(__dirname, '..', 'uploads', '1777603297486-919829552.jpg'),
    path.join(__dirname, '..', 'uploads', '1777603555690-521061651.jpg'),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  // Last resort: grab any .jpg in uploads/
  const uploadsDir = path.join(__dirname, '..', 'uploads');
  if (fs.existsSync(uploadsDir)) {
    const jpg = fs.readdirSync(uploadsDir).find(f => f.endsWith('.jpg'));
    if (jpg) return path.join(uploadsDir, jpg);
  }

  return null;
}

function detectMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.png') return 'image/png';
  return 'image/jpeg'; // default for .jpg, .jpeg, and unknown
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function testHFConnection() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   ScanMine — HF YOLOv8 + TrOCR Connection Test              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // ── 1. Validate image ────────────────────────────────────────────────────
  if (!DEFAULT_IMAGE) {
    console.error('❌  No test image found.');
    console.error('    Run:  node api/test-hf-connection.js /path/to/your/image.jpg');
    process.exit(1);
  }

  const imageBuffer = fs.readFileSync(DEFAULT_IMAGE);
  const mimeType = detectMimeType(DEFAULT_IMAGE);
  const filename = path.basename(DEFAULT_IMAGE);

  console.log('📁  Image file   :', DEFAULT_IMAGE);
  console.log('📦  File size    :', formatBytes(imageBuffer.length));
  console.log('🖼   MIME type   :', mimeType);
  console.log('🌐  HF endpoint  :', HF_ENDPOINT);
  console.log('⏱   Timeout     :', TIMEOUT_MS / 1000, 's');
  console.log('');

  // ── 2. Build FormData — key MUST be 'file' for FastAPI UploadFile ────────
  const form = new FormData();
  form.append('file', imageBuffer, {
    filename,
    contentType: mimeType,
  });

  const formHeaders = form.getHeaders();
  console.log('📋  Request headers:');
  console.log('   ', JSON.stringify(formHeaders, null, 4).replace(/\n/g, '\n    '));
  console.log('');

  // ── 3. Send request ──────────────────────────────────────────────────────
  console.log('🚀  Sending POST request to HF Space...');
  console.log('    (If the Space is sleeping, this may take 30-60 s to wake up)');
  console.log('');

  const startTime = Date.now();

  try {
    const response = await axios.post(HF_ENDPOINT, form, {
      headers: formHeaders,
      timeout: TIMEOUT_MS,
      // Prevent axios from choking on large response bodies
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✅  SUCCESS  (${elapsed} s)`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('📊  HTTP status  :', response.status, response.statusText);
    console.log('');
    console.log('📝  Raw response body:');
    console.log('    ', JSON.stringify(response.data, null, 4).replace(/\n/g, '\n    '));
    console.log('');

    // ── 4. Validate response shape ───────────────────────────────────────
    const extractedText = response.data?.text;

    if (typeof extractedText === 'undefined') {
      console.warn('⚠️   The response body has no "text" field.');
      console.warn('    Expected: { "text": "B\\nC\\nC\\nB" }');
      console.warn('    Check your FastAPI route is returning { "text": ... }');
    } else if (extractedText.trim() === '') {
      console.warn('⚠️   The "text" field is empty.');
      console.warn('    The model ran but found no answer boxes in this image.');
      console.warn('    Try a clearer image with visible answer bubbles/boxes.');
    } else {
      const lines = extractedText.split('\n').filter(l => l.trim());
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`🎉  Extracted ${lines.length} answer token(s):`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      lines.forEach((line, i) => {
        console.log(`    Q${i + 1}: ${line.trim()}`);
      });
      console.log('');
      console.log('✅  Parser mapping preview (as gradeSubmission will see it):');
      const previewMap = {};
      lines.forEach((line, i) => { previewMap[i + 1] = line.trim().toUpperCase(); });
      console.log('   ', JSON.stringify(previewMap, null, 4).replace(/\n/g, '\n    '));
    }

  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error(`❌  FAILED  (${elapsed} s)`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');

    // ── Timeout ──────────────────────────────────────────────────────────
    if (err.code === 'ECONNABORTED' || (err.message && err.message.includes('timeout'))) {
      console.error('🕐  TIMEOUT — the Hugging Face Space did not respond within', TIMEOUT_MS / 1000, 's.');
      console.error('');
      console.error('    Possible causes:');
      console.error('      • The Space is on a free tier and took too long to wake up.');
      console.error('        → Wait 60 s and retry: node api/test-hf-connection.js');
      console.error('      • Your FastAPI /extract-text route is hanging on inference.');
      console.error('        → Check the HF Space logs at:');
      console.error('          https://huggingface.co/spaces/YOUR-HF-USERNAME/YOUR-SPACE/logs');
      process.exit(2);
    }

    // ── HTTP error (4xx / 5xx) ────────────────────────────────────────────
    if (err.response) {
      console.error('🔴  HTTP', err.response.status, err.response.statusText);
      console.error('');
      console.error('    Response body:');
      console.error('   ', JSON.stringify(err.response.data, null, 4).replace(/\n/g, '\n    '));
      console.error('');

      if (err.response.status === 422) {
        console.error('💡  422 Unprocessable Entity — FastAPI rejected the payload.');
        console.error('    The most common cause: the form field key is NOT "file".');
        console.error('    Your current code uses:  form.append("file", buffer, ...)');
        console.error('    Make sure your FastAPI route declares:');
        console.error('      async def extract_text(file: UploadFile = File(...)):');
      }

      if (err.response.status === 503) {
        console.error('💡  503 Service Unavailable — Space is still loading / cold-starting.');
        console.error('    Wait ~60 s and retry.');
      }

      process.exit(3);
    }

    // ── Network / DNS error ───────────────────────────────────────────────
    console.error('🌐  Network error:', err.message);
    console.error('');
    console.error('    Possible causes:');
    console.error('      • "YOUR-HF-SPACE-URL" was never replaced in the script.');
    console.error(`        Current value: "${HF_ENDPOINT}"`);
    console.error('      • No internet access from this machine.');
    console.error('      • The HF Space was deleted or renamed.');
    process.exit(4);
  }
}

testHFConnection();
