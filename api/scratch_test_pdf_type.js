const pdf = require('pdf-parse');
console.log('PDF type:', typeof pdf);
console.log('PDF keys:', Object.keys(pdf));
if (typeof pdf === 'function') {
    console.log('It is a function');
} else {
    console.log('It is NOT a function');
}
