import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDir = path.resolve(__dirname, '../test-files');

if (!fs.existsSync(testDir)) {
  fs.mkdirSync(testDir, { recursive: true });
}

// 1. Valid PNG with transparency (100x100 amber square with transparent background)
const samplePng = fs.readFileSync(path.resolve(__dirname, '../public/icon-192.png'));
fs.writeFileSync(path.join(testDir, 'valid-transparent.png'), samplePng);

// 2. Corrupt 0-byte file
fs.writeFileSync(path.join(testDir, 'empty-corrupt.pdf'), Buffer.alloc(0));

// 3. Spoofed file: named .png but contains plain invalid text
fs.writeFileSync(path.join(testDir, 'spoofed-fake.png'), Buffer.from('This is not a real image file at all!'));

// 4. Valid text-like PDF
const validPdfHeader = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF');
fs.writeFileSync(path.join(testDir, 'valid-minimal.pdf'), validPdfHeader);

console.log('Created test files in test-files/');
