const { PDFParse } = require('pdf-parse');
const fs = require('fs');
const path = require('path');

async function test() {
    try {
        const parser = new PDFParse({});
        // Try to find a PDF to test with
        const pdfPath = 'C:\\ScanMine\\server\\uploads\\test.pdf'; // If it exists
        // Just use a dummy buffer if needed, but load might fail on invalid PDF
        console.log('Testing parser.load and parser.getText existence...');
        console.log('load:', typeof parser.load);
        console.log('getText:', typeof parser.getText);
    } catch (e) {
        console.log('Error:', e.message);
    }
}
test();
