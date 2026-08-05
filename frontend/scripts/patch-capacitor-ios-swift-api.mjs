import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const capacitorRoot = resolve(root, 'node_modules/@capacitor/ios');
const packageJson = JSON.parse(readFileSync(resolve(capacitorRoot, 'package.json'), 'utf8'));

if (packageJson.version !== '8.4.2') {
  throw new Error(`Unsupported @capacitor/ios version: ${packageJson.version}`);
}

const callPath = resolve(capacitorRoot, 'Capacitor/Capacitor/CAPPluginCall.swift');
let source = readFileSync(callPath, 'utf8');

const replacements = [
  ['@objc public extension CAPPluginCall {', '@objc extension CAPPluginCall {'],
  ['    func resolve() {', '    @objc public func resolve() {'],
  ['    func resolve(_ data: PluginCallResultData = [:]) {', '    @objc public func resolve(_ data: PluginCallResultData = [:]) {'],
  ['    func reject(_ message: String, _ code: String? = nil, _ error: Error? = nil, _ data: PluginCallResultData? = nil) {', '    @objc public func reject(_ message: String, _ code: String? = nil, _ error: Error? = nil, _ data: PluginCallResultData? = nil) {'],
  ['    func unimplemented() {', '    @objc public func unimplemented() {'],
  ['    func unimplemented(_ message: String) {', '    @objc public func unimplemented(_ message: String) {'],
  ['    func unavailable() {', '    @objc public func unavailable() {'],
  ['    func unavailable(_ message: String) {', '    @objc public func unavailable(_ message: String) {'],
];

const pending = replacements.filter(([from]) => source.includes(from));

if (pending.length === 0) {
  if (replacements.every(([, to]) => source.includes(to))) {
    process.exit(0);
  }
  throw new Error('CAPPluginCall.swift is only partially patched');
}

if (pending.length !== replacements.length) {
  throw new Error('CAPPluginCall.swift has an unexpected mix of patched and unpatched APIs');
}

for (const [from, to] of pending) {
  source = source.replace(from, to);
}

writeFileSync(callPath, source, 'utf8');
