try {
    const pdfParse = require('pdf-parse/lib/pdf-parse');
    console.log('Type of require("pdf-parse/lib/pdf-parse"):', typeof pdfParse);
} catch (e) {
    console.log('Error:', e.message);
}
