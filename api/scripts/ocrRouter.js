const Tesseract = require('tesseract.js');
const OCRSpaceService = require('./ocrSpaceService');
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse'); // Change: standard import for pdf-parse

class OCRRouter {
  constructor() {
    this.ocrSpaceService = new OCRSpaceService();
  }

  getFileType(filePath, mimetype = null) {
    if (mimetype === 'application/pdf') return 'pdf';
    if (mimetype?.startsWith('image/')) return 'image';
    if (Buffer.isBuffer(filePath)) return mimetype === 'application/pdf' ? 'pdf' : 'image';
    const ext = path.extname(filePath || '').toLowerCase();
    return ext === '.pdf' ? 'pdf' : 'image';
  }

  async route(filePath, options = {}) {
    const { mimetype = null, forceEngine = null, imageBuffer = null } = options;
    const fileType = this.getFileType(filePath, mimetype);
    const source = imageBuffer || filePath;

    // 1. FIXED PDF LOGIC
    if (fileType === 'pdf') {
      try {
        console.log('Extracting Answer Key from PDF...');
        const dataBuffer = Buffer.isBuffer(source) ? source : fs.readFileSync(source);
        
        // Change: Call the imported 'pdf' function directly
        const data = await pdf(dataBuffer);
        
        console.log('--- PDF Text Extracted ---');
        return data.text;
      } catch (err) {
        console.error('PDF Extraction failed:', err.message);
        throw new Error('Could not parse PDF file.');
      }
    }

    // 2. HANDWRITING LOGIC
    if (forceEngine === 'ocrspace' || fileType === 'image') {
      try {
        console.log('Running OCR.space for handwriting...');
        if (Buffer.isBuffer(source) && source.length < 500) {
           throw new Error("Captured image is too small/empty.");
        }
        return await this.ocrSpaceService.recognizeHandwritingFromBuffer(source);
      } catch (err) {
        console.log('OCR.space failed, falling back to Tesseract...');
        return await this.processWithTesseract(source);
      }
    }
  }

  async processWithTesseract(imageSource) {
    const { createWorker } = require('tesseract.js');
    const worker = await createWorker('eng', 1, {
      workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@v5.0.0/dist/worker.min.js',
      langPath: 'https://tessdata.projectnaptha.com/4.0.0',
      corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@v5.0.0/tesseract-core.wasm.js',
    });
    
    await worker.setParameters({
      tessedit_ocr_engine_mode: '1',
      tessedit_pageseg_mode: '6',
    });

    const { data: { text } } = await worker.recognize(imageSource);
    await worker.terminate();
    return text;
  }

  async processStudentPaper(imagePath, imageBuffer = null) {
    return await this.route(imagePath, { forceEngine: 'ocrspace', imageBuffer });
  }

  async processAnswerKey(filePath, mimetype = null, fileBuffer = null) {
    return await this.route(filePath, { mimetype, imageBuffer: fileBuffer });
  }
}

module.exports = OCRRouter;