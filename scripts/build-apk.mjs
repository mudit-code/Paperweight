import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const androidDir = path.join(rootDir, 'android');
const outputDir = path.join(rootDir, 'android-output');

// Setup environment variables
const env = {
  ...process.env,
  JAVA_HOME: process.env.JAVA_HOME || 'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.11.10-hotspot',
  ANDROID_HOME: process.env.ANDROID_HOME || 'C:\\Users\\desktop\\AppData\\Local\\Android\\Sdk',
};

console.log('🤖 Building Android Native APK (assembleDebug)...');
console.log(`📁 Android directory: ${androidDir}`);
console.log(`☕ JAVA_HOME: ${env.JAVA_HOME}`);
console.log(`📱 ANDROID_HOME: ${env.ANDROID_HOME}`);

const gradlewCmd = process.platform === 'win32' ? `"${path.join(androidDir, 'gradlew.bat')}"` : './gradlew';
const result = spawnSync(gradlewCmd, ['assembleDebug', '--no-daemon'], {
  cwd: androidDir,
  env,
  stdio: 'inherit',
  shell: true,
});

if (result.status !== 0) {
  console.error(`❌ Gradle build failed with exit code ${result.status}`);
  process.exit(result.status || 1);
}

// Locate generated APK
const sourceApk = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
if (!fs.existsSync(sourceApk)) {
  console.error(`❌ Could not find generated APK at: ${sourceApk}`);
  process.exit(1);
}

// Read package version
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

// Copy to clean android-output folder and clean older APKs
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
} else {
  // Remove any previous versions to avoid duplicate APKs
  const existingFiles = fs.readdirSync(outputDir);
  for (const f of existingFiles) {
    const fullPath = path.join(outputDir, f);
    if (fs.statSync(fullPath).isDirectory()) {
      fs.rmSync(fullPath, { recursive: true, force: true });
      console.log(`🧹 Removed directory: ${f}`);
    } else if (f.endsWith('.apk') && !f.includes(`v${pkg.version}`)) {
      fs.unlinkSync(fullPath);
      console.log(`🧹 Removed older APK: ${f}`);
    }
  }
}

const targetApk = path.join(outputDir, `Paperweight-v${pkg.version}.apk`);
fs.copyFileSync(sourceApk, targetApk);

// Sync with website downloads if folder exists
const websiteDownloads = path.join(rootDir, 'website', 'downloads');
if (fs.existsSync(websiteDownloads)) {
  const dlFiles = fs.readdirSync(websiteDownloads);
  for (const f of dlFiles) {
    if (f.endsWith('.apk') && f !== 'Paperweight-latest.apk' && !f.includes(`v${pkg.version}`)) {
      try {
        fs.unlinkSync(path.join(websiteDownloads, f));
        console.log(`🧹 Removed older APK from website/downloads: ${f}`);
      } catch (err) {
        console.warn(`Could not delete ${f}:`, err);
      }
    }
  }

  const latestApk = path.join(websiteDownloads, 'Paperweight-latest.apk');
  const versionedApk = path.join(websiteDownloads, `Paperweight-v${pkg.version}.apk`);
  fs.copyFileSync(targetApk, latestApk);
  fs.copyFileSync(targetApk, versionedApk);
  console.log(`✅ Synced ${pkg.version} APK to website/downloads: latest.apk and versioned apk`);
}

const stats = fs.statSync(targetApk);
const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);

console.log(`\n🎉 Android APK built successfully!`);
console.log(`📦 Output: ${targetApk} (${sizeMb} MB)`);

