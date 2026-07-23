import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const buildGradlePath = path.join(rootDir, 'android', 'app', 'build.gradle');
const infoPlistPath = path.join(rootDir, 'ios', 'App', 'App', 'Info.plist');
const xcodeProjectPath = path.join(rootDir, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function writeText(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
}

function replaceOrFail(content, pattern, replacement, label) {
  if (!pattern.test(content)) {
    throw new Error(`Could not update ${label}`);
  }
  pattern.lastIndex = 0;
  return content.replace(pattern, replacement);
}

const packageJson = JSON.parse(readText(packageJsonPath));
const version = packageJson.version;

if (!/^\d+(\.\d+)*$/.test(version)) {
  throw new Error(`Unsupported version format: ${version}`);
}

const versionCode = Number(version.replace(/\./g, ''));

if (!Number.isInteger(versionCode) || versionCode <= 0) {
  throw new Error(`Invalid computed versionCode: ${versionCode}`);
}

let buildGradle = readText(buildGradlePath);
buildGradle = replaceOrFail(
  buildGradle,
  /def appVersionCode = \(System\.getenv\("DARMAVOZ_VERSION_CODE"\) \?: "\d+"\)\.toInteger\(\)/,
  () => `def appVersionCode = (System.getenv("DARMAVOZ_VERSION_CODE") ?: "${versionCode}").toInteger()`,
  'Android versionCode fallback',
);
buildGradle = replaceOrFail(
  buildGradle,
  /def appVersionName = System\.getenv\("DARMAVOZ_VERSION_NAME"\) \?: "[^"]+"/,
  () => `def appVersionName = System.getenv("DARMAVOZ_VERSION_NAME") ?: "${version}"`,
  'Android versionName fallback',
);
writeText(buildGradlePath, buildGradle);

let infoPlist = readText(infoPlistPath);
infoPlist = replaceOrFail(
  infoPlist,
  /(<key>CFBundleShortVersionString<\/key>\s*<string>)(.*?)(<\/string>)/s,
  (_, prefix, _value, suffix) => `${prefix}${version}${suffix}`,
  'iOS CFBundleShortVersionString',
);
infoPlist = replaceOrFail(
  infoPlist,
  /(<key>CFBundleVersion<\/key>\s*<string>)(.*?)(<\/string>)/s,
  (_, prefix, _value, suffix) => `${prefix}${versionCode}${suffix}`,
  'iOS CFBundleVersion',
);
writeText(infoPlistPath, infoPlist);

let xcodeProject = readText(xcodeProjectPath);
xcodeProject = replaceOrFail(
  xcodeProject,
  /MARKETING_VERSION = [^;]+;/g,
  () => `MARKETING_VERSION = ${version};`,
  'Xcode MARKETING_VERSION',
);
xcodeProject = replaceOrFail(
  xcodeProject,
  /CURRENT_PROJECT_VERSION = [^;]+;/g,
  () => `CURRENT_PROJECT_VERSION = ${versionCode};`,
  'Xcode CURRENT_PROJECT_VERSION',
);
writeText(xcodeProjectPath, xcodeProject);

console.log(`Synced version ${version} (${versionCode}) to Android and iOS.`);
