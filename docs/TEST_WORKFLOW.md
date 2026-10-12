# Testing the whole workflow (repeatable)

Open **https://kconcerts.vercel.app → ⚙ Settings → Test the workflow**. Everything uses one clearly labelled sample show (`is_synthetic = true`, tagged **TEST**). Real shows, real alerts and real bookings are never touched.

| Step | What to do | What you should see |
|---|---|---|
| 1. Create a sample show | Click **Create** | "KConcerts Sample Show (TEST)", 7 days from today, 7:30 pm, Bengaluru. It appears with a TEST tag in My Artists and All Artists. |
| 2. Send the Telegram alert | Click **Send** | A "🧪 TEST - NEW SHOW DETECTED" message from @KConcerts_bot with 👍 / 👎 buttons. (Real alerts wait for the 9 am / 6 pm digest; the test sends immediately.) |
| 3. Respond | Tap 👍 **Interested** or 👎 **Not interested** in Telegram, or on the ticket in the app | The button gets a ✅ in Telegram. Step 3 in Settings ticks itself within a few seconds. |
| 4. Book it | Choose "I booked" or "I'm going", optionally type **one extra email**, click **Confirm booking** | The event appears in the connected Google Calendar. If you entered an email, Google sends that person a calendar invite. A second click won't create a duplicate. |
| Reset | Click **↺ Reset test** | The Google Calendar event is deleted (an invitee gets a cancellation) and the sample show is removed. The panel returns to step 1. |

Notes
- Extra-email invites are limited to **10 per day**, because the dashboard has no login.
- Only the test workflow sends invites. Real bookings are added to your own calendar only, with no invitations.
- API equivalents, for automated checks: `GET /api/test/status`, `POST /api/test/create | alert | book | reset` (`book` body: `{"confirmation":"booked","email":"optional@example.com"}`).
