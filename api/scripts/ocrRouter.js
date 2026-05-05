const Tesseract = require('tesseract.js');
const OCRSpaceService = require('./ocrSpaceService');
const fs = require('fs');

// VERCEL FIX: Standard require so Vercel bundles it properly. No try/catch.
const pdf = require('pdf-parse');

class OCRRouter {
  constructor() {
    this.ocrSpaceService = new OCRSpaceService();
  }

  async route(filePath, options = {}) {
    const { mimetype = null, forceEngine = null, imageBuffer = null } = options;
    const source = imageBuffer || filePath;
    const isPDF = mimetype === 'application/pdf' || 
                 (typeof filePath === 'string' && filePath.toLowerCase().endsWith('.pdf'));

    // --- 1. DIGITAL PDF PATH (Professors) ---
    if (isPDF) {
      try {
        console.log('--- Attempting digital PDF Parse ---');
        const dataBuffer = Buffer.isBuffer(source) ? source : fs.readFileSync(source);
        const data = await pdf(dataBuffer);
        
        if (data.text && data.text.trim().length > 0) {
          return data.text; // Success! Digital text extracted.
        }
        
        // --- 2. SCANNED PDF FALLBACK (Professors) ---
        // If it's a scanned PDF (no text layer), send to OCR.space. 
        // NEVER send PDFs to Tesseract.
        console.log('PDF has no text layer. Routing to OCR.space...');
        return await this.ocrSpaceService.recognizeHandwritingFromBuffer(source);
        
      } catch (err) {
        console.error('PDF Parse failed:', err.message);
        return await this.ocrSpaceService.recognizeHandwritingFromBuffer(source);
      }
    }

    // --- 3. IMAGE PATH (Students Hand-written Answers) ---
    if (forceEngine === 'ocrspace' || !isPDF) {
      console.log('--- Image Detected: Sending to OCR.space ---');
      try {
        return await this.ocrSpaceService.recognizeHandwritingFromBuffer(source);
      } catch (err) {
        // --- 4. ULTIMATE IMAGE FALLBACK ---
        console.log('OCR.space failed, using local Tesseract fallback...');
        return await this.processWithTesseract(source);
      }
    }
  }

  async processWithTesseract(imageSource) {
    console.log('--- Running Local Vercel Tesseract ---');
    try {
      // Tesseract will only ever receive Images now, never PDFs.
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