# Using OpenDialer on Android

Agents can work from an Android phone or tablet. The OpenDialer console is a **Progressive Web App
(PWA)**: you install it from Chrome and it opens full-screen with its own icon, like a normal app.
You don't need the Play Store.

## Before you start

- Android 9 or newer with an up-to-date **Google Chrome**. Samsung Internet and Edge work, but these steps use Chrome.
- The **https** address of your OpenDialer server, for example:
  - office Wi-Fi: `https://192.168.1.10:8443` (shown when the server starts), or
  - remote: `https://dialer.example.com` (see [REMOTE-ACCESS.md](REMOTE-ACCESS.md)).
- A **headset** (wired, USB-C or Bluetooth) is strongly recommended.

## 1. Open the console and accept the certificate

1. Open **Chrome** and enter the server address.
2. If you use the office address with OpenDialer's own certificate, Chrome shows *"Your connection is
   not private"*. Tap **Advanced → Proceed to 192.168.1.10 (unsafe)**. This only appears for the
   self-signed certificate. Addresses with a real certificate (Caddy, Cloudflare Tunnel, Tailscale) open directly.
3. Log in with your username and password.

> Chrome may ask again after it is restarted or after some days. A proxied address with a real
> certificate avoids this and is the better choice for daily use on phones.

## 2. Install it as an app

1. In Chrome tap the **⋮** menu.
2. Tap **Install app** (on some versions **Add to Home screen → Install**).
3. Confirm. An **OpenDialer** icon appears on your home screen / app drawer.
4. Always start OpenDialer from this icon. It opens without the browser bar and keeps you logged in.

If "Install app" is missing, the page was not opened over https, or the certificate was not
accepted. Use **Add to Home screen**, which still works as a shortcut.

## 3. Allow the microphone (and notifications)

1. The first time you go **Ready** or place a call, Android asks *"Allow OpenDialer to record audio?"*:
   tap **While using the app** / **Allow**.
2. Allow **notifications** too, so you see callbacks and alerts.
3. If you denied it by mistake: Chrome **⋮ → Settings → Site settings → Microphone** → find the server
   address → **Allow**. Also check *Android Settings → Apps → Chrome → Permissions → Microphone*.

## 4. Keep the app awake during a shift

Android aggressively pauses apps in the background to save battery. While an agent is working:

1. **Keep OpenDialer in the foreground**, with the screen on. Use *Settings → Display → Screen timeout*
   (set it to 10–30 minutes during shifts), or keep the phone on a charger.
2. **Turn off battery optimisation for Chrome** (the PWA runs inside Chrome):
   *Settings → Apps → Chrome → Battery → Unrestricted* (Samsung: *Battery → Unrestricted*,
   and remove Chrome from *Sleeping apps*. Xiaomi: *Battery saver → No restrictions*).
3. Turn off **Battery saver / Power saving mode** during shifts.
4. Don't swipe OpenDialer away in the recent-apps list while logged in.

If the app was suspended, the console reconnects automatically when you come back. Your current lead is
kept for a short grace period, but you may miss assignments while it is in the background.

## 5. Headset tips

- **Wired or USB-C headsets** give the most reliable audio.
- **Bluetooth:** connect the headset **before** opening OpenDialer. If audio comes out of the phone
  speaker, disconnect and reconnect the headset, then reload the app (pull down to refresh, or close and reopen).
- Some Bluetooth headsets switch to low-quality "headset mode" during calls. That is normal.
- Avoid using the phone's own phone app at the same time. A regular incoming GSM call will
  interrupt the OpenDialer call.

## 6. Limitations on Android

- **Background:** Android may suspend the page when the screen is off or another app is in front.
  Then you won't be assigned new leads and timers pause. Keep it in the foreground (section 4).
- **Incoming calls:** the softphone can only ring while OpenDialer is open and in the foreground.
  There are no push-woken incoming calls like a native dialer app has. OpenDialer is built for outbound
  calling, so plan inbound work on desktops.
- **Mobile data:** calls work on 4G/5G if your phone system has a TURN server (see
  [SIP-SETUP.md](SIP-SETUP.md#10-stun--turn-audio-through-firewalls)). Expect around 0.5–1 MB per minute of call.
- The phone's **dialer, SIM and phone number are not used.** Calls go over the internet through your
  company's phone system.

## 7. Tablets: desktop layout

On a tablet you may prefer the full desktop layout (wallboard, reports, wider scripts):

- Rotate to **landscape**, as the console adapts to the width, or
- in Chrome (not the installed app) open **⋮ → Desktop site** to get the desktop layout.
- A Bluetooth keyboard makes notes and dispositions much faster.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Install app" not shown | Open the https address (not http), accept the certificate, reload. Or use *Add to Home screen* |
| Microphone permission never asked / blocked | Must be https. Fix the permission as in section 3 |
| Can't connect at all on Wi-Fi | Phone must be on the office Wi-Fi (not a guest network), and the server firewall must allow port 8443 ([REMOTE-ACCESS.md](REMOTE-ACCESS.md#1-same-office-network-lan)) |
| Certificate warning keeps coming back | Use a proxied address with a real certificate, or install the certificate ([REMOTE-ACCESS.md](REMOTE-ACCESS.md#optional-trust-the-certificate-on-each-device-no-more-warnings)) |
| No audio / one-way audio on mobile data | Your phone system needs a TURN server ([SIP-SETUP.md](SIP-SETUP.md#10-stun--turn-audio-through-firewalls)) |
| App logged out / "offline" after a while | Battery optimisation suspended it (section 4). Reopen it and log in again if asked |
