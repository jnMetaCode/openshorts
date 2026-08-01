import fs from 'node:fs/promises';
import path from 'node:path';
import {parseProject} from '../../shared/project-schema.mjs';

export class ProjectValidationError extends Error {
  constructor(errors) {
    super(`项目不符合 PaperCut v1 协议：\n- ${errors.join('\n- ')}`);
    this.name = 'ProjectValidationError';
    this.errors = errors;
    this.status = 400;
  }
}

export const safeId = (value, fallback = 'project') => {
  const id = String(value ?? '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return id || fallback;
};

const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
const atomicJson = async (file, value) => {
  await fs.mkdir(path.dirname(file), {recursive: true});
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temp, file);
};

export class ProjectStore {
  constructor({projectsDir, templatesDir}) { this.projectsDir = projectsDir; this.templatesDir = templatesDir; }

  async init() { await fs.mkdir(this.projectsDir, {recursive: true}); await fs.mkdir(this.templatesDir, {recursive: true}); }

  async list() {
    const entries = await fs.readdir(this.projectsDir, {withFileTypes: true});
    const projects = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const project = await readJson(path.join(this.projectsDir, entry.name));
      projects.push({id: project.id, title: project.title, scenes: project.scenes?.length ?? 0, updatedAt: (await fs.stat(path.join(this.projectsDir, entry.name))).mtime.toISOString()});
    }
    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async fileForId(id) {
    const direct = path.join(this.projectsDir, `${safeId(id)}.json`);
    try { await fs.access(direct); return direct; } catch {}
    const entries = await fs.readdir(this.projectsDir, {withFileTypes: true});
    for (const entry of entries) if (entry.isFile() && entry.name.endsWith('.json')) {
      const file = path.join(this.projectsDir, entry.name);
      if ((await readJson(file)).id === id) return file;
    }
    throw new Error(`项目不存在：${id}`);
  }

  async get(id) { return readJson(await this.fileForId(id)); }

  // 所有写入路径都过同一份 Zod schema：存进磁盘的工程一定是渲染器能读的。
  async save(project) {
    const result = parseProject({...project, id: safeId(project?.id)});
    if (!result.ok) throw new ProjectValidationError(result.errors);
    const normalized = result.project;
    const file = await this.fileForId(normalized.id).catch(() => path.join(this.projectsDir, `${normalized.id}.json`));
    await atomicJson(file, normalized);
    return normalized;
  }

  async templates() {
    const entries = await fs.readdir(this.templatesDir, {withFileTypes: true});
    const manifests = [];
    for (const entry of entries) if (entry.isFile() && entry.name.endsWith('.json')) manifests.push(await readJson(path.join(this.templatesDir, entry.name)));
    return manifests;
  }

  async createFromTemplate({templateId, id, title}) {
    const manifest = (await this.templates()).find((item) => item.id === templateId);
    if (!manifest) throw new Error(`模板不存在：${templateId}`);
    const source = manifest.project ? structuredClone(manifest.project) : await this.get(manifest.sourceProjectId);
    let nextId = safeId(id || `${manifest.id}-${Date.now().toString(36)}`);
    const existing = new Set((await this.list()).map((item) => item.id));
    if (existing.has(nextId)) nextId = `${nextId}-${Date.now().toString(36)}`;
    source.id = nextId; source.title = title || `${manifest.name}项目`;
    return this.save(source);
  }
}

export const applyVariables = (value, variables) => {
  if (typeof value === 'string') return value.replace(/\{\{\s*([\w\u4e00-\u9fff-]+)\s*\}\}/g, (match, key) => Object.hasOwn(variables, key) ? String(variables[key]) : match);
  if (Array.isArray(value)) return value.map((item) => applyVariables(item, variables));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, applyVariables(item, variables)]));
  return value;
};
