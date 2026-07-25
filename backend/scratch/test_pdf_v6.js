const { PDFParse } = require('pdf-parse');
const fs = require('fs');

async function test() {
    try {
        const parser = new PDFParse({});
        const dataBuffer = Buffer.from('%PDF-1.4 dummy data'); // Minimal PDF-like buffer
        console.log('Testing parser.load with data object...');
        // Newer versions of pdf.js often expect { data: buffer }
        await parser.load({ data: dataBuffer });
        console.log('Success with { data: buffer }');
    } catch (e) {
        console.log('Failed with { data: buffer }:', e.message);
        try {
            console.log('Testing parser.load with direct buffer...');
            await parser.load(dataBuffer);
            console.log('Success with direct buffer');
        } catch (e2) {
             console.log('Failed with direct buffer:', e2.message);
        }
    }
}
test();
