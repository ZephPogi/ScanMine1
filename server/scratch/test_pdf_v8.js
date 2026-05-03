const { PDFParse } = require('pdf-parse');
async function test() {
    try {
        const parser = new PDFParse({});
        const dataBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF');
        console.log('Trying with { url: "dummy.pdf", data: dataBuffer }');
        await parser.load({ url: 'dummy.pdf', data: dataBuffer });
        console.log('Success with { url: "dummy.pdf", data: dataBuffer }');
    } catch (e) {
        console.log('Error:', e.message);
    }
}
test();
