const { PDFParse } = require('pdf-parse');
const fs = require('fs');
const path = require('path');

async function test() {
    try {
        const filePath = path.join(__dirname, 'uploads', '1777606353993-305883703.pdf');
        console.log('Reading:', filePath);
        const dataBuffer = fs.readFileSync(filePath);
        const parser = new PDFParse({ data: dataBuffer });
        const result = await parser.getText();
        console.log('EXTRACTED TEXT:\n', result.text);
        await parser.destroy();
    } catch (e) {
        console.log('ERROR:', e.message);
    }
}
test();
