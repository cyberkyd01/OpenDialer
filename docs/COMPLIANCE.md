# Compliance: what OpenDialer does and what you must do

> **This is not legal advice.** Telemarketing, call-recording and data-protection laws differ by country,
> state and industry, and they change. This page explains which safeguards OpenDialer provides and which
> obligations stay with you, the operator. Before you start calling, ask a qualified lawyer to review your
> campaigns, scripts, data sources and settings. You are solely responsible for how you use OpenDialer.

## 1. What OpenDialer enforces

Every lead passes a **compliance gate** before it is assigned to an agent and again right before it is
dialled, including numbers an agent types in manually. See [ARCHITECTURE.md](ARCHITECTURE.md#compliance-gate).

| Safeguard | Where to configure | Behaviour |
|---|---|---|
| **Internal do-not-call (DNC) list** | *DNC* page (add, check, import CSV), plus dispositions in the *DNC* category | Numbers on the list are never dialled. When an agent picks a DNC disposition (*"Do not call me"*), the number is added immediately. Imports skip DNC numbers |
| **Calling hours and days per lead timezone** | *Campaign → Calling hours / days / timezone mode* | Leads are only dialled inside the window in **their** local time. Timezone comes from the lead, else from the phone number's area/country, else from the campaign/default setting |
| **Max attempts per lead** | *Campaign → Max attempts / retry delay* | Leads are retired after N attempts. Retries wait for the disposition's or campaign's retry delay |
| **Daily cap per phone number** | *Settings → Max attempts per number per day* (default 3) | Limits calls to the same number in any 24 hours, across all campaigns |
| **Consent flag** | *Settings → Require consent flag* | Only leads whose `consent` column is `yes` / `true` / `1` / `y` are dialled |
| **No predictive / no abandoned calls** | n/a | Calls are only placed for an agent who is ready, so nobody answers to silence (see "abandoned call" rules below) |
| **Recording policy + notice** | *Campaign → Recording (off / always / agent)*, *Settings → Recording consent notice* | The notice text is shown to agents to read out. Agents can be allowed to start/stop recording |
| **Audit log** | *Admin → Audit log* | Who imported, exported, changed settings, deleted data, added DNC numbers |
| **Role-based access** | *Users* | Agents only see their assigned campaigns and leads. Exports and settings are restricted to supervisors/admins |

## 2. What you are responsible for

### Lists and consent

- **Lawful source of every lead.** Know where each number came from and on what legal basis you may call
  it. Keep that evidence (store it in a custom column, for example `consent_source`, `consent_date`).
- **National DNC registries.** OpenDialer's DNC list is your **internal** list. It does not automatically
  check government registries. Scrub your lists against them before importing (and re-scrub as the
  law requires), and import the registry numbers into OpenDialer's DNC list if your licence allows:
  - USA: National Do Not Call Registry (scrub at least every 31 days) plus state registries.
  - UK: TPS / CTPS (Telephone/Corporate Telephone Preference Service).
  - Canada: National DNCL. Australia: Do Not Call Register. Other countries have similar lists.
- **Honour opt-outs immediately**, across all campaigns. Train agents to use the DNC disposition.
- **Caller ID:** present a real number you own that people can call back. Spoofing is illegal in many countries.

### Calling-time and frequency rules

OpenDialer enforces the window you configure. **You** must choose a window that is legal:

- **USA, TCPA / TSR:** calls only 8 am–9 pm in the called party's local time. Several states are stricter
  (shorter hours, no Sundays/holidays, attempt limits such as 3 calls per 24 h, for example Florida, Oklahoma,
  Maryland). Autodialled or prerecorded calls to mobile phones generally need prior express (written)
  consent. The TSR limits abandoned calls and requires an identification message.
- **UK:** Ofcom persistent-misuse rules (abandoned and silent calls). PECR: no live marketing calls to TPS-registered
  numbers without specific consent.
- **EU:** national rules differ widely (opt-in vs opt-out registries, allowed hours, some countries
  ban cold calls to consumers entirely).

Holidays are not built into OpenDialer. Pause campaigns or set the calling days accordingly.

### Data protection (GDPR, UK GDPR, CCPA and similar)

- Have a **lawful basis** for processing lead data (consent or legitimate interest with a documented
  balancing test) and tell people about it (privacy notice, and on request during the call).
- **Minimise** data: only import the columns you need. Set retention periods and delete old leads,
  calls and recordings (campaign delete, lead delete, recordings folder).
- Handle **data subject requests**: access, correction, deletion, objection (add the number to DNC, then
  delete the personal data you no longer need).
- **Security:** you host the data. Use https, strong passwords, least-privilege roles, encrypted disks and
  encrypted off-site backups. Restrict who can export. See the checklist in [REMOTE-ACCESS.md](REMOTE-ACCESS.md#3-security-checklist).
- **Processors:** your SIP provider, hosting provider and TURN provider may process call data. Sign
  data processing agreements where required. Keep records of processing.

### Call recording

- **Tell people** when calls are recorded (use the *Recording consent notice* in your script).
- **USA:** some states require **all-party consent** (for example California, Florida, Illinois, Maryland,
  Massachusetts, Montana, New Hampshire, Pennsylvania, Washington, among others). With people in those
  states, get consent at the start of the call or don't record.
- **EU/UK:** recording needs a lawful basis and transparency. Some sectors (finance) *must* record,
  and others may not without consent.
- Store recordings securely and delete them when no longer needed. They are files in the
  `recordings/` folder of the data directory.

### People and process

- Train agents on scripts, required disclosures (company name, purpose, how to opt out), and the DNC
  disposition. Supervise with the wallboard and call reviews.
- Document your settings (calling hours, attempts, caps) per campaign and keep the audit log.
- Review your setup whenever laws change or you start calling a new country or state.

## 3. Quick setup checklist

- [ ] Leads scrubbed against the relevant national/state DNC registries before import
- [ ] Internal DNC list imported (previous opt-outs)
- [ ] *Default country* and *Default timezone* set correctly (phone parsing and timezones depend on them)
- [ ] Campaign calling hours/days set to the strictest rule that applies to the people you call
- [ ] Max attempts, retry delay and the daily cap per number set
- [ ] *Require consent flag* on, if your campaigns rely on consent, with a `consent` column in your CSVs
- [ ] Caller ID is a real, callable number you own (configured on the PBX/provider)
- [ ] Recording policy and consent notice decided per campaign
- [ ] Agents trained and scripts include the required disclosures
- [ ] Retention and deletion routine for leads, calls and recordings
- [ ] Legal review completed

---

*OpenDialer is provided "as is", without warranty of any kind (see [LICENSE](../LICENSE)). The authors and
contributors accept no liability for how it is used.*
