import { useState } from 'react';
import type { Campaign } from '@opendialer/shared';
import { useLoad } from '../../components/ui';
import { api } from '../../lib/api';
import { LeadsTable } from './LeadsTable';

export default function Leads() {
  const campaigns = useLoad(() => api.get<Campaign[]>('/campaigns'), []);
  const [campaignId, setCampaignId] = useState('');
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Leads</h1>
        <select aria-label="Campaign filter" style={{ width: 'auto' }} value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
          <option value="">All campaigns</option>
          {(campaigns.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <LeadsTable key={campaignId} campaignId={campaignId ? Number(campaignId) : undefined} showCampaign={!campaignId} />
    </div>
  );
}
