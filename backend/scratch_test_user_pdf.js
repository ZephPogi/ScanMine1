const { PDFParse } = require('pdf-parse');
const fs = require('fs');
const path = require('path');

async function test() {
  try {
    const filePath = path.join(__dirname, '..', 'uploads', 'ee99cb91ad553e2bbdbcd6b163c3bda0');
    console.log('Testing file:', filePath);
    const dataBuffer = fs.readFileSync(filePath);
    const parser = new PDFParse({ data: dataBuffer });
    const result = await parser.getText();
    console.log('Extracted Text Length:', result.text.length);
    console.log('Extracted Text Content:', result.text);
    await parser.destroy();
  } catch (e) {
    console.error('Error:', e);
  }
}
test();
