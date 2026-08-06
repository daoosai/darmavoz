import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = resolve(root, 'node_modules/@capacitor/push-notifications');
const packageJson = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'));

if (packageJson.version !== '8.1.3-nightly-20260804T154935.0') {
  throw new Error(`Unsupported @capacitor/push-notifications version: ${packageJson.version}`);
}

const handlerPath = resolve(packageRoot, 'ios/Sources/PushNotificationsPlugin/PushNotificationsHandler.swift');
let handler = readFileSync(handlerPath, 'utf8');

const replacements = [
  [
    'self.plugin?.getConfig().getArray("presentationOptions") as? [String]',
    'self.plugin?.getConfig().getConfigJSON()["presentationOptions"] as? [String]',
  ],
  [
    'JSTypes.coerceDictionaryToJSObject(request.content.userInfo) ?? [:]',
    'request.content.userInfo.reduce(into: JSObject()) { result, entry in\n' +
      '                if let key = entry.key as? String, let value = entry.value as? JSValue {\n' +
      '                    result[key] = value\n' +
      '                }\n' +
      '            }',
  ],
];

const pendingReplacements = replacements.filter(([from]) => handler.includes(from));

if (pendingReplacements.length === 0) {
  if (replacements.every(([, to]) => handler.includes(to))) {
    process.exit(0);
  }
  throw new Error('Capacitor Push Notifications source is only partially patched');
}

if (pendingReplacements.length !== replacements.length) {
  throw new Error('Capacitor Push Notifications source has an unexpected mix of patched and unpatched APIs');
}

for (const [from, to] of pendingReplacements) {
  if (!handler.includes(from)) {
    throw new Error(`Expected Capacitor Push Notifications source was not found: ${from}`);
  }
  handler = handler.replace(from, to);
}

writeFileSync(handlerPath, handler, 'utf8');
