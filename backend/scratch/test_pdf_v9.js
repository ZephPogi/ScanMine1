const { PDFParse } = require('pdf-parse');
async function test() {
    try {
        const parser = new PDFParse({});
        console.log('Trying with string URL...');
        await parser.load('any_string_here.pdf');
    } catch (e) {
        console.log('Error:', e.message);
    }
}
test();
