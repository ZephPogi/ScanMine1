const { PDFParse } = require('pdf-parse');
try {
    const parser = new PDFParse({});
    console.log('Parser Instance Keys:', Object.keys(parser));
    console.log('Parser Prototype Keys:', Object.keys(Object.getPrototypeOf(parser)));
    
    // Check for common method names
    const commonNames = ['parse', 'load', 'getText', 'extract', 'read'];
    commonNames.forEach(name => {
        if (typeof parser[name] === 'function') console.log(`Found method: ${name}`);
    });
} catch (e) {
    console.log('Failed:', e.message);
}
