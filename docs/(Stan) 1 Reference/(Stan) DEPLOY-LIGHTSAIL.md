# (Stan) Deploying StockSense to AWS Lightsail

> **For Stan to read and follow.** Files marked (Stan) at the start of their name are written for you to
> act on. The marker goes at the START, because `.gitignore` treats names ENDING in `(Stan).md` as
> private notes and would never commit them.

A checklist for deploy day. Every console step below was checked against AWS's own Lightsail
documentation on 15 Sep 2026; if a label on screen differs, the meaning is the same.

**Time needed:** about 30 minutes, most of it waiting. **Cost:** a Nano container is USD 7 a month,
billed hourly, so roughly USD 3.50 for a 15 day lease. It comes out of the same AWS-sponsored USD 100
as the model calls.

---

## How it fits together

```
GitHub (push to main)
  └─ Actions builds linux/amd64, tests it, scans it for secrets
       └─ publishes ghcr.io/dunstancsr-web/puenzhiyyy:sha-<commit>
            └─ Lightsail container service pulls that image
                 └─ https://<service>.<id>.ap-southeast-1.cs.amazonlightsail.com
```

The key and the PIN never touch GitHub or the image. They are typed into Lightsail's environment
variables on deploy day and exist only there.

---

## Before you start

- [ ] **The lease timing is decided.** The Hackathon Lease expires 15 days after you submit it, and
      approval is instant. See the organizer questions in the session notes before clicking Submit.
- [ ] **The latest Actions run on `main` is green.** github.com/dunstancsr-web/puenzhiyyy → Actions.
      Note its commit, e.g. `c5a349c`. That becomes the image tag `sha-c5a349c`.
- [ ] **You have chosen a demo PIN of at least 6 characters.** The server refuses a shorter one and
      switches paid explanations off. Do not write it in the repo, the chat, or a commit.
- [ ] **You have the gateway key** from the organizers' email to hand.

---

## Step 1. Make the image public (GitHub)

Lightsail can only pull public images, and the package is private by default.

1. github.com → your profile picture → **Your profile** → **Packages** tab → **puenzhiyyy**.
2. **Package settings** (right side) → scroll to **Danger Zone** → **Change visibility** → **Public**.
   Type the package name to confirm.

This makes the image downloadable by anyone. It contains the app's code and built site, and no
secrets (the build fails if it finds any). The repo itself stays private until you change that
separately.

**Check it from the repo root:**

```
node backend/scripts/check-deploy.js --image-only
```

It must say `PASS ... can be pulled anonymously (public)`. Do not continue until it does.

---

## Step 2. Create the container service (Lightsail)

1. Log in through the hackathon login guide, then open the **Lightsail** console.
2. Left menu → **Containers** → **Create container service**.
3. **Change AWS Region** → **Asia Pacific (Singapore)**, `ap-southeast-1`.
4. **Capacity:** Power **Nano**, Scale **1**.

   > **Scale must be 1.** Each extra node would run its own separate SQLite database, its own PIN
   > lockout counter and its own daily call cap. Two judges could see different data, and the cap
   > would multiply by the number of nodes.

5. **Create a deployment** → **Specify a custom deployment**, then fill in:

   | Field | Value |
   | --- | --- |
   | Container name | `stocksense` |
   | Image | `ghcr.io/dunstancsr-web/puenzhiyyy:sha-c5a349c` (your latest green commit) |
   | Launch command | leave empty (the image already starts the server) |
   | Open ports | `8080`, protocol **HTTP** |

   **Environment variables**, one row each:

   | Key | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `DEMO_PIN` | your PIN |
   | `LLM_GATEWAY_URL` | `https://api.softwaresystems.app` |
   | `LLM_GATEWAY_API_KEY` | the key from the organizers' email |
   | `LLM_GATEWAY_MODEL` | `global.anthropic.claude-sonnet-4-5-20250929-v1:0` |

   Optional: `LLM_DAILY_CALL_LIMIT` (default 200, about USD 1.20 a day worst case) and
   `DEMO_TOKEN_SECRET` (a long random string; without it, unlocked visitors must re-enter the PIN
   after a redeploy, which is harmless).

   Watch for a trailing space when pasting the key. It becomes part of the value.

6. **Public endpoint:** Endpoint container **stocksense**, Port **8080**,
   Health check path **`/api/health`**. Leave the advanced health check settings at their defaults.

   HTTP on port 8080 is correct. Lightsail's load balancer serves visitors over HTTPS and talks to
   the container over HTTP, which is the one proxy hop the server is configured to trust.

7. **Name** the service, e.g. `four-seas-stocksense`. The name appears in the public URL.
8. **Create container service**.

The status goes **Pending → Deploying → Running**. Expect several minutes; the first deployment also
provisions the HTTPS certificate.

---

## Step 3. Verify

1. Copy the public domain from the service page. It looks like
   `https://four-seas-stocksense.<random>.ap-southeast-1.cs.amazonlightsail.com`.
2. From the repo root:

   ```
   node backend/scripts/check-deploy.js https://four-seas-stocksense.<random>.ap-southeast-1.cs.amazonlightsail.com
   ```

   Every line must be `PASS`. It checks HTTPS, health, the built site, the seeded data, the production
   defaults, that the paid tier is configured and PIN-gated, that a paid request without a pass is
   refused, and that a wrong PIN is counted. It spends no credit.

   It does submit one wrong PIN, which uses one of five tries for your address for 15 minutes.

3. **By hand, once:** open the site → **Alerts** → **Settings** (bottom of the sidebar) → **AWS Bedrock**
   → enter the PIN → **Why?** on any alert. A purple Summary from Claude Sonnet 4.5 means the gateway
   works. That one call costs about USD 0.006.

---

## Step 4. Capture evidence

The submission asks for "Deployment evidence/URL", and the lease will eventually wipe the account.

- [ ] Screenshot the Lightsail service page showing **Running** and the public domain.
- [ ] Save the full output of `check-deploy.js`.
- [ ] Screenshot the Dashboard and one Why? summary on the live URL.
- [ ] Paste the URL into `docs/Submission/WRITEUP.md` section 8 and into the Slack submission.

---

## Updating to a newer build

1. Push to `main` and wait for the Actions run to go green. Note the new commit.
2. Lightsail → the service → **Deployments** → **Modify your deployment**.
3. Change the image tag to the new `sha-<commit>`. Everything else stays.
4. **Save and deploy**.

If the new deployment fails, Lightsail keeps the previous one running, so a bad build never takes the
site down. Every redeploy resets the database to the seeded demo data.

---

## When it goes wrong

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Deployment **Failed**, logs mention pull or unauthorized | Image still private | Step 1, then redeploy |
| Deployment **Failed**, health check never passes | Port not `8080` HTTP, or wrong health check path | Check step 2.5 and 2.6 exactly |
| Site loads, Settings says paid explanations are "switched off" | `DEMO_PIN` missing or under 6 characters | Fix the variable, redeploy |
| Paid tier says "no credentials" | Gateway URL or key missing | Fix the variables, redeploy |
| Why? summary never appears, no error | Gateway rejected the key, often a pasted trailing space | Re-paste the key, redeploy |
| "Daily cap of 200 paid calls reached" | Cap doing its job | Wait, or raise `LLM_DAILY_CALL_LIMIT` deliberately |

Logs: the service page → **Logs** tab. The key never appears in them.

---

## Shutting down

**Lightsail bills a container service until it is deleted.** Disabling it does not stop the charge.
When judging is over, open the service → **Delete**. The lease expiry would remove it anyway, but
deleting it yourself stops the spend on your terms.
