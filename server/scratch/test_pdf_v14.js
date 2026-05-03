const { PDFParse } = require('pdf-parse');
async function test() {
    try {
        const parser = new PDFParse({});
        console.log('Trying with file:// URL...');
        // We don't even need a real file to see if it accepts the parameter
        await parser.load({ url: 'file:///C:/ScanMine/server/uploads/test.pdf' });
    } catch (e) {
        console.log('Error:', e.message);
    }
}
test();
