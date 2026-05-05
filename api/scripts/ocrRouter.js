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
   * @param {string} filePath - Path to the file
   * @param {string} mimetype - MIME type if available
   * @returns {string} - 'pdf', 'image', or 'unknown'
   */
  getFileType(filePath, mimetype = null) {
    if (mimetype) {
      if (mimetype === 'application/pdf') return 'pdf';
      if (mimetype.startsWith('image/')) return 'image';
    }

    // Safety check if filePath is a Buffer on Vercel instead of a string
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
   * This is a heuristic - in production, you might use ML classification
   * @param {string|Buffer} filePath - Path to the image file or Buffer
   * @returns {Promise<boolean>} - True if likely handwritten
   */
  static async isLikelyHandwritten(filePath) {
    try {
      // Heuristic: Check image dimensions and quality
      // Handwritten papers are often photos with lower DPI
      const { createCanvas, loadImage } = require('canvas');
      const img = await loadImage(filePath);
      
      // If image is very large (> 3000px), it's likely a scan (printed)
      // If it's moderate size (500-2000px), it's likely a photo (handwritten)
      const maxDimension = Math.max(img.width, img.height);
      
      if (maxDimension > 3000) {
        return false; // Likely scanned/printed
      }
      
      if (maxDimension < 500) {
        return false; // Too small, unclear
      }
      
      // Default to assuming handwritten for student submissions
      return true;
    } catch (error) {
      console.error('Error detecting handwriting:', error);
      return true; // Default to handwritten on error
    }
  }

  /**
   * Routes the OCR request to the appropriate engine
   * @param {string|Buffer} filePath - Path to the file or Buffer
   * @param {object} options - Options for routing
   * @returns {Promise<string>} - Extracted text
   */
  async route(filePath, options = {}) {
    const {
      mimetype = null,
      forceEngine = null, // 'ocrspace' or 'tesseract' to force specific engine
      preprocess = true,
      isHandwritten = null, // Override handwriting detection
      imageBuffer = null // Optional buffer for in-memory processing
    } = options;

    const fileType = this.getFileType(filePath, mimetype);

    console.log(`--- OCR Routing ---`);
    console.log(`File type: ${fileType}`);
    console.log(`Path is Buffer: ${Buffer.isBuffer(filePath)}`);
    console.log(`Image buffer provided: ${!!imageBuffer}`);

    // Force specific engine if requested
    if (forceEngine === 'ocrspace') {
      console.log('Forced engine: OCR.space (handwriting)');
      return await this.processWithOCRSpace(filePath, { preprocess, imageBuffer });
    }

    if (forceEngine === 'tesseract') {
      console.log('Forced engine: Tesseract (printed/PDF)');
      return await this.processWithTesseract(filePath, { preprocess, fileType, imageBuffer });
    }

    // Smart routing based on file type
    if (fileType === 'pdf') {
      console.log('Routing to Tesseract (PDF file)');
      return await this.processWithTesseract(filePath, { preprocess, fileType, imageBuffer });
    }

    if (fileType === 'image') {
      // Determine if handwritten or printed
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

    // Fallback to Tesseract for unknown types
    console.log('Unknown file type, routing to Tesseract (fallback)');
    return await this.processWithTesseract(filePath, { preprocess, fileType, imageBuffer });
  }

  /**
   * Processes image with OCR.space (handwriting engine)
   * @param {string|Buffer} filePath - Path to the image file or Buffer
   * @param {object} options - Processing options
   * @returns {Promise<string>} - Extracted text
   */
  async processWithOCRSpace(filePath, options = {}) {
    const { preprocess = false, imageBuffer = null } = options;

    try {
      console.log('Running OCR.space...');
      
      let text;
      // Safely check if we are dealing with a Vercel memory buffer or a local file path
      if (imageBuffer) {
        text = await this.ocrSpaceService.recognizeHandwritingFromBuffer(imageBuffer);
      } else if (Buffer.isBuffer(filePath)) {
        text = await this.ocrSpaceService.recognizeHandwritingFromBuffer(filePath);
      } else {
        text = await this.ocrSpaceService.recognizeHandwriting(filePath);
      }

      return text;

    } catch (error) {
      console.error('OCR.space processing failed:', error);
      // Fallback to Tesseract if OCR.space fails
      console.log('Falling back to Tesseract...');
      return await this.processWithTesseract(filePath, { preprocess: false, imageBuffer });
    }
  }

  /**
   * Processes file with Tesseract.js (LSTM engine)
   * @param {string|Buffer} filePath - Path to the file or Buffer
   * @param {object} options - Processing options
   * @returns {Promise<string>} - Extracted text
   */
  async processWithTesseract(filePath, options = {}) {
    const { preprocess = true, fileType = 'image', imageBuffer = null } = options;

    try {
      // For PDFs, use pdf-parse first (more reliable for text extraction)
      if (fileType === 'pdf') {
        console.log('Extracting text from PDF using pdf-parse...');
        const { PDFParse } = require('pdf-parse');
        
        // SAFE BUFFER CHECK FOR VERCEL
        let dataBuffer;
        if (imageBuffer) {
          dataBuffer = imageBuffer;
        } else if (Buffer.isBuffer(filePath)) {
          dataBuffer = filePath;
        } else {
          dataBuffer = fs.readFileSync(filePath);
        }

        const parser = new PDFParse({ data: dataBuffer });
        const result = await parser.getText();
        await parser.destroy();

        console.log('--- PDF Text Extracted ---');
        console.log(result.text);
        console.log('-------------------------');

        return result.text || '';
      }

      // For images, use Tesseract with LSTM
      console.log('Processing image with Tesseract.js (LSTM)...');

      let imageSource;
      if (imageBuffer) {
        imageSource = imageBuffer;
      } else if (Buffer.isBuffer(filePath)) {
        imageSource = filePath;
      } else {
        imageSource = filePath;
      }

      // Preprocess image if enabled (Only run if it's a local file path, skip if Vercel Buffer to avoid string errors)
      if (preprocess && !imageBuffer && !Buffer.isBuffer(filePath)) {
        console.log('Preprocessing image for Tesseract...');
        const preprocessedBuffer = await ImagePreprocessor.preprocess(filePath, {
          grayscale: true,
          binarize: true,
          upscale: true,
          scaleFactor: 2,
          threshold: 140
        });

        // Use buffer directly with Tesseract
        imageSource = preprocessedBuffer;
      }

      // Configure Tesseract with LSTM (OEM 1)
      const result = await Tesseract.recognize(imageSource, 'eng', {
        // OEM 1 = LSTM only (best accuracy)
        tessedit_ocr_engine_mode: '1',
        // PSM 6 = Assume a single uniform block of text
        tessedit_pageseg_mode: '6',
        // Enable LSTM
        lstm: true,
      });

      const text = result.data.text || '';

      console.log('--- Tesseract Result ---');
      console.log(text);
      console.log('-----------------------');

      return text;

    } catch (error) {
      console.error('Tesseract processing failed:', error);
      throw error;
    }
  }

  /**
   * Convenience method for student paper OCR (handwritten)
   * @param {string|Buffer} imagePath - Path to student paper image
   * @param {Buffer} imageBuffer - Optional buffer of the image
   * @returns {Promise<string>} - Extracted text
   */
  async processStudentPaper(imagePath, imageBuffer = null) {
    return await this.route(imagePath, {
      forceEngine: 'ocrspace',
      preprocess: true,
      imageBuffer
    });
  }

  /**
   * Convenience method for answer key OCR (PDF/printed)
   * @param {string|Buffer} filePath - Path to answer key file
   * @param {string} mimetype - MIME type
   * @param {Buffer} fileBuffer - Optional buffer of the file
   * @returns {Promise<string>} - Extracted text
   */
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