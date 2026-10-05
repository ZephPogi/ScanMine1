/* eslint-disable */
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const { createCanvas } = require('@napi-rs/canvas');

function getPdfParse() {
  try {
    const importedPdf = require('pdf-parse');
    if (typeof importedPdf === 'function') return importedPdf;
    if (importedPdf && typeof importedPdf.default === 'function') return importedPdf.default;
    if (importedPdf && typeof importedPdf.pdfParse === 'function') return importedPdf.pdfParse;
    return null;
  } catch (error) {
    return null;
  }
}

async function extractDigitalPdfText(pdfBuffer) {
  const pdfParse = getPdfParse();
  if (!pdfParse || !Buffer.isBuffer(pdfBuffer)) return '';

  try {
    const data = await pdfParse(pdfBuffer);
    const text = (data && typeof data.text === 'string' ? data.text : '').trim();
    return text;
  } catch (error) {
    console.warn('[HF Service] PDF digital text parse failed:', error.message);
    return '';
  }
}

async function convertPdfToImageBuffers(pdfBuffer) {
  try {
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await pdfjsLib.getDocument({ data: pdfBuffer }).promise;
    const pageBuffers = [];

    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 10); pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      pageBuffers.push(canvas.toBuffer('image/png'));
    }

    return pageBuffers;
  } catch (error) {
    console.warn('[HF Service] PDF page rendering failed:', error.message);
    return [];
  }
}

/**
 * OCR.space Service for Handwritten Detection
 * Uses Engine 3 (handwriting engine) with JSON overlay output
 */
class OCRSpaceService {
  constructor() {
    this.apiKey = process.env.OCR_SPACE_API_KEY || '';
    this.apiUrl = 'https://api.ocr.space/parse/image';
  }

  /**
   * Sends image to OCR.space API for handwritten text recognition
   * @param {string} imagePath - Path to the image file
   * @returns {Promise<string>} - Extracted text
   */
  async recognizeHandwriting(imagePath) {
    // Try file upload method first (often more reliable)
    return await this.recognizeHandwritingFileUpload(imagePath);
  }

  /**
   * Sends image buffer to OCR.space API for handwritten text recognition
   * @param {Buffer} imageBuffer - Buffer of the image file
   * @param {string} engine - OCR engine to use ('2' for fast digital text, '3' for handwriting)
   * @returns {Promise<string>} - Extracted text
   */
  async recognizeHandwritingFromBuffer(imageBuffer, engine = '2') {
    return await this.recognizeHandwritingBufferUpload(imageBuffer, engine);
  }

  async recognizeHandwritingBufferUpload(imageBuffer, engine = '2') {
    const isPdfBuffer = Buffer.isBuffer(imageBuffer) && imageBuffer.length > 4 &&
      imageBuffer[0] === 0x25 &&
      imageBuffer[1] === 0x50;
    const hasHfConfig = !!(process.env.HF_SPACE_URL && process.env.HF_SPACE_URL.startsWith('http'));

    if (isPdfBuffer && hasHfConfig) {
      const digitalText = await extractDigitalPdfText(imageBuffer);
      if (digitalText && digitalText.trim()) {
        return digitalText.trim();
      }

      const pageImages = await convertPdfToImageBuffers(imageBuffer);
      if (pageImages.length > 0) {
        let combinedText = '';
        for (let i = 0; i < pageImages.length; i++) {
          const pageText = await this.sendImageToHuggingFace(pageImages[i], `page-${i + 1}.png`, 'image/png');
          if (pageText && pageText.trim()) {
            combinedText += (combinedText ? '\n' : '') + pageText.trim();
          }
        }
        if (combinedText.trim()) return combinedText.trim();
      }
    }

    if (!this.apiKey) {
      throw new Error('OCR_SPACE_API_KEY not set in environment variables');
    }

    try {
      const formData = new FormData();

      // 2. THE CRITICAL CHANGE: Use 'file' instead of 'base64Image'
      // This sends raw bytes, which Engine 3 handles much more reliably
      formData.append('file', imageBuffer, {
        filename: isPdfBuffer ? 'document.pdf' : 'captured_paper.jpg',
        contentType: isPdfBuffer ? 'application/pdf' : 'image/jpeg',
      });

      formData.append('apikey', this.apiKey);
      formData.append('language', 'eng');
      formData.append('detectOrientation', 'true');
      formData.append('scale', 'true');
      formData.append('OCREngine', engine); // This will be '3' for student papers
      formData.append('isTable', 'false');

      console.log('Sending image to Hugging Face YOLOv8+TrOCR Hybrid Service...');

      const hfFormData = new FormData();
      hfFormData.append('file', imageBuffer, {
        filename: isPdfBuffer ? 'document.pdf' : 'captured_paper.jpg',
        contentType: isPdfBuffer ? 'application/pdf' : 'image/jpeg',
      });

      return await this.sendImageToHuggingFace(imageBuffer, isPdfBuffer ? 'document.pdf' : 'captured_paper.jpg', isPdfBuffer ? 'application/pdf' : 'image/jpeg');



    } catch (error) {
      // Distinguish timeout/network issues from actual API errors so callers
      // can surface a meaningful message instead of crashing the server.
      if (error.code === 'HF_TIMEOUT' || error.code === 'ECONNABORTED' || (error.message && error.message.includes('timeout'))) {
        console.warn(
          '[HF Service] Propagating timeout to caller — OCR router will use Tesseract fallback.'
        );
        throw error;
      }

      if (error.response) {
        console.error('[HF Service] API error response:', JSON.stringify(error.response.data, null, 2));
      } else {
        console.error('[HF Service] Network error:', error.message);
      }

      throw new Error('OCR processing failed: ' + error.message);
    }

  }


  async sendImageToHuggingFace(imageBuffer, filename, contentType) {
    let targetUrl = (process.env.HF_SPACE_URL || '')
      .replace(/^HF_SPACE_URL=/, '')
      .replace(/^['"]|['"]$/g, '')
      .trim();

    if (targetUrl && !targetUrl.endsWith('/extract-text')) {
      targetUrl = `${targetUrl.replace(/\/+$/, '')}/extract-text`;
    }

    if (!targetUrl || !targetUrl.startsWith('http')) {
      console.error(
        '[HF Service] HF_SPACE_URL is not configured or is invalid. ' +
        'Set a valid URL in your .env to enable the Hugging Face OCR service.'
      );
      throw new Error(
        'HF_SPACE_URL is not configured. Please set a valid Hugging Face Space URL in your environment variables.'
      );
    }

    const hfFormData = new FormData();
    hfFormData.append('file', imageBuffer, {
      filename,
      contentType,
    });

    console.log('[HF Service] Target URL:', targetUrl);

    try {
      const hfResponse = await axios.post(targetUrl, hfFormData, {
        headers: { ...hfFormData.getHeaders() },
        timeout: 15000,
      });

      const extractedText = hfResponse.data.text || '';
      console.log('Hugging Face AI Output:\n', extractedText);
      return extractedText;
    } catch (hfErr) {
      const isTimeout = hfErr.code === 'ECONNABORTED' ||
        (hfErr.message && hfErr.message.toLowerCase().includes('timeout'));

      if (isTimeout) {
        console.warn('[HF Service] Request timed out after 15 s — the Space may be cold-starting. Falling through to local OCR fallback.');
        const timeoutErr = new Error('Hugging Face OCR service timed out (15 s). Falling back to local OCR.');
        timeoutErr.code = 'HF_TIMEOUT';
        throw timeoutErr;
      }

      if (hfErr.response) {
        console.error('[HF Service] API error response:', JSON.stringify(hfErr.response.data, null, 2));
      } else {
        console.error('[HF Service] Network error:', hfErr.message);
      }
      throw new Error('HF OCR processing failed: ' + hfErr.message);
    }
  }

  async recognizeHandwritingFileUpload(imagePath) {
    if (!this.apiKey) {
      throw new Error('OCR_SPACE_API_KEY not set in environment variables');
    }

    try {
      const imageBuffer = fs.readFileSync(imagePath);
      const formData = new FormData();

      formData.append('file', imageBuffer, {
        filename: path.basename(imagePath),
        contentType: 'image/png'
      });

      // Use OCREngine=3 (handwriting engine) - NOTE: 'engine' parameter is invalid, only 'OCREngine'
      formData.append('apikey', this.apiKey);
      formData.append('language', 'eng');
      formData.append('detectOrientation', 'true');
      formData.append('scale', 'true');
      formData.append('OCREngine', '3'); // Engine 3 for handwriting
      formData.append('isTable', 'false');

      console.log('Sending to OCR.space API (File Upload with OCREngine=3)...');
      console.log(`Image path: ${imagePath}`);
      console.log(`Buffer size: ${imageBuffer.length} bytes`);
      console.log(`API Key: ${this.apiKey.substring(0, 10)}...`);

      const response = await axios.post(this.apiUrl, formData, {
        headers: {
          ...formData.getHeaders()
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 45000 // 45 seconds to stay within Vercel's 60s limit
      });

      console.log('OCR.space API response status:', response.status);
      console.log('OCR.space response data:', JSON.stringify(response.data, null, 2));

      if (response.data.IsErroredOnProcessing) {
        console.error('OCR.space Error:', response.data.ErrorMessage);
        // Try Engine 2
        return await this.recognizeHandwritingFileUploadEngine2(imagePath);
      }

      const parsedResults = response.data.ParsedResults || [];
      let extractedText = '';

      for (const result of parsedResults) {
        extractedText += result.ParsedText || '';
      }

      // If Engine 3 returns empty, try Engine 2
      if (!extractedText.trim()) {
        console.log('Engine 3 returned empty text, trying Engine 2...');
        return await this.recognizeHandwritingFileUploadEngine2(imagePath);
      }

      console.log('--- OCR.space Result (File Upload OCREngine=3) ---');
      console.log(extractedText);
      console.log('-----------------------------------------------');

      return extractedText;

    } catch (error) {
      console.error('OCR.space File Upload Error:', error.message);
      if (error.response) {
        console.error('OCR.space response data:', error.response.data);
      }
      // Try Engine 2
      return await this.recognizeHandwritingFileUploadEngine2(imagePath);
    }
  }

  async recognizeHandwritingFileUploadEngine2(imagePath) {
    if (!this.apiKey) {
      throw new Error('OCR_SPACE_API_KEY not set in environment variables');
    }

    try {
      const imageBuffer = fs.readFileSync(imagePath);
      const formData = new FormData();

      formData.append('file', imageBuffer, {
        filename: path.basename(imagePath),
        contentType: 'image/png'
      });

      // Try Engine 2 (mixed content)
      formData.append('apikey', this.apiKey);
      formData.append('language', 'eng');
      formData.append('detectOrientation', 'true');
      formData.append('scale', 'true');
      formData.append('OCREngine', '2');
      formData.append('isTable', 'false');

      console.log('Trying OCR.space OCREngine=2...');

      const response = await axios.post(this.apiUrl, formData, {
        headers: {
          ...formData.getHeaders()
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 45000 // 45 seconds to stay within Vercel's 60s limit
      });

      console.log('OCR.space OCREngine=2 response:', JSON.stringify(response.data, null, 2));

      if (response.data.IsErroredOnProcessing) {
        throw new Error(`OCR.space Error: ${response.data.ErrorMessage || 'Unknown error'}`);
      }

      const parsedResults = response.data.ParsedResults || [];
      let extractedText = '';

      for (const result of parsedResults) {
        extractedText += result.ParsedText || '';
      }

      console.log('--- OCR.space Result (OCREngine=2) ---');
      console.log(extractedText);
      console.log('--------------------------------------');

      return extractedText;

    } catch (error) {
      console.error('OCR.space OCREngine=2 Error:', error.message);
      throw error;
    }
  }

  /**
   * Alternative method using base64 encoding
   * @param {string} imagePath - Path to the image file
   * @returns {Promise<string>} - Extracted text
   */
  async recognizeHandwritingBase64(imagePath) {
    if (!this.apiKey) {
      throw new Error('OCR_SPACE_API_KEY not set in environment variables');
    }

    try {
      const imageBuffer = fs.readFileSync(imagePath);
      const base64Image = imageBuffer.toString('base64');

      console.log('Sending to OCR.space API (Base64)...');
      console.log(`Image path: ${imagePath}`);
      console.log(`Buffer size: ${imageBuffer.length} bytes`);

      // Try with minimal parameters first - let OCR.space auto-detect
      const response = await axios.post(this.apiUrl, null, {
        params: {
          base64Image: `data:image/png;base64,${base64Image}`,
          apikey: this.apiKey,
          isTable: 'false',
          OCREngine: '2',
          language: 'eng',
          scale: 'true',
          detectOrientation: 'true'
        }
      });

      console.log('OCR.space API response status:', response.status);
      console.log('OCR.space response data:', JSON.stringify(response.data, null, 2));

      if (response.data.IsErroredOnProcessing) {
        console.error('OCR.space Error:', response.data.ErrorMessage);
        // Try with different parameters if first attempt fails
        console.log('Retrying with different parameters...');
        return await this.recognizeHandwritingBase64Alt(imagePath);
      }

      const parsedResults = response.data.ParsedResults || [];
      let extractedText = '';

      for (const result of parsedResults) {
        extractedText += result.ParsedText || '';
      }

      console.log('--- OCR.space Result (Base64) ---');
      console.log(extractedText);
      console.log('----------------------------------');

      return extractedText;

    } catch (error) {
      console.error('OCR.space API Error (Base64):', error.message);
      if (error.response) {
        console.error('OCR.space response data:', error.response.data);
      }
      // Try alternative method
      return await this.recognizeHandwritingBase64Alt(imagePath);
    }
  }

  async recognizeHandwritingBase64Alt(imagePath) {
    if (!this.apiKey) {
      throw new Error('OCR_SPACE_API_KEY not set in environment variables');
    }

    try {
      const imageBuffer = fs.readFileSync(imagePath);
      const base64Image = imageBuffer.toString('base64');

      console.log('Trying alternative OCR.space configuration...');

      const response = await axios.post(this.apiUrl, null, {
        params: {
          base64Image: `data:image/png;base64,${base64Image}`,
          apikey: this.apiKey,
          language: 'eng',
          isOverlayRequired: 'false',
          detectOrientation: 'true',
          scale: 'true',
          pageSegMode: '3',
          OCREngine: '1'
        }
      });

      console.log('OCR.space Alt response status:', response.status);
      console.log('OCR.space Alt response data:', JSON.stringify(response.data, null, 2));

      if (response.data.IsErroredOnProcessing) {
        throw new Error(`OCR.space Error: ${response.data.ErrorMessage || 'Unknown error'}`);
      }

      const parsedResults = response.data.ParsedResults || [];
      let extractedText = '';

      for (const result of parsedResults) {
        extractedText += result.ParsedText || '';
      }

      console.log('--- OCR.space Alt Result ---');
      console.log(extractedText);
      console.log('---------------------------');

      return extractedText;

    } catch (error) {
      console.error('OCR.space Alt Error:', error.message);
      throw new Error(`Failed to process image with OCR.space: ${error.message}`);
    }
  }
}

module.exports = OCRSpaceService;
