const Tesseract = require('tesseract.js');
const OCRSpaceService = require('./ocrSpaceService');
const fs = require('fs');
const path = require('path');

/**
 * VERCEL-SAFE PDF IMPORT
 * We check multiple export patterns to ensure pdf-parse loads as a function
 * regardless of whether Vercel uses CommonJS or ESM bundling.
 */
let pdf;
try {
  const pdfLib = require('pdf-parse');
  pdf = typeof pdfLib === 'function' ? pdfLib : (pdfLib.default || pdfLib);
} catch (e) {
  console.error("Initial PDF load failed, trying internal path...");
  try {
    // Fallback for older Node environments
    pdf = require('pdf-parse/lib/pdf-parse');
  } catch (err) {
    console.error("PDF-Parse could not be initialized.");
  }
}

class OCRRouter {
  constructor() {
    this.ocrSpaceService = new OCRSpaceService();
  }

  async route(filePath, options = {}) {
    const { mimetype = null, forceEngine = null, imageBuffer = null } = options;
    const source = imageBuffer || filePath;
    const isPDF = mimetype === 'application/pdf' || 
                 (typeof filePath === 'string' && filePath.toLowerCase().endsWith('.pdf'));

    if (isPDF) {
      try {
        console.log('--- Attempting PDF Parse ---');
        const dataBuffer = Buffer.isBuffer(source) ? source : fs.readFileSync(source);
        
        if (typeof pdf !== 'function') throw new Error('PDF library not loaded');

        const data = await pdf(dataBuffer);
        
        // If PDF is scanned (no text layer), use Tesseract
        if (!data.text || data.text.trim().length === 0) {
          return await this.processWithTesseract(dataBuffer);
        }
        return data.text;
      } catch (err) {
        console.error('PDF Parse failed, falling back to Tesseract:', err.message);
        return await this.processWithTesseract(source);
      }
    }

    // Default to Handwriting/OCR Space for images
    if (forceEngine === 'ocrspace' || !isPDF) {
      try {
        return await this.ocrSpaceService.recognizeHandwritingFromBuffer(source);
      } catch (err) {
        return await this.processWithTesseract(source);
      }
    }
  }

  async processWithTesseract(imageSource) {
    console.log('--- Running External CDN Tesseract ---');
    
    /**
     * VERCEL-SAFE TESSERACT
     * We bypass local node_modules to avoid ENOENT errors by 
     * pointing directly to official CDNs for the WASM 'brain'.
     */
    const worker = await Tesseract.createWorker('eng', 1, {
      workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@v5.0.0/dist/worker.min.js',
      langPath: 'https://tessdata.projectnaptha.com/4.0.0',
      corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@v5.0.0/tesseract-core.wasm.js'
    });

    try {
      const { data: { text } } = await worker.recognize(imageSource);
      await worker.terminate();
      return text;
    } catch (err) {
      if (worker) await worker.terminate();
      console.error('Tesseract failed:', err.message);
      return "";
    }
  }

  async processStudentPaper(imagePath, imageBuffer = null) {
    return await this.route(imagePath, { forceEngine: 'ocrspace', imageBuffer });
  }

  async processAnswerKey(filePath, mimetype = null, fileBuffer = null) {
    return await this.route(filePath, { mimetype, imageBuffer: fileBuffer });
  }
}

module.exports = OCRRouter;