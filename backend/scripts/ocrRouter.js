/* eslint-disable */
const Tesseract = require('tesseract.js');
const OCRSpaceService = require('./ocrSpaceService');
const fs = require('fs');
const path = require('path');

// VERCEL FIX: Use a robust pdf-parse import that supports ESM/CJS default exports.
let pdfParse;
try {
  const importedPdf = require('pdf-parse');
  pdfParse = typeof importedPdf === 'function'
    ? importedPdf
    : (importedPdf && typeof importedPdf.default === 'function'
      ? importedPdf.default
      : (importedPdf && typeof importedPdf.pdfParse === 'function' ? importedPdf.pdfParse : null));
} catch (e) {
  console.error('Critical: pdf-parse could not be loaded', e.message);
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
        const parseFunc = pdfParse;

        if (parseFunc) {
          const data = await parseFunc(dataBuffer);
          if (data && data.text && data.text.trim().length > 0) return data.text;
        }

        console.log('Digital parse empty or failed. Trying OCR.space...');
        return await this.ocrSpaceService.recognizeHandwritingFromBuffer(dataBuffer, engine);
      } catch (err) {
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
      console.log('OCR.space failed, using local Tesseract fallback...');
      return await this.processWithTesseract(source);
    }
  }

  async processWithTesseract(imageSource) {
    try {
      const { data: { text } } = await Tesseract.recognize(imageSource, 'eng');
      return text || "";
    } catch (err) {
      return "";
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