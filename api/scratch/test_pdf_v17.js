const { PDFParse } = require('pdf-parse');
async function test() {
    try {
        const parser = new PDFParse({});
        const filePath = 'C:\\ScanMine\\server\\uploads\\test.pdf'; 
        console.log('Trying with raw filePath...');
        await parser.load({ url: filePath });
    } catch (e) {
        console.log('Error:', e.message);
    }
}
test();
