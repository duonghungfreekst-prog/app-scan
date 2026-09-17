const fs = require('fs');

const lines = fs.readFileSync('E:\\lưu sql\\app scam\\camscanner-expo\\extracted.jsonl', 'utf8').split('\n');
for (const line of lines) {
    if (!line) continue;
    const data = JSON.parse(line);
    if (data.type === 'USER_INPUT' && data.content && data.content.includes('ScannerScreen.tsx') && data.content.includes('Active Document:')) {
        const content = data.content;
        const startIndex = content.indexOf('Active Document: e:\\lưu sql\\app scam\\camscanner-expo\\src\\screens\\ScannerScreen.tsx (LANGUAGE_TSX)');
        if (startIndex !== -1) {
            // Find the start of the file content (which usually follows immediately or after a newline)
            const fileContentStart = content.indexOf('import', startIndex);
            if (fileContentStart !== -1) {
                const endIndex = content.indexOf('</ADDITIONAL_METADATA>', fileContentStart);
                if (endIndex !== -1) {
                    let code = content.substring(fileContentStart, endIndex).trim();
                    // Sometimes there are other open documents listed at the end
                    const otherDocsIndex = code.indexOf('Cursor is on line');
                    if (otherDocsIndex !== -1) {
                        code = code.substring(0, otherDocsIndex).trim();
                    }
                    fs.writeFileSync('E:\\lưu sql\\app scam\\camscanner-expo\\src\\screens\\ScannerScreen_old.tsx', code);
                    console.log('Extracted from USER_INPUT!');
                    return;
                }
            }
        }
    }
}
console.log('Not found in USER_INPUT metadata.');
