# Connecting OpenDialer to your phone system (SIP / WebRTC)

- [1. How a call is placed](#1-how-a-call-is-placed)
- [2. Simulator mode (try it without a phone system)](#2-simulator-mode-try-it-without-a-phone-system)
- [3. What your PBX or provider must support](#3-what-your-pbx-or-provider-must-support)
- [4. Settings in OpenDialer](#4-settings-in-opendialer)
- [5. Dial strings, dial prefix and caller ID](#5-dial-strings-dial-prefix-and-caller-id)
- [6. Example: Asterisk 18+ / FreePBX](#6-example-asterisk-18--freepbx)
- [7. Example: FreeSWITCH](#7-example-freeswitch)
- [8. Example: Telnyx](#8-example-telnyx)
- [9. Other providers](#9-other-providers)
- [10. STUN / TURN (audio through firewalls)](#10-stun--turn-audio-through-firewalls)
- [11. Firewall ports](#11-firewall-ports)
- [12. Troubleshooting](#12-troubleshooting)

---

## 1. How a call is placed

```text
 ┌────────────────────┐   leads, agent state, call log   ┌──────────────────┐
 │  Agent's browser / │ ◀──────── https + wss ─────────▶ │ OpenDialer server│
 │  desktop app /     │                                  └──────────────────┘
 │  Android (PWA)     │
 │                    │   SIP over WebSocket (wss)       ┌──────────────────┐        ┌────────┐
 │  built-in          │ ◀──────────────────────────────▶ │ PBX or SIP       │ ◀────▶ │ phone  │
 │  softphone         │   audio: DTLS-SRTP (Opus/G.711)  │ provider         │  PSTN  │ network│
 └────────────────────┘ ◀──────────────────────────────▶ └──────────────────┘        └────────┘
```

1. The OpenDialer server picks the next lead for an agent (respecting DNC, calling hours and so on) and
   sends it to the agent's screen.
2. The agent's **softphone, built into the web console**, places the call itself. It uses SIP over a
   secure WebSocket (WSS) to your PBX or SIP provider, exactly like a desk phone registered to that PBX.
3. Audio flows directly between the agent's device and the PBX/provider (WebRTC), **never through
   the OpenDialer server**.
4. The softphone reports *ringing / answered / hung up* back to the server, which logs the call and
   moves the agent to wrap-up.

So you need a phone system that browsers can talk to (**WebRTC**). Most modern PBXs can do this.

## 2. Simulator mode (try it without a phone system)

New installations start in **Simulator** mode (*Settings → Telephony → Mode: Simulator*). The
softphone then fakes calls: each call rings for a second or more, then is randomly answered (about 70 %),
busy (10 %) or not answered (20 %), and no real audio is played.
Everything else (lead assignment, scripts, dispositions, callbacks, reports, wallboard) works for real.
Use it to train agents and test campaigns. Nobody is actually called.

Switch to **SIP** when your phone system is ready.

## 3. What your PBX or provider must support

| Requirement | Why |
|---|---|
| **SIP over WebSocket, secure (WSS)**, with a certificate browsers trust | Browsers cannot speak SIP over UDP/TCP |
| **WebRTC media:** DTLS-SRTP encryption, ICE, `rtcp-mux`, AVPF | Mandatory for browser audio |
| Codec **Opus** (best) or **G.711** (PCMU/PCMA) | What browsers offer |
| One **SIP account (extension) per agent** | Each softphone registers separately |
| Outbound route to the phone network (trunk) | To reach the leads |

Asterisk (16+, 18+ recommended), FreePBX 15+, FreeSWITCH, Kamailio/OpenSIPS in front of anything,
3CX, and cloud providers with "WebRTC SIP credentials" (for example Telnyx) all work.

## 4. Settings in OpenDialer

### Settings → Telephony (admin)

| Field | Example | Meaning |
|---|---|---|
| Mode | `SIP` | `Simulator` or `SIP` |
| WSS URL | `wss://pbx.example.com:8089/ws` | Your PBX/provider's WebSocket address |
| SIP domain | `pbx.example.com` | The domain/realm of the SIP accounts. Agents register as `sip:<username>@<domain>`, and numbers are dialled as `sip:<number>@<domain>` |
| ICE servers | `stun:stun.l.google.com:19302` (default) plus your TURN server | STUN/TURN for audio through NAT (section 10) |
| Register | on | Register the softphone with the PBX. Needed for inbound calls/transfers to the agent, and recommended in general |
| Ring timeout | `45` | Seconds an outgoing call may ring before the softphone gives up (*no answer*) |

### Users → (agent) → SIP credentials (admin)

| Field | Example | Meaning |
|---|---|---|
| SIP username | `1001` | Extension / SIP user, the part before `@` |
| Auth username | *(empty)* or `1001` | Only if the PBX uses a different authentication name. Empty means the same as the SIP username |
| SIP password | `••••••` | The extension's secret |

Agents never see these values in the console. The softphone fetches them after login.

## 5. Dial strings, dial prefix and caller ID

- Leads are stored in international **E.164** format, for example `+15551234567` or `+447700900123`.
  National numbers in your CSV are converted using *Settings → Default country*.
- The softphone dials **`dialString = campaign dial prefix + E.164 number`** as
  `sip:<dialString>@<SIP domain>`.

| Dial prefix | Lead | Softphone dials | Typical PBX handling |
|---|---|---|---|
| *(empty)* | `+15551234567` | `+15551234567` | Dial plan matches `_+X.` and sends it to the trunk (strip the `+` there if the trunk wants `1555...`) |
| `9` | `+15551234567` | `9+15551234567` | PBX route "9 = outside line" strips the `9` |
| `0` | `+447700900123` | `0+447700900123` | PBX route for prefix `0` |
| `*67` | `+15551234567` | `*67+15551234567` | Feature code handled by the PBX |

Characters other than digits, `+`, `*`, `#`, letters, `.`, `_` and `-` are removed before dialling.

**Caller ID:** the number the called person sees is set by your **PBX or provider**, usually per
extension or per outbound route. The campaign's *Caller ID* field in OpenDialer documents which number
the campaign should present. Configure the matching rule on the PBX (examples below). Providers reject
caller IDs you do not own (**403 Forbidden**). Calling laws in many countries require a valid,
callable caller ID (see [COMPLIANCE.md](COMPLIANCE.md)).

## 6. Example: Asterisk 18+ / FreePBX

### FreePBX (web GUI)

Menu names differ slightly between versions:

1. **Certificate:** *Admin → Certificate Management*. Create a Let's Encrypt certificate for the PBX's
   DNS name and set it as **default**.
2. **Web server for WebSockets:** *Settings → Advanced Settings*: **Enable the mini-HTTP Server** = Yes,
   **Enable TLS for the mini-HTTP Server** = Yes, **HTTPS Bind Port** = `8089`. Apply.
3. **WSS transport:** *Settings → Asterisk SIP Settings → SIP Settings [chan_pjsip]*: enable **wss**
   on `0.0.0.0`. Under *General SIP Settings* set your external address and local networks (NAT), and add a STUN server.
4. **One extension per agent:** *Applications → Extensions → Add PJSIP extension*. On the
   **Advanced** tab set **Enable WebRTC defaults** = Yes (or set Transport = `0.0.0.0-wss`,
   Media Encryption = DTLS-SRTP, ICE Support = Yes, Enable AVPF = Yes, RTCP Mux = Yes). Set codecs
   to `opus, ulaw, alaw`. Set the **Outbound CID** to the number agents should present.
5. **Outbound route:** *Connectivity → Outbound Routes*. Add dial patterns that match what the softphone
   sends, for example prefix `+` with match pattern `X.` (E.164 with plus), or prefix `9` if you use dial prefix `9`.
6. In OpenDialer: WSS URL `wss://pbx.example.com:8089/ws`, SIP domain `pbx.example.com`, and each
   agent's SIP username = extension number, password = extension secret.

### Plain Asterisk (config files)

`/etc/asterisk/http.conf`:

```ini
[general]
enabled=yes
bindaddr=127.0.0.1          ; plain http only locally
bindport=8088
tlsenable=yes
tlsbindaddr=0.0.0.0:8089    ; wss://pbx.example.com:8089/ws
tlscertfile=/etc/asterisk/keys/fullchain.pem
tlsprivatekey=/etc/asterisk/keys/privkey.pem
```

`/etc/asterisk/pjsip.conf`:

```ini
[transport-wss]
type=transport
protocol=wss
bind=0.0.0.0
; behind NAT also set external addresses on your UDP transport for the trunk

; ---- one block of three per agent ----
[1001]
type=endpoint
context=from-opendialer
webrtc=yes                  ; = use_avpf, media_encryption=dtls, dtls_auto_generate_cert, ice_support, rtcp_mux ...
disallow=all
allow=opus,ulaw,alaw
auth=1001
aors=1001
callerid="Sales" <+15551230000>
send_pai=yes

[1001]
type=auth
auth_type=userpass
username=1001
password=a-long-random-secret

[1001]
type=aor
max_contacts=3
remove_existing=yes
```

`/etc/asterisk/rtp.conf`:

```ini
[general]
rtpstart=10000
rtpend=20000
icesupport=yes
stunaddr=stun.l.google.com:19302
```

`/etc/asterisk/extensions.conf`. The softphone sends `+E.164` (empty dial prefix):

```ini
[from-opendialer]
; +15551234567 -> trunk, with the campaign caller ID
exten => _+X.,1,NoOp(OpenDialer call to ${EXTEN})
 same => n,Set(CALLERID(num)=+15551230000)
 same => n,Dial(PJSIP/${EXTEN}@my-trunk,60)          ; or ${EXTEN:1} if the trunk wants no "+"
 same => n,Hangup()

; dial prefix "9": 9+15551234567 -> strip the 9
exten => _9+X.,1,Dial(PJSIP/${EXTEN:1}@my-trunk,60)
 same => n,Hangup()
```

Different caller IDs per campaign: give each campaign its own dial prefix (for example `81`, `82`)
and match `_81+X.` / `_82+X.` with different `Set(CALLERID(num)=...)` lines.

Reload with `asterisk -rx "core reload"`. Check with `asterisk -rx "http show status"` (should list
`/ws`) and `asterisk -rx "pjsip show contacts"` after an agent logs in.

## 7. Example: FreeSWITCH

Plain SIP over WSS (no Verto needed).

1. **Certificate:** concatenate certificate, key and chain into `/etc/freeswitch/tls/wss.pem`:

   ```bash
   cat /etc/letsencrypt/live/pbx.example.com/{fullchain.pem,privkey.pem} > /etc/freeswitch/tls/wss.pem
   ```

2. **WSS on port 7443**, in `conf/sip_profiles/internal.xml` (usually already present):

   ```xml
   <param name="wss-binding" value=":7443"/>
   <param name="tls-cert-dir" value="/etc/freeswitch/tls"/>
   <param name="apply-candidate-acl" value="localnet.auto"/>
   <param name="ext-rtp-ip" value="auto-nat"/>
   <param name="ext-sip-ip" value="auto-nat"/>
   ```

3. **Codecs**, in `conf/vars.xml`:

   ```xml
   <X-PRE-PROCESS cmd="set" data="global_codec_prefs=OPUS,PCMU,PCMA"/>
   <X-PRE-PROCESS cmd="set" data="outbound_codec_prefs=OPUS,PCMU,PCMA"/>
   ```

4. **Agents** in `conf/directory/default/1001.xml` (copy for each agent):

   ```xml
   <include>
     <user id="1001">
       <params>
         <param name="password" value="a-long-random-secret"/>
       </params>
       <variables>
         <variable name="user_context" value="opendialer"/>
         <variable name="effective_caller_id_number" value="+15551230000"/>
         <variable name="outbound_caller_id_number" value="+15551230000"/>
       </variables>
     </user>
   </include>
   ```

5. **Dial plan** `conf/dialplan/opendialer.xml`:

   ```xml
   <include>
     <context name="opendialer">
       <extension name="pstn-out">
         <condition field="destination_number" expression="^\+(\d{6,15})$">
           <action application="set" data="effective_caller_id_number=+15551230000"/>
           <action application="bridge" data="sofia/gateway/my-provider/+$1"/>
         </condition>
       </extension>
     </context>
   </include>
   ```

6. `fs_cli -x "reloadxml"` and `fs_cli -x "sofia profile internal restart"`.
7. In OpenDialer: WSS URL `wss://pbx.example.com:7443`, SIP domain = the FreeSWITCH domain (by default the
   server's IP or the `domain` variable in `vars.xml`).

## 8. Example: Telnyx

Telnyx supports SIP over WebSocket with SIP credentials, so no PBX of your own is needed.

1. In the Telnyx portal create a **SIP Connection** with **Credentials** authentication and assign an
   **Outbound Voice Profile** (countries you are allowed to call) and a phone number you own.
2. Create one **SIP credential** per agent (*Telephony credentials* / credentials on the connection).
   Note the SIP username and password.
3. In OpenDialer (*Settings → Telephony*), use the WebSocket address and SIP domain from Telnyx's current
   WebRTC/SIP-over-WebSocket documentation. At the time of writing these were `wss://rtc.telnyx.com` and
   `sip.telnyx.com`; check before going live.
4. Enter each agent's credential in *Users*. Leave the dial prefix empty (Telnyx accepts `+E.164`).
5. Set the caller ID on the connection / outbound profile to a Telnyx number you own.

## 9. Other providers

- **Providers with "WebRTC" or "SIP over WebSocket" support:** enter their WSS URL and SIP domain,
  and one SIP account per agent, as above.
- **Classic SIP trunks without WebSocket support** (many VoIP.ms, Zadarma, Twilio Elastic SIP Trunking and
  carrier plans): put a PBX in between. Agents register to Asterisk/FreePBX/FreeSWITCH via WSS (sections 6–7),
  and the PBX connects to the provider as a normal SIP trunk (UDP/TLS). This is the most flexible setup
  and keeps provider passwords off agent devices.
- **3CX and hosted PBXs:** use their WebRTC/WSS endpoint and per-extension credentials if they allow
  third-party WebRTC clients.

## 10. STUN / TURN (audio through firewalls)

- **STUN** tells the browser its public address. The default `stun:stun.l.google.com:19302` is fine.
- **TURN** relays the audio when a direct path is impossible (strict corporate firewalls, mobile
  networks, double NAT). Without TURN, some agents will get **no audio or one-way audio**.

Minimal **coturn** (`sudo apt install coturn`), `/etc/turnserver.conf`:

```ini
listening-port=3478
tls-listening-port=5349
realm=turn.example.com
fingerprint
lt-cred-mech
user=opendialer:a-long-random-turn-password
external-ip=203.0.113.10          # your public IP (public/private if behind NAT: 203.0.113.10/192.168.1.5)
min-port=49160
max-port=49260
cert=/etc/letsencrypt/live/turn.example.com/fullchain.pem
pkey=/etc/letsencrypt/live/turn.example.com/privkey.pem
no-cli
no-multicast-peers
denied-peer-ip=10.0.0.0-10.255.255.255      # stop the relay being used to reach your LAN
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
allowed-peer-ip=192.168.1.20                # ...except the PBX, if it is on the LAN
```

Enable and start it: `sudo systemctl enable --now coturn` (on Debian also set `TURNSERVER_ENABLED=1` in `/etc/default/coturn`).

ICE servers in *Settings → Telephony*:

```json
[
  { "urls": "stun:turn.example.com:3478" },
  { "urls": "turn:turn.example.com:3478?transport=udp", "username": "opendialer", "credential": "a-long-random-turn-password" },
  { "urls": "turns:turn.example.com:5349?transport=tcp", "username": "opendialer", "credential": "a-long-random-turn-password" }
]
```

These TURN credentials are sent to every logged-in agent's softphone. Use a dedicated TURN user,
not a password used anywhere else. Managed TURN services (Twilio, Metered, Cloudflare Calls TURN)
also work.

## 11. Firewall ports

| Where | Port | For |
|---|---|---|
| PBX | TCP **8089** (Asterisk) / **7443** (FreeSWITCH) | WSS from agents |
| PBX | UDP **10000–20000** (Asterisk `rtp.conf`) / **16384–32768** (FreeSWITCH) | Audio (SRTP) |
| PBX | UDP/TCP 5060, 5061 | Trunk to your provider, only from the provider's IPs |
| TURN | UDP+TCP **3478**, TCP **5349**, UDP **49160–49260** (relay range) | Audio relay |
| Agents | outbound UDP to the above | Most home routers allow this by default |

Restrict the SIP trunk ports to your provider's IP addresses and use fail2ban on the PBX. Internet-facing
SIP servers are constantly scanned for weak passwords.

## 12. Troubleshooting

Open the softphone panel in the console (and the browser's developer console, **F12**) for error details.
On Asterisk, `pjsip set logger on` shows the SIP messages.

| Symptom | Likely cause | Fix |
|---|---|---|
| Softphone stays *disconnected* / "WebSocket closed" | Wrong WSS URL, port blocked, or the PBX certificate is not trusted | Open `https://pbx.example.com:8089/ws` in the same browser: a certificate warning means the browser silently refuses the WebSocket. Use a real certificate (Let's Encrypt) on the PBX. Check firewall port 8089/7443 |
| Connected but **registration fails** (401/403 loop) | Wrong SIP username, auth username or password, or SIP domain/realm mismatch | Compare the user's SIP credentials with the extension. The SIP domain must be the PBX's domain/realm, not an IP if the PBX expects its name |
| **403 Forbidden** when dialling | Caller ID not allowed by provider, or destination not permitted (country/route) | Use a caller ID you own. Check the outbound route/profile allows the destination. Check the dial prefix matches a route |
| **404 Not Found** / **484 Address Incomplete** | No dial plan match for the dial string | Match `+E.164` (or your prefix) in the PBX dial plan, see section 5 |
| **488 Not Acceptable Here** | No common codec or encryption mismatch | Allow `opus`, `ulaw`, `alaw` on the extension. WebRTC must be enabled (`webrtc=yes` / "WebRTC defaults") so DTLS-SRTP is offered |
| Call connects but **no audio / one-way audio** | NAT: media cannot flow | Add a TURN server (section 10). On the PBX set external IP / local nets. Open the RTP port range. Check `icesupport=yes` |
| Audio drops after ~30 s | NAT/firewall timeouts or ICE consent failures | TURN over TCP/TLS (`turns:`), and check the firewall doesn't time out UDP too early |
| "Microphone blocked" | Page not on https, or permission denied | See [DEPLOYMENT.md troubleshooting](DEPLOYMENT.md#10-troubleshooting) |
| Calls work in the office, not from home | PBX WSS/RTP only reachable on the LAN | Expose WSS + RTP safely, or use a VPN/Tailscale ([REMOTE-ACCESS.md](REMOTE-ACCESS.md#4-dont-forget-the-phone-system)) |
