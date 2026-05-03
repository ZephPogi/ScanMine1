const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const fs = require('fs');
const OCRSpaceService = require('./scripts/ocrSpaceService');

async function testOCR() {
  try {
    // Use one of the uploaded images
    const testImagePath = path.join(__dirname, '..', 'uploads', '1777603143826-994306566.jpg');
    
    console.log('Testing OCR.space with image:', testImagePath);
    console.log('File exists:', fs.existsSync(testImagePath));
    console.log('API Key loaded:', process.env.OCR_SPACE_API_KEY ? 'YES' : 'NO');
    
    const ocrService = new OCRSpaceService();
    const text = await ocrService.recognizeHandwriting(testImagePath);
    
    console.log('\n=== FINAL RESULT ===');
    console.log('Extracted text:', text);
    console.log('==================\n');
    
  } catch (error) {
    console.error('Test failed:', error.message);
    console.error('Full error:', error);
  }
}

testOCR();
