const pdf = require('pdf-parse');
console.log('Type of require("pdf-parse"):', typeof pdf);
if (typeof pdf === 'function') {
    console.log('It is a function!');
} else {
    console.log('Keys:', Object.keys(pdf));
}
