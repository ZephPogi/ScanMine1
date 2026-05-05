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
   * @returns {Promise<string>} - Extracted text
   */
  async recognizeHandwritingFromBuffer(imageBuffer) {
    return await this.recognizeHandwritingBufferUpload(imageBuffer);
  }

  async recognizeHandwritingBufferUpload(imageBuffer) {
    if (!this.apiKey) {
      throw new Error('OCR_SPACE_API_KEY not set in environment variables');
    }

    try {
      const formData = new FormData();

      // SMART DETECTION: Check the "magic bytes" of the buffer to see if it's a PDF.
      // All PDF files start with the hex bytes: 25 50 44 46 ('%PDF')
      const isPdfBuffer = imageBuffer.length > 4 && 
                          imageBuffer[0] === 0x25 && 
                          imageBuffer[1] === 0x50 && 
                          imageBuffer[2] === 0x44 && 
                          imageBuffer[3] === 0x46;

      const uploadFilename = isPdfBuffer ? 'document.pdf' : 'image.png';
      const uploadContentType = isPdfBuffer ? 'application/pdf' : 'image/png';

      formData.append('file', imageBuffer, {
        filename: uploadFilename,
        contentType: uploadContentType
      });

      formData.append('apikey', this.apiKey);
      formData.append('language', 'eng');
      formData.append('detectOrientation', 'true');
      formData.append('scale', 'true');
      
      // CRITICAL FIX: Use Engine 2 first. Engine 3 is too slow and causes Vercel timeouts.
      formData.append('OCREngine', '2');
      formData.append('isTable', 'false');

      console.log(`Sending to OCR.space API (File: ${uploadFilename}, Engine: 2)...`);
      console.log(`Buffer size: ${imageBuffer.length} bytes`);

      const response = await axios.post(this.apiUrl, formData, {
        headers: {
          ...formData.getHeaders()
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 40000 // Cut off slightly before Vercel kills it
      });

      if (response.data.IsErroredOnProcessing) {
        console.error('OCR.space Error (Engine 2):', response.data.ErrorMessage);
        return await this.recognizeHandwritingBufferUploadEngine1(imageBuffer, uploadFilename, uploadContentType);
      }

      const parsedResults = response.data.ParsedResults || [];
      let extractedText = '';

      for (const result of parsedResults) {
        extractedText += result.ParsedText || '';
      }

      if (!extractedText.trim()) {
        console.log('Engine 2 returned empty text, trying Engine 1 fallback...');
        return await this.recognizeHandwritingBufferUploadEngine1(imageBuffer, uploadFilename, uploadContentType);
      }

      return extractedText;
    } catch (error) {
      console.error('OCR.space Buffer Upload Error:', error.message);
      throw error;
    }
  }

  // Changed fallback from Engine 2 to Engine 1, since Engine 2 is now our primary
  async recognizeHandwritingBufferUploadEngine1(imageBuffer, filename, contentType) {
    console.log('--- Falling back to OCR Engine 1 ---');
    try {
      const formData = new FormData();

      formData.append('file', imageBuffer, {
        filename: filename,
        contentType: contentType
      });

      formData.append('apikey', this.apiKey);
      formData.append('language', 'eng');
      formData.append('scale', 'true');
      formData.append('OCREngine', '1'); // Engine 1 is the fastest, good for clean text

      const response = await axios.post(this.apiUrl, formData, {
        headers: {
          ...formData.getHeaders()
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 40000
      });

      if (response.data.IsErroredOnProcessing) {
        throw new Error(`OCR.space Error: ${response.data.ErrorMessage || 'Unknown error'}`);
      }

      const parsedResults = response.data.ParsedResults || [];
      let extractedText = '';

      for (const result of parsedResults) {
        extractedText += result.ParsedText || '';
      }

      return extractedText;
    } catch (error) {
      throw new Error(`OCR.space Error: ${error.message}`);
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
