const { PDFParse } = require('pdf-parse');
console.log('Type of PDFParse:', typeof PDFParse);
if (typeof PDFParse === 'function') {
    try {
        console.log('Attempting static parse...');
        console.log('PDFParse.parse:', typeof PDFParse.parse);
    } catch (e) {
        console.log('Error:', e.message);
    }
}
