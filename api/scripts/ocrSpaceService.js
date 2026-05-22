/* eslint-disable */
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

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
    if (!this.apiKey) {
      throw new Error('OCR_SPACE_API_KEY not set in environment variables');
    }

    try {
      const formData = new FormData();

      // 1. Detect File Type
      const isPdfBuffer = imageBuffer.length > 4 &&
        imageBuffer[0] === 0x25 &&
        imageBuffer[1] === 0x50;

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

      console.log(`Uploading Binary to OCR.space (Engine: ${engine})...`);

      /*
      const response = await axios.post(this.apiUrl, formData, {
        headers: {
          ...formData.getHeaders() // Necessary for multi-part binary data
        },
        timeout: 45000 // Give Engine 3 more time to "think"
      });

      if (response.data.IsErroredOnProcessing) {
        throw new Error(response.data.ErrorMessage || 'OCR API Error');
      }

      return response.data.ParsedResults?.map(r => r.ParsedText).join('\n') || "";
      */

      // --- NEW HUGGING FACE TROCR MICROSERVICE ---
      const hfFormData = new FormData();
      hfFormData.append('file', imageBuffer, {
        filename: isPdfBuffer ? 'document.pdf' : 'captured_paper.jpg',
        contentType: isPdfBuffer ? 'application/pdf' : 'image/jpeg',
      });

      console.log('Sending to Hugging Face TrOCR Microservice...');
      const hfResponse = await axios.post('https://zephpogi-scanmine-trocr.hf.space/extract-text', hfFormData, {
        headers: {
          ...hfFormData.getHeaders()
        },
        timeout: 60000
      });

      const extractedText = hfResponse.data.text || "";
      console.log("Hugging Face AI Output: \n", extractedText); // <--- PUT IT EXACTLY HERE
      return extractedText;



    } catch (error) {
      // THIS IS THE MAGIC DEBUG LOG
      if (error.response) {
        console.error('API Detailed Error:', JSON.stringify(error.response.data, null, 2));
      } else {
        console.error('API Network Error:', error.message);
      }
      throw new Error("OCR processing failed.");
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
