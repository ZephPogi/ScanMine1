try {
    const pdf = require('pdf-parse/node');
    console.log('Type of require("pdf-parse/node"):', typeof pdf);
} catch (e) {
    console.log('Error requiring pdf-parse/node:', e.message);
}
