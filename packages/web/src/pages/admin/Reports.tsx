import { useState } from 'react';
import type { Campaign } from '@opendialer/shared';
import { ErrorBox, useLoad } from '../../components/ui';
import { api, describeError, downloadFile } from '../../lib/api';
import { fmtDuration, fmtPct, toDateInput } from '../../lib/format';
import { toast } from '../../store/toasts';

interface CampaignRow {
  campaignId: number;
  campaignName: string;
  calls: number;
  answered: number;
  contacts: number;
  sales: number;
  talkSec: number;
  avgTalkSec: number;
  answerRate: number;
  contactRate: number;
  conversionRate: number;
}
interface AgentRow {
  userId: number;
  agentName: string;
  calls: number;
  answered: number;
  contacts: number;
  sales: number;
  talkSec: number;
  avgTalkSec: number;
  readySec: number;
  pauseSec: number;
  wrapupSec: number;
}
interface DispoReport {
  dispositions: { id: number; code: string; label: string; color: string; category: string; n: number }[];
  undisposed: number;
}
interface HourRow {
  hour: string;
  calls: number;
  answered: number;
  contacts: number;
}

/** Local day boundaries → ISO strings for the API. */
function rangeIso(from: string, to: string) {
  return {
    from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
  };
}

export default function Reports() {
  const today = toDateInput(new Date());
  const [from, setFrom] = useState(toDateInput(new Date(Date.now() - 6 * 86400000)));
  const [to, setTo] = useState(today);
  const [campaignId, setCampaignId] = useState('');
  const campaigns = useLoad(() => api.get<Campaign[]>('/campaigns'), []);
  const r = rangeIso(from, to);
  const q = { ...r, campaignId: campaignId || undefined };
  const data = useLoad(
    async () => {
      const [c, a, d, h] = await Promise.all([
        api.get<CampaignRow[]>('/reports/campaigns', r),
        api.get<AgentRow[]>('/reports/agents', r),
        api.get<DispoReport>('/reports/dispositions', q),
        api.get<HourRow[]>('/reports/hourly', q),
      ]);
      return { c, a, d, h };
    },
    [from, to, campaignId],
  );
  const d = data.data;
  const totalDispo = d ? d.d.dispositions.reduce((s, x) => s + x.n, 0) + d.d.undisposed : 0;
  const maxHour = d ? Math.max(1, ...d.h.map((x) => x.calls)) : 1;

  const exportCsv = async (kind: 'calls' | 'leads') => {
    try {
      if (kind === 'calls') await downloadFile('/reports/export/calls.csv', q, 'calls.csv');
      else await downloadFile('/reports/export/leads.csv', { campaignId: campaignId || undefined }, 'leads.csv');
    } catch (err) {
      toast.error(describeError(err));
    }
  };

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Reports</h1>
        <div className="row">
          <button type="button" className="btn" onClick={() => void exportCsv('calls')}>
            Export calls CSV
          </button>
          <button type="button" className="btn" onClick={() => void exportCsv('leads')}>
            Export leads CSV
          </button>
        </div>
      </div>
      <div className="row">
        <label className="row">
          <span className="small muted">From</span>
          <input type="date" style={{ width: 'auto' }} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="row">
          <span className="small muted">To</span>
          <input type="date" style={{ width: 'auto' }} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <select aria-label="Campaign" style={{ width: 'auto' }} value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
          <option value="">All campaigns</option>
          {(campaigns.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button type="button" className="btn small" onClick={() => (setFrom(today), setTo(today))}>
          Today
        </button>
        <button type="button" className="btn small" onClick={() => (setFrom(toDateInput(new Date(Date.now() - 29 * 86400000))), setTo(today))}>
          Last 30 days
        </button>
      </div>
      <ErrorBox error={data.error} onRetry={data.reload} />
      {d && (
        <>
          <section className="stack">
            <h2>Campaigns</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>Calls</th>
                    <th>Answered</th>
                    <th>Contacts</th>
                    <th>Sales</th>
                    <th>Answer rate</th>
                    <th>Contact rate</th>
                    <th>Conversion</th>
                    <th>Talk</th>
                    <th>Avg talk</th>
                  </tr>
                </thead>
                <tbody>
                  {d.c
                    .filter((x) => !campaignId || String(x.campaignId) === campaignId)
                    .map((x) => (
                      <tr key={x.campaignId}>
                        <td>{x.campaignName}</td>
                        <td>{x.calls}</td>
                        <td>{x.answered}</td>
                        <td>{x.contacts}</td>
                        <td>{x.sales}</td>
                        <td>{fmtPct(x.answerRate)}</td>
                        <td>{fmtPct(x.contactRate)}</td>
                        <td>{fmtPct(x.conversionRate)}</td>
                        <td>{fmtDuration(x.talkSec)}</td>
                        <td>{fmtDuration(x.avgTalkSec)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="stack">
            <h2>Agents</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Calls</th>
                    <th>Answered</th>
                    <th>Contacts</th>
                    <th>Sales</th>
                    <th>Talk</th>
                    <th>Avg talk</th>
                    <th>Ready</th>
                    <th>Paused</th>
                    <th>Wrap-up</th>
                  </tr>
                </thead>
                <tbody>
                  {d.a.map((x) => (
                    <tr key={x.userId}>
                      <td>{x.agentName}</td>
                      <td>{x.calls}</td>
                      <td>{x.answered}</td>
                      <td>{x.contacts}</td>
                      <td>{x.sales}</td>
                      <td>{fmtDuration(x.talkSec)}</td>
                      <td>{fmtDuration(x.avgTalkSec)}</td>
                      <td>{fmtDuration(x.readySec)}</td>
                      <td>{fmtDuration(x.pauseSec)}</td>
                      <td>{fmtDuration(x.wrapupSec)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <div className="grid cols-2">
            <section className="card stack">
              <h2>Dispositions</h2>
              <table>
                <tbody>
                  {d.d.dispositions.map((x) => (
                    <tr key={x.id}>
                      <td>
                        <span className="swatch" style={{ background: x.color }} /> {x.label}
                      </td>
                      <td className="right">{x.n}</td>
                      <td style={{ width: '40%' }}>
                        <div className="bar">
                          <span style={{ width: `${totalDispo ? (x.n / totalDispo) * 100 : 0}%`, background: x.color }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="muted">Not dispositioned</td>
                    <td className="right">{d.d.undisposed}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </section>
            <section className="card stack">
              <h2>By hour (UTC)</h2>
              <table>
                <thead>
                  <tr>
                    <th>Hour</th>
                    <th>Calls</th>
                    <th>Answered</th>
                    <th>Contacts</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {d.h.map((x) => (
                    <tr key={x.hour}>
                      <td className="mono">{x.hour}:00</td>
                      <td>{x.calls}</td>
                      <td>{x.answered ?? 0}</td>
                      <td>{x.contacts ?? 0}</td>
                      <td style={{ width: '35%' }}>
                        <div className="bar">
                          <span style={{ width: `${(x.calls / maxHour) * 100}%`, background: 'var(--primary)' }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                  {d.h.length === 0 && (
                    <tr>
                      <td colSpan={5} className="muted">
                        No calls in this range.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
