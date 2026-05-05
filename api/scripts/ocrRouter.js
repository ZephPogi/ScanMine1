const Tesseract = require('tesseract.js');
const OCRSpaceService = require('./ocrSpaceService');
const fs = require('fs');
const path = require('path');
// Fixed Import for Vercel bundling
const pdf = require('pdf-parse/lib/pdf-parse.js'); 

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
        // Explicitly calling the library
        const data = await pdf(dataBuffer);
        
        if (!data.text || data.text.trim().length === 0) {
          return await this.processWithTesseract(dataBuffer);
        }
        return data.text;
      } catch (err) {
        console.error('PDF Parse failed, falling back to Tesseract:', err.message);
        return await this.processWithTesseract(source);
      }
    }

    // Image/Handwriting Logic
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
    const { createWorker } = Tesseract;
    
    // We create the worker with EXPLICIT CDN paths to bypass node_modules
    const worker = await createWorker('eng', 1, {
      workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@v5.0.0/dist/worker.min.js',
      langPath: 'https://tessdata.projectnaptha.com/4.0.0',
      corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@v5.0.0/tesseract-core.wasm.js',
      logger: m => console.log(m.status)
    });

    try {
      const { data: { text } } = await worker.recognize(imageSource);
      await worker.terminate();
      return text;
    } catch (err) {
      if (worker) await worker.terminate();
      console.error('Tesseract failed:', err.message);
      return "OCR_FALLBACK_FAILED";
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