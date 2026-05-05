const Tesseract = require('tesseract.js');
const OCRSpaceService = require('./ocrSpaceService');
const fs = require('fs');
const path = require('path');

// THE VERCEL FIX: Use a more direct require that avoids the "exports" error
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
        // Convert source to Buffer if it isn't one already
        const dataBuffer = Buffer.isBuffer(source) ? source : fs.readFileSync(source);
        
        // Call the PDF library directly
        const data = await pdf(dataBuffer);
        
        if (!data.text || data.text.trim().length === 0) {
          console.log('PDF is likely a scan, using Tesseract fallback...');
          return await this.processWithTesseract(dataBuffer);
        }
        return data.text;
      } catch (err) {
        console.error('PDF Parse failed, falling back to Tesseract:', err.message);
        return await this.processWithTesseract(source);
      }
    }

    // Default to Handwriting/OCR Space for images[cite: 2]
    if (forceEngine === 'ocrspace' || !isPDF) {
      try {
        return await this.ocrSpaceService.recognizeHandwritingFromBuffer(source);
      } catch (err) {
        console.log('OCR.space failed, using Tesseract fallback...');
        return await this.processWithTesseract(source);
      }
    }
  }

  async processWithTesseract(imageSource) {
    console.log('--- Running Standard Tesseract recognize ---');
    try {
      // For Vercel, the simplest call is often the most stable
      // We pass the Buffer directly here.
      const { data: { text } } = await Tesseract.recognize(
        imageSource,
        'eng',
        { logger: m => console.log(m.status) }
      );
      return text;
    } catch (err) {
      console.error('Tesseract recognize failed:', err.message);
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