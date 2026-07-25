const { PDFParse } = require('pdf-parse');
const fs = require('fs');

async function test() {
    try {
        const parser = new PDFParse({});
        const dataBuffer = Buffer.from('%PDF-1.4 dummy data'); 
        console.log('Testing parser.getText(dataBuffer)...');
        // Check if getText is the entry point
        const text = await parser.getText(dataBuffer);
        console.log('Success!');
    } catch (e) {
        console.log('Error:', e.message);
    }
}
test();
