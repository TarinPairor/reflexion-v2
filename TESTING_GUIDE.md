# Reflexion — Testing Guide
**For testers with no coding background**

---

## What you have received from Justin

- The **Reflexion device** — a small green circuit board with a USB audio module
  (mic and speaker) attached
- A **micro USB power cable** to power the device
- A **folder called `tigerlaunch`** sent via AirDrop or USB — save this to your
  Desktop
- An **OpenAI API key** from Justin — you will need this during setup

---

## Overview

Before your first session, you need to do a **one-time setup** (about 10–15
minutes). After that, starting a session takes about 2 minutes.

**Every session looks like this:**
1. Turn on your hotspot
2. Power on the device
3. Double-click `start.command` on your Mac
4. Open a new Terminal window and type one command to start the assessment
5. Let Aria talk to the patient — done automatically
6. View results in your browser

---

## PART A — One-Time Setup (do this once, before your first session)

### Step 1 — Move the folder to your Desktop

If you received the `tigerlaunch` folder via AirDrop, move it to your Desktop
so it is easy to find.

---

### Step 2 — Allow scripts to run on your Mac

Your Mac may block scripts from running by default. To allow them:

1. Open **System Settings** (the gear icon in your Dock)
2. Click **Privacy & Security**
3. Scroll down to the **Security** section
4. If you see a message about a blocked script, click **Allow Anyway**

You may also be asked this when you first double-click a script — if so, click
**Open** when prompted.

---

### Step 3 — Run the setup script

1. Open the `tigerlaunch` folder on your Desktop
2. Double-click **`setup.command`**
3. A black Terminal window will open — this is normal
4. Press **Enter** when it asks you to
5. It will install some software on your Mac — this may take **5–10 minutes**
6. At one point it will ask:
   > "Please enter your OpenAI API key"

   Paste in the API key Justin gave you, then press **Enter**

7. When it says **"Setup Complete!"**, press Enter to close

> **If your Mac asks for your password** during installation — type your normal
> Mac login password and press Enter. The characters won't show as you type,
> that's normal.

---

### Step 4 — Connect everything to your hotspot

You need your Mac AND the Reflexion device on the **same hotspot** for them to
talk to each other.

1. On your iPhone, turn on **Personal Hotspot**
   (Settings → Personal Hotspot → toggle on)
2. On your Mac, click the WiFi icon in the menu bar and connect to your
   iPhone's hotspot
3. Plug the Reflexion device into power using the micro USB cable
4. **Wait about 60 seconds** for the device to turn on and connect to your
   hotspot

> **Important:** The device needs to know your hotspot name and password.
> Justin should have set this up before giving you the device. If the next
> step fails, contact Justin.

---

### Step 5 — Run the IP update script

Your Mac has a unique address on your hotspot. The device needs to know this
address to send results to your Mac. This script finds your address
automatically and tells the device.

1. In the `tigerlaunch` folder, double-click **`update_mac_ip.command`**
2. A Terminal window opens
3. Make sure your Mac is on your hotspot, then press **Enter**
4. Wait — it will connect to the device and update the setting
5. When it says **"Done!"**, you are ready

> You only need to run this once, unless you switch to a different hotspot.

---

That's it for setup! You won't need to do any of this again.

---

## PART B — Running a Session (do this every time)

### Step 1 — Start your hotspot and power on the device

1. Turn on your iPhone **Personal Hotspot**
2. Make sure your Mac is connected to it (WiFi menu bar icon)
3. Plug in the Reflexion device and **wait 60 seconds**

---

### Step 2 — Start the Mac servers

1. In the `tigerlaunch` folder, double-click **`start.command`**
2. A Terminal window opens and starts two background programs
3. After a few seconds, your browser will open automatically to the dashboard
4. You will see the **Reflexion Dashboard** — leave this tab open

> Keep the Terminal window open in the background. Do not close it until you
> are done with all your sessions for the day.

---

### Step 3 — Start the assessment on the device

1. Open a new Terminal window:
   - Press **Command + Space**, type `Terminal`, press **Enter**
2. Type the following exactly and press **Enter**:

```
ssh pi@reflexion.local
```

3. If it asks:
   > "Are you sure you want to continue connecting?"

   Type `yes` and press **Enter**

4. If it asks for a password, type: `raspberry` and press **Enter**
   (the characters won't show — that's normal)

5. You are now connected to the device. Type the following and press **Enter**:

```
source ~/reflexion-env/bin/activate && python ~/pi_audio_bridge.py
```

6. You will see the text:
   > `Connected to OpenAI Realtime API`

   And then Aria will start speaking through the speaker.

---

### Step 4 — The assessment runs automatically

Aria will:
1. Have a friendly conversation with the patient (~2–3 minutes)
2. Ask 5 cognitive questions
3. Have another friendly conversation (~3–4 minutes)
4. Ask the patient to recall three words
5. Say goodbye

**You do not need to do anything during the session.** Just make sure the
patient is seated near the device so they can hear Aria clearly and the mic
can pick up their voice.

The session takes approximately **10–12 minutes** in total.

When you see:
> `All done.`

in the Terminal window, the session is complete.

---

### Step 5 — If the patient needs to stop early

If the patient wants to end the session before it finishes, they can just say:

> "I need to go" or "I'm done" or "Goodbye"

Aria will ask them to confirm, they say yes, and the session will end cleanly.
The results (with whatever was completed) will still be saved.

---

### Step 6 — View the results

1. Go back to the browser tab with the Reflexion Dashboard
2. Click the **Live Sessions** tab
3. You will see the session that just completed at the top
4. Click on it to expand and see the full results

**Score colours:**
- 🟢 Green score (6–7) — likely healthy
- 🟡 Yellow score (4–5) — borderline
- 🔴 Red score (0–3) — concern
- 🟢 Green ML result — Healthy
- 🔴 Red ML result — MCI (Mild Cognitive Impairment detected)

A **⚠ Incomplete** badge means the session ended early — scores for questions
not reached will show as **NIL**.

---

### Step 7 — Running another session

To run another session with a different patient:

1. In the same Terminal window that is connected to the device, press
   **Control + C** to stop the current session
2. Type the following and press **Enter**:

```
python ~/pi_audio_bridge.py
```

3. Aria will start again from the beginning

---

### Step 8 — Shutting down at the end of the day

1. In the Terminal window connected to the device, press **Control + C**
2. Type `exit` and press **Enter** to disconnect from the device
3. Unplug the Reflexion device from power
4. Close the `start.command` Terminal window — this will stop the Mac servers

---

## Troubleshooting

**"ssh: Could not resolve hostname reflexion.local"**
The device is not connected to your hotspot yet. Wait another 30 seconds and
try again. Make sure your Mac is also on the hotspot, not regular WiFi.

**Aria starts speaking but seems to be talking to herself / not listening**
This is an echo issue (the speaker and mic are close together). It's a known
hardware limitation. The software minimises this but occasional hiccups may
happen — Aria should recover on her own within a few seconds.

**The session ends unexpectedly**
If the patient is silent for 30 seconds total (15 seconds + another 15 seconds
after a check-in), Aria will end the session automatically to avoid hanging.
This is intentional.

**Results show "Model not available"**
The ML model files may not be in the folder. Contact Justin.

**The browser doesn't open automatically**
Manually go to: `http://localhost:3000/dashboard`

---

## Contact

If anything goes wrong, contact Justin directly. The most useful thing you can
do is take a photo of the Terminal window showing any error messages.
