const Tesseract = require('tesseract.js');
const OCRSpaceService = require('./ocrSpaceService');
const fs = require('fs');
const path = require('path');

// THE VERCEL FIX: Some environments require accessing the function via .default or a specific require path
let pdf;
try {
  pdf = require('pdf-parse/lib/pdf-parse.js'); 
} catch (e) {
  pdf = require('pdf-parse');
}

class OCRRouter {
  constructor() {
    this.ocrSpaceService = new OCRSpaceService();
  }

  getFileType(filePath, mimetype = null) {
    if (mimetype === 'application/pdf') return 'pdf';
    if (mimetype?.startsWith('image/')) return 'image';
    const ext = path.extname(filePath || '').toLowerCase();
    return ext === '.pdf' ? 'pdf' : 'image';
  }

  async route(filePath, options = {}) {
    const { mimetype = null, forceEngine = null, imageBuffer = null } = options;
    const fileType = this.getFileType(filePath, mimetype);
    const source = imageBuffer || filePath;

    if (fileType === 'pdf') {
      try {
        console.log('--- Attempting PDF Parse ---');
        const dataBuffer = Buffer.isBuffer(source) ? source : fs.readFileSync(source);
        
        // Use the library with explicit error catching
        const data = await pdf(dataBuffer).catch(err => {
            console.error('pdf-parse internal error:', err);
            return { text: "INTERNAL_PARSE_ERROR" };
        });

        if (data.text === "INTERNAL_PARSE_ERROR" || !data.text) {
            console.log('Falling back to Tesseract for PDF image...');
            return await this.processWithTesseract(dataBuffer);
        }

        return data.text;
      } catch (err) {
        console.error('PDF Extraction Route failed:', err.message);
        return await this.processWithTesseract(source);
      }
    }

    if (forceEngine === 'ocrspace' || fileType === 'image') {
      try {
        if (Buffer.isBuffer(source) && source.length < 500) {
           throw new Error("Empty buffer.");
        }
        return await this.ocrSpaceService.recognizeHandwritingFromBuffer(source);
      } catch (err) {
        return await this.processWithTesseract(source);
      }
    }
  }

  async processWithTesseract(imageSource) {
    // Basic call - most stable for Vercel without custom workers
    const { data: { text } } = await Tesseract.recognize(imageSource, 'eng');
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