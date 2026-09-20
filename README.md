# 💰 SpendWise - Daily Budget & Expense Tracker with Automated Reminders

A complete, self-contained personal and event finance tracker designed to help you set a target budget, record daily spending, view instant financial analytics, and receive **automated Email and SMS reminders** if you forget to log your daily expenses or generate your daily report.

---

## 🚀 Quick Start (1-Click Launch)

### On Windows:
Double-click `Launch-Expense-Tracker.bat` in this folder. It will:
1. Automatically verify and install dependencies if needed.
2. Launch the backend server on port `4000`.
3. Open your browser directly at `http://localhost:4000`.

### Via Terminal:
```bash
cd daily-expense-tracker
npm install
npm start
```
Then open [http://localhost:4000](http://localhost:4000) in your browser.

---

## ✨ Core Features

1. **Initial Budget & Allowance Allocation**:
   - Set starting funds / monthly allowance (e.g. ₹50,000 / $2,000).
   - Real-time remaining balance and budget consumption meter (Green < 70%, Amber 70-90%, Red > 90%).

2. **Daily Expense Logging**:
   - Log expense amount, category, payment mode (UPI, Cash, Card, Net Banking), date, time, and custom note.
   - Quick **"No Spend Today"** button for days with zero expenses.

3. **⏰ Automated Daily Reminder Engine (Email & SMS/Text)**:
   - Built-in background cron scheduler runs at your chosen cutoff time (e.g. `20:30` / 8:30 PM).
   - **Smart Condition**: If no spending or report has been submitted for the current day, it immediately dispatches an Email alert and/or SMS notification alerting you to record your spending before the day ends.
   - **Manual Instant Test**: Click **"Test Reminder"** at any time to verify email and SMS dispatch.

4. **Visual Analytics & Charts**:
   - 7-day spending trend bar chart (Chart.js).
   - Category distribution doughnut chart.

5. **Daily Reports & Data Export**:
   - Generate and email today's itemized report with a single click.
   - Print or save daily PDF summaries.
   - 1-click **Export to CSV** for Excel and accounting records.

6. **Notification Settings & SMTP Configuration**:
   - Configure recipient email and mobile phone number.
   - Built-in mail preview system works instantly out of the box.
   - Optional custom SMTP credentials (e.g., Gmail App Password) for sending real-world emails straight to your inbox.
   - Optional Twilio credentials for real GSM SMS delivery.

---

## 📁 File Structure

```
daily-expense-tracker/
├── package.json               # Node.js dependencies
├── server.js                  # Express API server + Cron scheduler + Nodemailer
├── Launch-Expense-Tracker.bat # Windows 1-click launcher
├── README.md                  # Documentation and setup guide
├── data/
│   └── db.json                # Persistent JSON database (budgets, expenses, settings)
└── public/
    ├── index.html             # Sleek, responsive dark-mode Single Page App
    ├── css/
    │   └── styles.css         # Glassmorphism styling and custom animations
    └── js/
        └── app.js             # Client controller, charts, and reminder logic
```
