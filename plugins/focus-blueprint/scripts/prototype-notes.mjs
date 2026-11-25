// The notes on the wired prototype (mockup/prototype.html), kept in .blueprint/prototype-notes.json.
//   { notes: [{ id, screen, text, source: "artifact" | "local", ref, at, status: "open" | "done", how, doneAt }] }
// Append only; the one change to a note is its status. Node only, no dependencies.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MAX_TEXT = 2000;
export const SOURCES = ['artifact', 'local'];

const notesPath = (projectDir) => path.join(projectDir, '.blueprint', 'prototype-notes.json');

/** The files of the map's screens. */
export function mapScreenFiles(projectDir) {
  let map = null;
  try { map = JSON.parse(fs.readFileSync(path.join(projectDir, '.blueprint', 'map.json'), 'utf8')); } catch { /* no map */ }
  return (Array.isArray(map?.screens) ? map.screens : []).map((s) => (s && typeof s.file === 'string' ? s.file : '')).filter(Boolean);
}

/** A missing file gives no notes; an unreadable one throws, so it is never overwritten. */
export function readNotes(projectDir) {
  let raw;
  try { raw = fs.readFileSync(notesPath(projectDir), 'utf8'); } catch (e) {
    if (e && e.code === 'ENOENT') return [];
    throw new Error(`cannot read ${notesPath(projectDir)}: ${e.message}`);
  }
  let doc;
  try { doc = JSON.parse(raw); } catch (e) { throw new Error(`${notesPath(projectDir)} is not valid JSON: ${e.message}`); }
  return Array.isArray(doc?.notes) ? doc.notes.filter((n) => n && typeof n === 'object') : [];
}

function writeNotes(projectDir, notes) {
  const file = notesPath(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify({ notes }, null, 2) + '\n'); fs.renameSync(tmp, file); } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ } throw e; }
}

/** Appends one note. Returns { status, body }; a duplicate ref is skipped (200, duplicate: true). */
export function addNote(projectDir, { screen, text, source = 'local', ref = null } = {}) {
  if (typeof screen !== 'string' || !mapScreenFiles(projectDir).includes(screen)) return { status: 400, body: { error: 'unknown screen' } };
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) return { status: 400, body: { error: 'bad text' } };
  if (!SOURCES.includes(source)) return { status: 400, body: { error: 'bad source' } };
  if (ref !== null && (typeof ref !== 'string' || !ref || ref.length > 200)) return { status: 400, body: { error: 'bad ref' } };
  const notes = readNotes(projectDir);
  if (ref) {
    const dup = notes.find((n) => n.ref === ref);
    if (dup) return { status: 200, body: { ok: true, duplicate: true, note: dup } };
  }
  const note = { id: `n-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`, screen, text: text.trim(), source, ref: ref || null, at: new Date().toISOString(), status: 'open', how: null, doneAt: null };
  notes.push(note);
  writeNotes(projectDir, notes);
  return { status: 200, body: { ok: true, note } };
}

/** Closes one note. */
export function doneNote(projectDir, id, how = null) {
  const notes = readNotes(projectDir);
  const note = notes.find((n) => n.id === id);
  if (!note) return { status: 404, body: { error: 'unknown note' } };
  if (how !== null && (typeof how !== 'string' || how.length > MAX_TEXT)) return { status: 400, body: { error: 'bad how' } };
  note.status = 'done';
  if (how) note.how = how;
  note.doneAt = new Date().toISOString();
  writeNotes(projectDir, notes);
  return { status: 200, body: { ok: true, note } };
}

/** The notes, newest last; screen narrows to one file, openOnly to the open ones. */
export function listNotes(projectDir, { screen = null, openOnly = false } = {}) {
  return readNotes(projectDir).filter((n) => (!screen || n.screen === screen) && (!openOnly || n.status !== 'done'));
}
