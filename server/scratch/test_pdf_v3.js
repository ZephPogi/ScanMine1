const { PDFParse } = require('pdf-parse');
try {
    console.log('Instantiating with empty object...');
    const parser = new PDFParse({});
    console.log('Success!');
} catch (e) {
    console.log('Failed:', e.message);
}
