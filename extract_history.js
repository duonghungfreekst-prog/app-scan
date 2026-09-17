const fs = require('fs');
const readline = require('readline');

async function extract() {
    const fileStream = fs.createReadStream('C:\\Users\\Administrator\\.gemini\\antigravity-ide\\brain\\b0e36dc0-9528-4767-b023-09a08601eeac\\.system_generated\\logs\\transcript.jsonl');
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    const outStream = fs.createWriteStream('E:\\lưu sql\\app scam\\camscanner-expo\\extracted.jsonl');
    
    for await (const line of rl) {
        if (line.includes('ScannerScreen.tsx')) {
            outStream.write(line + '\n');
        }
    }
    console.log('Finished writing extracted.jsonl');
}
extract();
