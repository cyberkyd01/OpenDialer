import { useState } from 'react';
import { importMappingSchema, type ImportMapping, type ImportResult, type LeadList } from '@opendialer/shared';
import { Field, Modal } from '../../components/ui';
import { api, describeError } from '../../lib/api';

interface Preview {
  headers: string[];
  mapping: Partial<ImportMapping>;
  rows: Record<string, string>[];
  total: number;
}

const FIELDS: { key: keyof ImportMapping; label: string; required?: boolean }[] = [
  { key: 'phone', label: 'Phone', required: true },
  { key: 'firstName', label: 'First name' },
  { key: 'lastName', label: 'Last name' },
  { key: 'company', label: 'Company' },
  { key: 'email', label: 'Email' },
  { key: 'timezone', label: 'Timezone' },
  { key: 'priority', label: 'Priority' },
  { key: 'notes', label: 'Notes' },
];

/** Upload CSV → preview + guessed mapping → confirm mapping → import → result. */
export function ImportWizard({ list, onClose, onDone }: { list: LeadList; onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<ImportMapping | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      const p = await api.upload<Preview>(`/lists/${list.id}/import/preview`, form);
      setPreview(p);
      setMapping({
        phone: p.mapping.phone ?? '',
        firstName: p.mapping.firstName,
        lastName: p.mapping.lastName,
        company: p.mapping.company,
        email: p.mapping.email,
        timezone: p.mapping.timezone,
        priority: p.mapping.priority,
        notes: p.mapping.notes,
        customColumns: p.mapping.customColumns ?? [],
        skipDnc: true,
        dedupeAgainst: 'campaign',
      });
      setStep(2);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    if (!file || !mapping) return;
    const clean: ImportMapping = { ...mapping };
    for (const f of FIELDS) if (!clean[f.key]) delete (clean as Partial<ImportMapping>)[f.key];
    const parsed = importMappingSchema.safeParse(clean);
    if (!parsed.success) {
      setError('Choose the column that contains the phone number');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      form.append('mapping', JSON.stringify(parsed.data));
      const r = await api.upload<ImportResult>(`/lists/${list.id}/import`, form);
      setResult(r);
      setStep(3);
      onDone();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const mapped = new Set(FIELDS.map((f) => mapping?.[f.key]).filter(Boolean) as string[]);

  return (
    <Modal title={`Import leads into "${list.name}"`} wide onClose={onClose}>
      <div className="steps">
        <span className={`step ${step === 1 ? 'on' : ''}`}>1. Upload</span>
        <span className={`step ${step === 2 ? 'on' : ''}`}>2. Map columns</span>
        <span className={`step ${step === 3 ? 'on' : ''}`}>3. Result</span>
      </div>
      {error && (
        <div className="alert error" role="alert" style={{ marginBottom: '0.75rem' }}>
          {error}
        </div>
      )}
      {step === 1 && (
        <div className="stack">
          <p className="muted">CSV with a header row. Any column can be mapped; unmapped columns can be kept as custom fields.</p>
          <input type="file" accept=".csv,text/csv,text/plain" aria-label="CSV file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn primary" disabled={!file || busy} onClick={() => void upload()}>
              {busy ? 'Reading…' : 'Upload & preview'}
            </button>
          </div>
        </div>
      )}
      {step === 2 && preview && mapping && (
        <div className="stack">
          <p className="muted">
            {preview.total} rows found. Showing the first {preview.rows.length}.
          </p>
          <div className="grid cols-4">
            {FIELDS.map((f) => (
              <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`}>
                <select
                  aria-label={`Column for ${f.label}`}
                  value={(mapping[f.key] as string | undefined) ?? ''}
                  onChange={(e) => {
                    const val = e.target.value || undefined;
                    setMapping({ ...mapping, [f.key]: val, customColumns: mapping.customColumns.filter((c) => c !== val) });
                  }}
                >
                  <option value="">{f.required ? '— choose —' : '— skip —'}</option>
                  {preview.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
          <fieldset>
            <legend>Keep as custom fields</legend>
            <div className="days">
              {preview.headers
                .filter((h) => !mapped.has(h))
                .map((h) => (
                  <label key={h}>
                    <input
                      type="checkbox"
                      checked={mapping.customColumns.includes(h)}
                      onChange={(e) =>
                        setMapping({ ...mapping, customColumns: e.target.checked ? [...mapping.customColumns, h] : mapping.customColumns.filter((c) => c !== h) })
                      }
                    />
                    {h}
                  </label>
                ))}
              {preview.headers.every((h) => mapped.has(h)) && <span className="muted small">All columns are mapped.</span>}
            </div>
          </fieldset>
          <div className="row">
            <label className="check">
              <input type="checkbox" checked={mapping.skipDnc} onChange={(e) => setMapping({ ...mapping, skipDnc: e.target.checked })} /> Skip numbers on the DNC list
            </label>
            <label className="row">
              <span className="small muted">Remove duplicates within</span>
              <select
                aria-label="Dedupe against"
                style={{ width: 'auto' }}
                value={mapping.dedupeAgainst}
                onChange={(e) => setMapping({ ...mapping, dedupeAgainst: e.target.value as ImportMapping['dedupeAgainst'] })}
              >
                <option value="campaign">this campaign</option>
                <option value="list">this list</option>
                <option value="none">nothing (allow duplicates)</option>
              </select>
            </label>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {preview.headers.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r, i) => (
                  <tr key={i}>
                    {preview.headers.map((h) => (
                      <td key={h} className="nowrap">
                        {r[h]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="form-actions">
            <button type="button" className="btn" onClick={() => setStep(1)}>
              Back
            </button>
            <button type="button" className="btn primary" disabled={!mapping.phone || busy} onClick={() => void runImport()}>
              {busy ? 'Importing…' : `Import ${preview.total} rows`}
            </button>
          </div>
        </div>
      )}
      {step === 3 && result && (
        <div className="stack" data-testid="import-result">
          <div className="grid cols-4">
            <div className="stat">
              <div className="label">Imported</div>
              <div className="value success-text">{result.imported}</div>
            </div>
            <div className="stat">
              <div className="label">Duplicates</div>
              <div className="value">{result.duplicates}</div>
            </div>
            <div className="stat">
              <div className="label">On DNC</div>
              <div className="value">{result.dnc}</div>
            </div>
            <div className="stat">
              <div className="label">Invalid</div>
              <div className="value">{result.invalid}</div>
            </div>
          </div>
          <p>
            Imported <strong>{result.imported}</strong> of {result.total} rows.
          </p>
          {result.errors.length > 0 && (
            <details>
              <summary>{result.errors.length} problems</summary>
              <ul className="small">
                {result.errors.slice(0, 200).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="form-actions">
            <button type="button" className="btn primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
