import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const installerOutputDir = path.join(rootDir, 'installer-output');
const websiteDownloads = path.join(rootDir, 'website', 'downloads');

const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

// 1. Clean up older .exe and .blockmap files from installer-output
if (fs.existsSync(installerOutputDir)) {
  const files = fs.readdirSync(installerOutputDir);
  for (const f of files) {
    if ((f.endsWith('.exe') || f.endsWith('.blockmap')) && !f.includes(pkg.version)) {
      try {
        fs.unlinkSync(path.join(installerOutputDir, f));
        console.log(`🧹 Removed older installer from installer-output: ${f}`);
      } catch (err) {
        console.warn(`Could not delete ${f}:`, err);
      }
    }
  }
}

// 2. Locate new installer
const expectedInstaller = path.join(installerOutputDir, `Paperweight Setup ${pkg.version}.exe`);
if (!fs.existsSync(expectedInstaller)) {
  console.error(`❌ Expected installer not found at: ${expectedInstaller}`);
  process.exit(1);
}

// 3. Sync to website/downloads and clean older versions
if (fs.existsSync(websiteDownloads)) {
  const dlFiles = fs.readdirSync(websiteDownloads);
  for (const f of dlFiles) {
    if (f.endsWith('.exe') && f !== 'Paperweight-Setup-latest.exe' && !f.includes(pkg.version)) {
      try {
        fs.unlinkSync(path.join(websiteDownloads, f));
        console.log(`🧹 Removed older installer from website/downloads: ${f}`);
      } catch (err) {
        console.warn(`Could not delete ${f}:`, err);
      }
    }
  }

  const latestExe = path.join(websiteDownloads, 'Paperweight-Setup-latest.exe');
  const versionedExe = path.join(websiteDownloads, `Paperweight-Setup-${pkg.version}.exe`);

  fs.copyFileSync(expectedInstaller, latestExe);
  fs.copyFileSync(expectedInstaller, versionedExe);
  console.log(`✅ Synced ${pkg.version} installer to website/downloads: latest.exe and versioned exe`);
}
