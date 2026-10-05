/* eslint-disable */
const Tesseract = require('tesseract.js');
const OCRSpaceService = require('./ocrSpaceService');
const fs = require('fs');
const path = require('path');

const isVercelRuntime = () => process.env.VERCEL === 'true' || process.env.VERCEL === true || process.env.VERCEL === '1';

// VERCEL FIX: Use a robust pdf-parse import that supports ESM/CJS default exports.
let pdfParse;
try {
  const rawPdfParse = require('pdf-parse');
  pdfParse = typeof rawPdfParse === 'function'
    ? rawPdfParse
    : (rawPdfParse && typeof rawPdfParse.default === 'function'
      ? rawPdfParse.default
      : (rawPdfParse && typeof rawPdfParse.pdfParse === 'function' ? rawPdfParse.pdfParse : null));
} catch (e) {
  console.error('pdf-parse initialization failed:', e);
}

class OCRRouter {
  constructor() {
    this.ocrSpaceService = new OCRSpaceService();
  }

  async route(filePath, options = {}) {
    const { mimetype = null, imageBuffer = null, engine = '2' } = options;
    const source = imageBuffer || filePath;

    // Check if it's a PDF
    const isPDF = mimetype === 'application/pdf' ||
                 (typeof filePath === 'string' && filePath.toLowerCase().endsWith('.pdf'));

    if (isPDF) {
      try {
        console.log('--- Attempting digital PDF Parse ---');
        // Handle both Buffer and Path safely
        const dataBuffer = Buffer.isBuffer(source) ? source : fs.readFileSync(source);

        // VERCEL FIX: Handle different export styles and guard against default-export issues.
        const parseFunc = typeof pdfParse === 'function'
          ? pdfParse
          : (pdfParse && typeof pdfParse.default === 'function'
            ? pdfParse.default
            : (pdfParse && typeof pdfParse.pdfParse === 'function' ? pdfParse.pdfParse : null));

        if (parseFunc) {
          const data = await parseFunc(dataBuffer);
          if (data && data.text && data.text.trim().length > 0) return data.text;
        }

        console.log('Digital parse empty or failed. Trying OCR.space...');
        return await this.ocrSpaceService.recognizeHandwritingFromBuffer(dataBuffer, engine);
      } catch (err) {
        if (err.code === 'HF_TIMEOUT') throw err;
        console.error('PDF Extraction failed:', err.message);
        // Ensure we pass a Buffer to the fallback, not a path string that might not exist
        const fallbackBuffer = Buffer.isBuffer(source) ? source : fs.readFileSync(source);
        return await this.ocrSpaceService.recognizeHandwritingFromBuffer(fallbackBuffer, engine);
      }
    }

    // Handle Images
    try {
      return await this.ocrSpaceService.recognizeHandwritingFromBuffer(source, engine);
    } catch (err) {
      if (err.code === 'HF_TIMEOUT') throw err;

      if (isVercelRuntime()) {
        console.warn('[OCR Router] Vercel detected: skipping local Tesseract WASM fallback and letting the caller use Gemini Vision on the original image buffer.');

        if (typeof options.onVisionFallback === 'function') {
          return await options.onVisionFallback(source);
        }

        const skipErr = new Error('Vercel bypasses local Tesseract; Gemini Vision fallback must handle this image buffer.');
        skipErr.code = 'VERCEL_TESSERACT_BYPASS';
        throw skipErr;
      }

      console.log('OCR.space failed, using local Tesseract fallback...');
      return await this.processWithTesseract(source);
    }
  }

  async processWithTesseract(imageSource) {
    if (isVercelRuntime()) {
      console.warn('[OCR Router] Skipping local Tesseract entirely on Vercel to avoid WASM ENOENT/Aborted crashes.');
      return '';
    }

    try {
      const { data: { text } } = await Tesseract.recognize(imageSource, 'eng');
      return text || '';
    } catch (err) {
      const message = (err && (err.message || String(err))) || '';
      const isWasmInitFailure = /ENOENT|Aborted|tesseract\.wasm|Failed to fetch|fetch failed|wasm/i.test(message);

      if (isWasmInitFailure) {
        console.warn('[OCR Router] Tesseract WASM initialization failed safely; falling back to Gemini Vision instead of crashing the process.', message);
      } else {
        console.warn('[OCR Router] Local Tesseract failed safely:', message || 'unknown Tesseract error');
      }

      return '';
    }
  }

  async processStudentPaper(imagePath, imageBuffer = null) {
    // Use engine '3' for handwriting detection on student submissions
    return await this.route(imagePath, { imageBuffer, engine: '3' });
  }

  async processAnswerKey(filePath, mimetype = null, fileBuffer = null) {
    // Use engine '2' for fast digital text extraction on answer keys
    return await this.route(filePath, { mimetype, imageBuffer: fileBuffer, engine: '2' });
  }
}

module.exports = OCRRouter;