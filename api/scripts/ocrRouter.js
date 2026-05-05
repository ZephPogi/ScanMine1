const Tesseract = require('tesseract.js');
const OCRSpaceService = require('./ocrSpaceService');
const fs = require('fs');
const path = require('path');

// SAFE-REQUIRE BLOCK: Prevents the "pdf is not a function" and "Exports" errors
// that are currently breaking your login.
let pdf;
try {
  pdf = require('pdf-parse');
} catch (e) {
  console.error("PDF library load error, attempting fallback...");
  pdf = null;
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
        
        // Use the resolved function or its default export
        const parseFunc = typeof pdf === 'function' ? pdf : (pdf?.default || null);
        
        if (!parseFunc) throw new Error('PDF_LIB_MISSING');

        const data = await parseFunc(dataBuffer);
        
        if (!data.text || data.text.trim().length === 0) {
          return await this.processWithTesseract(dataBuffer);
        }
        return data.text;
      } catch (err) {
        console.error('PDF Parse failed, falling back to Tesseract:', err.message);
        return await this.processWithTesseract(source);
      }
    }

    // Default handwriting logic for ScanMine
    if (forceEngine === 'ocrspace' || !isPDF) {
      try {
        return await this.ocrSpaceService.recognizeHandwritingFromBuffer(source);
      } catch (err) {
        return await this.processWithTesseract(source);
      }
    }
  }

  async processWithTesseract(imageSource) {
    console.log('--- Running Vercel-Stable Tesseract ---');
    try {
      // Direct recognize call is the most stable for Serverless environments
      const { data: { text } } = await Tesseract.recognize(
        imageSource,
        'eng',
        { logger: m => console.log(m.status) }
      );
      return text || "";
    } catch (err) {
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