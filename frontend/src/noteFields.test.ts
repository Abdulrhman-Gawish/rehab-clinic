// Run with `npm test` (node:test through tsx: no extra dependency).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NOTE_FIELDS, noteFieldsFor, otherFilledFields, showsAttachments } from './noteFields';

describe('clinical note fields by appointment type', () => {
  it('follows the API: each type has its own fields, pain level in every type', () => {
    assert.deepEqual(noteFieldsFor('EXAMINATION'), ['chiefComplaint', 'assessment', 'diagnosis', 'plan', 'painScore']);
    assert.deepEqual(noteFieldsFor('SESSION'), ['treatmentDone', 'progress', 'painScore']);
    assert.deepEqual(noteFieldsFor('FOLLOW_UP'), ['assessment', 'progress', 'plan', 'painScore']);
  });

  it('a type that is not set shows every field and the attachments', () => {
    assert.deepEqual(noteFieldsFor(null), NOTE_FIELDS);
    assert.deepEqual(noteFieldsFor(undefined), NOTE_FIELDS);
    assert.equal(showsAttachments(null), true);
  });

  it('only examination notes show the attachments among the typed notes', () => {
    assert.equal(showsAttachments('EXAMINATION'), true);
    assert.equal(showsAttachments('SESSION'), false);
    assert.equal(showsAttachments('FOLLOW_UP'), false);
  });

  it('lists the filled fields of other types (kept read-only after a type change)', () => {
    const note = { chiefComplaint: 'Back pain', diagnosis: 'Disc herniation', plan: '', treatmentDone: 'Traction', painScore: 0 };
    assert.deepEqual(otherFilledFields('SESSION', note), ['chiefComplaint', 'diagnosis']);
    assert.deepEqual(otherFilledFields('EXAMINATION', note), ['treatmentDone']);
    assert.deepEqual(otherFilledFields(null, note), []);
  });
});
