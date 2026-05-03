const pdf = require('pdf-parse');
console.log('pdf.default type:', typeof pdf.default);
if (typeof pdf.default === 'function') {
    console.log('Default is a function!');
}
