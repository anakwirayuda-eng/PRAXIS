import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.resolve(__dirname, '..', 'manifest.json');

export class Manifest {
  static load() {
    if (fs.existsSync(MANIFEST_PATH)) {
      return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
    }
    return {
      version: new Date().toISOString(),
      sources: {},
      totalCases: 0,
      lastCompile: null,
      lastDeploy: null,
    };
  }

  static save(data) {
    // 🔥 Genius Hack 4: Atomic Write — tulis ke .tmp lalu rename instan
    const tmpPath = `${MANIFEST_PATH}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    fs.renameSync(tmpPath, MANIFEST_PATH);
  }

  static getSource(sourceId) {
    const m = Manifest.load();
    return m.sources[sourceId] || { resumeOffset: 0, etag: null, status: 'new', rowCount: 0 };
  }

  static updateSource(sourceId, patch) {
    const m = Manifest.load();
    m.sources[sourceId] = { ...(m.sources[sourceId] || {}), ...patch };
    Manifest.save(m);
  }

  static markCompiled(totalCases) {
    const m = Manifest.load();
    m.lastCompile = new Date().toISOString();
    m.totalCases = totalCases;
    Manifest.save(m);
  }

  static markDeployed() {
    const m = Manifest.load();
    m.lastDeploy = new Date().toISOString();
    Manifest.save(m);
  }
}
