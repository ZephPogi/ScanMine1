const { PDFParse } = require('pdf-parse');
const fs = require('fs');

async function test() {
    try {
        console.log('PDFParse type:', typeof PDFParse);
        // Let's see if we can find a PDF file in uploads
        const files = fs.readdirSync('server/uploads');
        const pdfFile = files.find(f => f.endsWith('.pdf'));
        if (!pdfFile) {
            console.log('No PDF file found in server/uploads');
            return;
        }
        const dataBuffer = fs.readFileSync('server/uploads/' + pdfFile);
        const parser = new PDFParse({ data: dataBuffer });
        const result = await parser.getText();
        console.log('EXTRACTED TEXT:', result.text.substring(0, 100));
        await parser.destroy();
    } catch (e) {
        console.log('ERROR:', e.message);
    }
}
test();
