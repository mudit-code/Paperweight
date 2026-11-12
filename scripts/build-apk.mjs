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

// Copy to clean android-output folder
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const targetApk = path.join(outputDir, `Paperweight-v${pkg.version}.apk`);
fs.copyFileSync(sourceApk, targetApk);

const stats = fs.statSync(targetApk);
const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);

console.log(`\n🎉 Android APK built successfully!`);
console.log(`📦 Output: ${targetApk} (${sizeMb} MB)`);

