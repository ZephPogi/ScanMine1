const Tesseract = require('tesseract.js');
const OCRSpaceService = require('./ocrSpaceService');
const ImagePreprocessor = require('./imagePreprocessor');
const fs = require('fs');
const path = require('path');

/**
 * Smart OCR Router
 * Automatically chooses the appropriate OCR engine based on file type and content
 * - OCR.space (Engine 3) for handwritten student photos
 * - Tesseract.js (LSTM) for PDF answer keys and printed text
 */
class OCRRouter {
  constructor() {
    this.ocrSpaceService = new OCRSpaceService();
  }

  /**
   * Determines the file type
   */
  getFileType(filePath, mimetype = null) {
    if (mimetype) {
      if (mimetype === 'application/pdf') return 'pdf';
      if (mimetype.startsWith('image/')) return 'image';
    }

    if (Buffer.isBuffer(filePath)) {
      return mimetype === 'application/pdf' ? 'pdf' : 'image';
    }

    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.pdf') return 'pdf';
    if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.webp'].includes(ext)) {
      return 'image';
    }

    return 'unknown';
  }

  /**
   * Determines if the content is likely handwritten
   */
  static async isLikelyHandwritten(filePath) {
    try {
      const { createCanvas, loadImage } = require('canvas');
      const img = await loadImage(filePath);
      const maxDimension = Math.max(img.width, img.height);
      
      if (maxDimension > 3000) return false; 
      if (maxDimension < 500) return false; 
      
      return true;
    } catch (error) {
      console.error('Error detecting handwriting:', error);
      return true; 
    }
  }

  /**
   * Routes the OCR request to the appropriate engine
   */
  async route(filePath, options = {}) {
    const {
      mimetype = null,
      forceEngine = null,
      preprocess = true,
      isHandwritten = null,
      imageBuffer = null 
    } = options;

    const fileType = this.getFileType(filePath, mimetype);

    console.log(`--- OCR Routing ---`);
    console.log(`File type: ${fileType}`);
    console.log(`Path is Buffer: ${Buffer.isBuffer(filePath)}`);

    if (forceEngine === 'ocrspace') {
      console.log('Forced engine: OCR.space (handwriting)');
      return await this.processWithOCRSpace(filePath, { preprocess, imageBuffer });
    }

    if (forceEngine === 'tesseract') {
      console.log('Forced engine: Tesseract (printed/PDF)');
      return await this.processWithTesseract(filePath, { preprocess, fileType, imageBuffer });
    }

    if (fileType === 'pdf') {
      console.log('Routing to Tesseract (PDF file)');
      return await this.processWithTesseract(filePath, { preprocess, fileType, imageBuffer });
    }

    if (fileType === 'image') {
      const handwritten = isHandwritten !== null
        ? isHandwritten
        : !imageBuffer && await OCRRouter.isLikelyHandwritten(filePath);

      if (handwritten) {
        console.log('Routing to OCR.space (likely handwritten)');
        return await this.processWithOCRSpace(filePath, { preprocess, imageBuffer });
      } else {
        console.log('Routing to Tesseract (likely printed)');
        return await this.processWithTesseract(filePath, { preprocess, fileType, imageBuffer });
      }
    }

    console.log('Unknown file type, routing to Tesseract (fallback)');
    return await this.processWithTesseract(filePath, { preprocess, fileType, imageBuffer });
  }

  /**
   * Processes image with OCR.space (handwriting engine)
   */
  async processWithOCRSpace(filePath, options = {}) {
    const { preprocess = false, imageBuffer = null } = options;

    try {
      console.log('Running OCR.space...');
      
      let text;
      const source = imageBuffer || filePath;

      if (Buffer.isBuffer(source)) {
        // Safety check: Don't send tiny/corrupted buffers to the API
        if (source.length < 500) {
           throw new Error(`Buffer too small (${source.length} bytes). Image capture likely failed.`);
        }
        text = await this.ocrSpaceService.recognizeHandwritingFromBuffer(source);
      } else {
        text = await this.ocrSpaceService.recognizeHandwriting(source);
      }

      return text;

    } catch (error) {
      console.error('OCR.space processing failed:', error);
      console.log('Falling back to Tesseract...');
      return await this.processWithTesseract(filePath, { preprocess: false, imageBuffer });
    }
  }

  /**
   * Processes file with Tesseract.js using CDN to avoid Vercel WASM errors
   */
  async processWithTesseract(filePath, options = {}) {
    const { preprocess = true, fileType = 'image', imageBuffer = null } = options;

    try {
      if (fileType === 'pdf') {
        console.log('Extracting text from PDF using pdf-parse...');
        const PDF = require('pdf-parse');
        const dataBuffer = imageBuffer || (Buffer.isBuffer(filePath) ? filePath : fs.readFileSync(filePath));
        const result = await PDF(dataBuffer);
        return result.text || '';
      }

      console.log('Processing image with Tesseract.js (CDN/WASM Fix)...');

      let imageSource = imageBuffer || filePath;

      // START OF VERCEL WASM FIX
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
      // END OF FIX

      console.log('--- Tesseract Result ---');
      console.log(text);
      console.log('-----------------------');

      return text || '';

    } catch (error) {
      console.error('Tesseract processing failed:', error);
      throw error;
    }
  }

  async processStudentPaper(imagePath, imageBuffer = null) {
    return await this.route(imagePath, {
      forceEngine: 'ocrspace',
      preprocess: true,
      imageBuffer
    });
  }

  async processAnswerKey(filePath, mimetype = null, fileBuffer = null) {
    return await this.route(filePath, {
      forceEngine: 'tesseract',
      preprocess: true,
      mimetype,
      imageBuffer: fileBuffer
    });
  }
}

module.exports = OCRRouter;