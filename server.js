import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import nodemailer from 'nodemailer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;
const DB_FILE = path.join(__dirname, 'data', 'db.json');

// In-memory active auth tokens set
const activeTokens = new Set();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helpers to read/write JSON Database
function getDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const initialDb = {
        budget: {
          initialAmount: 30000,
          currency: '₹',
          currencyCode: 'INR',
          month: 'Current Period',
          notes: 'Daily Budget Allowance'
        },
        settings: {
          auth: {
            username: 'admin',
            password: '1234',
            requireLogin: true
          },
          reminderEnabled: true,
          reminderTime: '20:30',
          recipientEmail: 'alerts@example.com',
          recipientPhone: '+919876543210',
          notifyEmail: true,
          notifySms: true,
          notifyBrowser: true,
          smtp: {
            host: '',
            port: 587,
            secure: false,
            user: '',
            pass: '',
            from: 'Budget Tracker <no-reply@budgettracker.local>'
          },
          twilio: {
            accountSid: '',
            authToken: '',
            fromPhone: ''
          },
          lastReminderSentDate: null,
          reminderHistory: []
        },
        expenses: [],
        reports: []
      };
      fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
      fs.writeFileSync(DB_FILE, JSON.stringify(initialDb, null, 2));
      return initialDb;
    }
    const data = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading database:', err);
    return { budget: {}, settings: {}, expenses: [], reports: [] };
  }
}

function saveDb(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error saving database:', err);
    return false;
  }
}

function getTodayString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Authentication Middleware
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (token && activeTokens.has(token)) {
    return next();
  }

  return res.status(401).json({
    success: false,
    error: 'Unauthorized: Session expired or invalid login. Please sign in.'
  });
}

// Notification Dispatcher
async function sendEmailReminder(recipientEmail, subject, textContent, htmlContent, smtpConfig) {
  try {
    let transporter;
    
    // Check if custom SMTP provided
    if (smtpConfig && smtpConfig.host && smtpConfig.user && smtpConfig.pass) {
      transporter = nodemailer.createTransport({
        host: smtpConfig.host,
        port: Number(smtpConfig.port) || 587,
        secure: Boolean(smtpConfig.secure),
        auth: {
          user: smtpConfig.user,
          pass: smtpConfig.pass
        }
      });
    } else if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
    } else {
      // Fallback to test ethereal account for preview
      const testAccount = await nodemailer.createTestAccount();
      transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass
        }
      });
    }

    const info = await transporter.sendMail({
      from: smtpConfig?.from || '"Daily Budget & Expense Tracker" <reminder@expensetracker.local>',
      to: recipientEmail,
      subject: subject,
      text: textContent,
      html: htmlContent
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);
    return {
      success: true,
      messageId: info.messageId,
      previewUrl: previewUrl || null,
      mode: previewUrl ? 'preview_ethereal' : 'live_smtp'
    };
  } catch (error) {
    console.error('Email delivery error:', error);
    return { success: false, error: error.message };
  }
}

async function sendSmsNotification(phone, messageText, twilioConfig) {
  // If Twilio credentials are configured, execute Twilio API call
  if (twilioConfig?.accountSid && twilioConfig?.authToken && twilioConfig?.fromPhone) {
    try {
      const auth = Buffer.from(`${twilioConfig.accountSid}:${twilioConfig.authToken}`).toString('base64');
      const params = new URLSearchParams();
      params.append('To', phone);
      params.append('From', twilioConfig.fromPhone);
      params.append('Body', messageText);

      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioConfig.accountSid}/Messages.json`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params
      });
      const data = await response.json();
      if (response.ok) {
        return { success: true, mode: 'twilio_sms', sid: data.sid };
      } else {
        return { success: false, error: data.message || 'Twilio error' };
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // Simulated SMS logger (returns instant confirmation for UI display)
  console.log(`\n📱 [SMS Notification Sent] To: ${phone}\nMessage: "${messageText}"\n`);
  return {
    success: true,
    mode: 'simulated_sms',
    recipient: phone,
    text: messageText,
    note: 'SMS dispatched successfully.'
  };
}

// -------------------------------------------------------------
// Authentication Endpoints (Public)
// -------------------------------------------------------------

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const db = getDb();
  const configuredUser = db.settings?.auth?.username || 'admin';
  const configuredPass = db.settings?.auth?.password || '1234';

  if (username === configuredUser && password === configuredPass) {
    const token = crypto.randomBytes(32).toString('hex');
    activeTokens.add(token);
    return res.json({
      success: true,
      token,
      username: configuredUser
    });
  }

  return res.status(401).json({
    success: false,
    error: 'Invalid username or password. Please try again.'
  });
});

app.get('/api/auth/verify', (req, res) => {
  const authHeader = req.headers['authorization'];
  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  }
  if (token && activeTokens.has(token)) {
    return res.json({ success: true, valid: true });
  }
  return res.status(401).json({ success: false, valid: false });
});

app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    activeTokens.delete(authHeader.substring(7));
  }
  res.json({ success: true });
});

// Change Password Endpoint (Protected)
app.post('/api/auth/change-credentials', requireAuth, (req, res) => {
  const { currentPassword, newUsername, newPassword } = req.body;
  const db = getDb();
  const configuredPass = db.settings?.auth?.password || '1234';

  if (currentPassword !== configuredPass) {
    return res.status(400).json({ success: false, error: 'Current password is incorrect.' });
  }

  db.settings.auth = {
    ...db.settings.auth,
    username: newUsername || db.settings.auth?.username || 'admin',
    password: newPassword || configuredPass
  };
  saveDb(db);
  res.json({ success: true, message: 'Login credentials updated successfully!' });
});

// -------------------------------------------------------------
// Protected Dashboard & Management APIs
// -------------------------------------------------------------

// 1. Dashboard Aggregates
app.get('/api/dashboard', requireAuth, (req, res) => {
  const db = getDb();
  const todayStr = getTodayString();
  const initialAmount = Number(db.budget?.initialAmount) || 0;
  const currency = db.budget?.currency || '₹';

  const expenses = db.expenses || [];
  const totalSpent = expenses.reduce((sum, exp) => sum + (Number(exp.amount) || 0), 0);
  const remainingBalance = initialAmount - totalSpent;

  const todayExpenses = expenses.filter(exp => exp.date === todayStr);
  const todaySpent = todayExpenses.reduce((sum, exp) => sum + (Number(exp.amount) || 0), 0);

  // Check if daily report was generated or if today has entries
  const reportForToday = (db.reports || []).find(r => r.date === todayStr);
  const isLoggedToday = todayExpenses.length > 0 || Boolean(reportForToday);

  // Category breakdown
  const categoryBreakdown = {};
  expenses.forEach(exp => {
    const cat = exp.category || 'Other';
    categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + (Number(exp.amount) || 0);
  });

  // Recent 10 expenses
  const recentExpenses = [...expenses].reverse().slice(0, 10);

  // Public settings (mask sensitive credentials)
  const safeSettings = {
    reminderEnabled: db.settings?.reminderEnabled ?? true,
    reminderTime: db.settings?.reminderTime || '20:30',
    recipientEmail: db.settings?.recipientEmail || '',
    recipientPhone: db.settings?.recipientPhone || '',
    notifyEmail: db.settings?.notifyEmail ?? true,
    notifySms: db.settings?.notifySms ?? true,
    notifyBrowser: db.settings?.notifyBrowser ?? true,
    hasSmtpConfigured: Boolean(db.settings?.smtp?.host && db.settings?.smtp?.user),
    hasTwilioConfigured: Boolean(db.settings?.twilio?.accountSid),
    lastReminderSentDate: db.settings?.lastReminderSentDate,
    recentReminders: (db.settings?.reminderHistory || []).slice(-5).reverse()
  };

  res.json({
    budget: db.budget,
    financials: {
      initialAmount,
      totalSpent,
      remainingBalance,
      todaySpent,
      currency,
      spentPercentage: initialAmount > 0 ? Math.min(100, Math.round((totalSpent / initialAmount) * 100)) : 0
    },
    todayStatus: {
      date: todayStr,
      isLogged: isLoggedToday,
      count: todayExpenses.length,
      todaySpent,
      reportGenerated: Boolean(reportForToday)
    },
    categoryBreakdown,
    recentExpenses,
    settings: safeSettings
  });
});

// 2. Budget Update
app.post('/api/budget', requireAuth, (req, res) => {
  const { initialAmount, currency, notes, month } = req.body;
  const db = getDb();
  db.budget = {
    ...db.budget,
    initialAmount: Number(initialAmount) || 0,
    currency: currency || db.budget?.currency || '₹',
    month: month || db.budget?.month || 'Current Period',
    notes: notes || db.budget?.notes || ''
  };
  saveDb(db);
  res.json({ success: true, budget: db.budget });
});

// 3. Expenses List & Creation (With Instant SMS on creation)
app.get('/api/expenses', requireAuth, (req, res) => {
  const db = getDb();
  let list = db.expenses || [];
  const { date, category } = req.query;
  if (date) list = list.filter(e => e.date === date);
  if (category) list = list.filter(e => e.category === category);
  res.json({ expenses: list.reverse() });
});

app.post('/api/expenses', requireAuth, async (req, res) => {
  const { amount, category, paymentMode, notes, date, time } = req.body;
  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ success: false, error: 'Valid expense amount is required.' });
  }

  const db = getDb();
  const todayStr = getTodayString();
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const expenseVal = Number(amount);
  const newExpense = {
    id: `exp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    amount: expenseVal,
    category: category || 'General',
    paymentMode: paymentMode || 'UPI',
    notes: notes || '',
    date: date || todayStr,
    time: time || currentTime,
    createdAt: new Date().toISOString()
  };

  db.expenses.push(newExpense);

  // Recalculate totals and available balance
  const initialAmount = Number(db.budget?.initialAmount) || 0;
  const totalSpent = db.expenses.reduce((sum, exp) => sum + (Number(exp.amount) || 0), 0);
  const remainingBalance = initialAmount - totalSpent;
  const currency = db.budget?.currency || '₹';

  // Instant SMS Notification to Reference Number
  const recipientPhone = db.settings?.recipientPhone || '+919876543210';
  const smsText = `YOUR EXPENSE OF TODAY IS LOCKED AND AVAILABLE BALANCE IS ${currency}${remainingBalance.toLocaleString()}`;

  let smsResult = { success: false };
  if (db.settings?.notifySms !== false && recipientPhone) {
    smsResult = await sendSmsNotification(recipientPhone, smsText, db.settings?.twilio);
    
    // Record SMS in history
    db.settings.reminderHistory = db.settings.reminderHistory || [];
    db.settings.reminderHistory.push({
      id: `sms_${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'EXPENSE_LOG_SMS',
      recipientPhone,
      messageText: smsText,
      smsResult
    });
  }

  saveDb(db);

  res.json({
    success: true,
    expense: newExpense,
    financials: {
      initialAmount,
      totalSpent,
      remainingBalance,
      currency
    },
    smsAlert: {
      sent: smsResult.success,
      recipient: recipientPhone,
      message: smsText,
      mode: smsResult.mode || 'simulated_sms'
    }
  });
});

app.delete('/api/expenses/:id', requireAuth, (req, res) => {
  const db = getDb();
  const initialLen = db.expenses.length;
  db.expenses = db.expenses.filter(e => e.id !== req.params.id);
  if (db.expenses.length === initialLen) {
    return res.status(404).json({ success: false, error: 'Expense not found' });
  }
  saveDb(db);
  res.json({ success: true });
});

// 4. Settings Update
app.get('/api/settings', requireAuth, (req, res) => {
  const db = getDb();
  const s = db.settings || {};
  res.json({
    reminderEnabled: s.reminderEnabled ?? true,
    reminderTime: s.reminderTime || '20:30',
    recipientEmail: s.recipientEmail || '',
    recipientPhone: s.recipientPhone || '',
    notifyEmail: s.notifyEmail ?? true,
    notifySms: s.notifySms ?? true,
    notifyBrowser: s.notifyBrowser ?? true,
    smtpHost: s.smtp?.host || '',
    smtpPort: s.smtp?.port || 587,
    smtpUser: s.smtp?.user || '',
    smtpSecure: s.smtp?.secure || false,
    smtpFrom: s.smtp?.from || '',
    twilioAccountSid: s.twilio?.accountSid || '',
    twilioFromPhone: s.twilio?.fromPhone || '',
    reminderHistory: (s.reminderHistory || []).slice(-10).reverse()
  });
});

app.post('/api/settings', requireAuth, (req, res) => {
  const db = getDb();
  const current = db.settings || {};
  const {
    reminderEnabled,
    reminderTime,
    recipientEmail,
    recipientPhone,
    notifyEmail,
    notifySms,
    notifyBrowser,
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPass,
    smtpSecure,
    smtpFrom,
    twilioAccountSid,
    twilioAuthToken,
    twilioFromPhone
  } = req.body;

  db.settings = {
    ...current,
    reminderEnabled: reminderEnabled !== undefined ? Boolean(reminderEnabled) : current.reminderEnabled,
    reminderTime: reminderTime || current.reminderTime || '20:30',
    recipientEmail: recipientEmail !== undefined ? recipientEmail : current.recipientEmail,
    recipientPhone: recipientPhone !== undefined ? recipientPhone : current.recipientPhone,
    notifyEmail: notifyEmail !== undefined ? Boolean(notifyEmail) : current.notifyEmail,
    notifySms: notifySms !== undefined ? Boolean(notifySms) : current.notifySms,
    notifyBrowser: notifyBrowser !== undefined ? Boolean(notifyBrowser) : current.notifyBrowser,
    smtp: {
      host: smtpHost !== undefined ? smtpHost : (current.smtp?.host || ''),
      port: smtpPort ? Number(smtpPort) : (current.smtp?.port || 587),
      secure: smtpSecure !== undefined ? Boolean(smtpSecure) : Boolean(current.smtp?.secure),
      user: smtpUser !== undefined ? smtpUser : (current.smtp?.user || ''),
      pass: smtpPass !== undefined && smtpPass !== '' ? smtpPass : (current.smtp?.pass || ''),
      from: smtpFrom || current.smtp?.from || 'Budget Tracker <no-reply@budgettracker.local>'
    },
    twilio: {
      accountSid: twilioAccountSid !== undefined ? twilioAccountSid : (current.twilio?.accountSid || ''),
      authToken: twilioAuthToken !== undefined && twilioAuthToken !== '' ? twilioAuthToken : (current.twilio?.authToken || ''),
      fromPhone: twilioFromPhone !== undefined ? twilioFromPhone : (current.twilio?.fromPhone || '')
    }
  };

  saveDb(db);
  res.json({ success: true, message: 'Settings saved successfully' });
});

// 5. Trigger Immediate Test Reminder
app.post('/api/notifications/test', requireAuth, async (req, res) => {
  const db = getDb();
  const currency = db.budget?.currency || '₹';
  const totalSpent = (db.expenses || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const remaining = (Number(db.budget?.initialAmount) || 0) - totalSpent;
  const todayStr = getTodayString();

  const recipientEmail = req.body.email || db.settings?.recipientEmail || 'user@example.com';
  const recipientPhone = req.body.phone || db.settings?.recipientPhone || '+919876543210';

  const subject = `⚠️ Daily Expense Alert: You haven't updated today's spending! (${todayStr})`;
  const textMsg = `Hi! You have not logged your spending for today (${todayStr}). Your remaining budget balance is ${currency}${remaining.toLocaleString()}. Please open your Expense Tracker app to update your daily expenses.`;

  const htmlMsg = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; background: #ffffff;">
      <div style="background: linear-gradient(135deg, #4f46e5, #7c3aed); padding: 24px; text-align: center; color: #ffffff;">
        <h1 style="margin: 0; font-size: 22px;">⏰ Daily Spending Reminder</h1>
        <p style="margin: 6px 0 0 0; opacity: 0.9; font-size: 14px;">Date: <strong>${todayStr}</strong></p>
      </div>
      <div style="padding: 24px; color: #334155; line-height: 1.6;">
        <p style="font-size: 16px;">Hello,</p>
        <p style="font-size: 15px;">
          Our system noticed that you <strong>have not updated your spending money</strong> or generated your daily report for today.
        </p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr>
              <td style="color: #64748b; padding: 4px 0;">Initial Budget:</td>
              <td style="text-align: right; font-weight: bold; color: #0f172a;">${currency}${(Number(db.budget?.initialAmount) || 0).toLocaleString()}</td>
            </tr>
            <tr>
              <td style="color: #64748b; padding: 4px 0;">Total Spent so far:</td>
              <td style="text-align: right; font-weight: bold; color: #ef4444;">${currency}${totalSpent.toLocaleString()}</td>
            </tr>
            <tr>
              <td style="color: #64748b; padding: 4px 0;">Remaining Balance:</td>
              <td style="text-align: right; font-weight: bold; color: ${remaining >= 0 ? '#10b981' : '#dc2626'};">${currency}${remaining.toLocaleString()}</td>
            </tr>
          </table>
        </div>
        <p style="font-size: 14px; color: #475569;">
          Keeping track of your daily expenses ensures you stay within your budget limit.
        </p>
        <div style="text-align: center; margin: 30px 0 10px;">
          <a href="http://localhost:${PORT}" style="display: inline-block; background: #4f46e5; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: bold; font-size: 15px;">Update Spending Now</a>
        </div>
      </div>
      <div style="background: #f1f5f9; padding: 12px 24px; text-align: center; font-size: 12px; color: #64748b;">
        Daily Budget & Expense Reminder Engine • Automated notification
      </div>
    </div>
  `;

  const emailResult = await sendEmailReminder(recipientEmail, subject, textMsg, htmlMsg, db.settings?.smtp);
  const smsResult = await sendSmsNotification(recipientPhone, textMsg, db.settings?.twilio);

  // Log in reminder history
  const historyEntry = {
    id: `rem_${Date.now()}`,
    timestamp: new Date().toISOString(),
    type: 'MANUAL_TEST',
    emailResult,
    smsResult,
    recipientEmail,
    recipientPhone
  };
  db.settings.reminderHistory = db.settings.reminderHistory || [];
  db.settings.reminderHistory.push(historyEntry);
  saveDb(db);

  res.json({
    success: true,
    message: 'Test reminder dispatched successfully!',
    email: emailResult,
    sms: smsResult
  });
});

// 6. Generate Daily Report
app.post('/api/reports/generate', requireAuth, async (req, res) => {
  const db = getDb();
  const todayStr = getTodayString();
  const currency = db.budget?.currency || '₹';

  const todayExpenses = (db.expenses || []).filter(e => e.date === todayStr);
  const todayTotal = todayExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const totalSpent = (db.expenses || []).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const remaining = (Number(db.budget?.initialAmount) || 0) - totalSpent;

  const report = {
    id: `rep_${Date.now()}`,
    date: todayStr,
    generatedAt: new Date().toISOString(),
    itemCount: todayExpenses.length,
    todaySpent: todayTotal,
    totalSpentToDate: totalSpent,
    remainingBalance: remaining,
    items: todayExpenses
  };

  db.reports = db.reports || [];
  // Remove older report for today if regenerating
  db.reports = db.reports.filter(r => r.date !== todayStr);
  db.reports.push(report);
  saveDb(db);

  // If email report is requested
  if (req.body.emailReport && db.settings?.recipientEmail) {
    const subject = `📊 Daily Expense Report for ${todayStr}`;
    const htmlReport = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px;">
        <h2 style="color: #4f46e5; margin-top: 0;">Daily Expense Summary (${todayStr})</h2>
        <p><strong>Today's Total Spend:</strong> ${currency}${todayTotal.toLocaleString()}</p>
        <p><strong>Transactions Today:</strong> ${todayExpenses.length}</p>
        <p><strong>Remaining Budget:</strong> ${currency}${remaining.toLocaleString()}</p>
        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 16px 0;" />
        <h3>Today's Itemized Expenses:</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <thead>
            <tr style="background: #f8fafc; text-align: left;">
              <th style="padding: 8px; border-bottom: 1px solid #e2e8f0;">Category</th>
              <th style="padding: 8px; border-bottom: 1px solid #e2e8f0;">Notes</th>
              <th style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${todayExpenses.length === 0 ? '<tr><td colspan="3" style="padding: 8px; text-align: center; color: #94a3b8;">No expenses recorded today.</td></tr>' : 
              todayExpenses.map(item => `
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #f1f5f9;">${item.category} (${item.paymentMode})</td>
                  <td style="padding: 8px; border-bottom: 1px solid #f1f5f9; color: #64748b;">${item.notes || '-'}</td>
                  <td style="padding: 8px; border-bottom: 1px solid #f1f5f9; text-align: right; font-weight: bold;">${currency}${Number(item.amount).toLocaleString()}</td>
                </tr>
              `).join('')}
          </tbody>
        </table>
      </div>
    `;
    await sendEmailReminder(db.settings.recipientEmail, subject, `Daily report for ${todayStr}: ${currency}${todayTotal}`, htmlReport, db.settings?.smtp);
  }

  res.json({ success: true, report });
});

// 7. CSV Export
app.get('/api/reports/export-csv', requireAuth, (req, res) => {
  const db = getDb();
  const expenses = db.expenses || [];
  let csv = 'ID,Date,Time,Category,Payment Mode,Amount,Notes,Created At\n';
  expenses.forEach(e => {
    const cleanNotes = (e.notes || '').replace(/"/g, '""');
    csv += `"${e.id}","${e.date}","${e.time}","${e.category}","${e.paymentMode}",${e.amount},"${cleanNotes}","${e.createdAt}"\n`;
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=expenses-${getTodayString()}.csv`);
  res.send(csv);
});

// Background Cron Scheduler (Runs every minute to check reminder hour)
cron.schedule('* * * * *', async () => {
  try {
    const db = getDb();
    if (!db.settings?.reminderEnabled) return;

    const now = new Date();
    const currentHour = String(now.getHours()).padStart(2, '0');
    const currentMinute = String(now.getMinutes()).padStart(2, '0');
    const currentTimeStr = `${currentHour}:${currentMinute}`;

    const configuredTime = db.settings.reminderTime || '20:30';
    const todayStr = getTodayString();

    // Trigger only if current time matches configured reminder time and hasn't triggered today
    if (currentTimeStr === configuredTime && db.settings.lastReminderSentDate !== todayStr) {
      const todayExpenses = (db.expenses || []).filter(e => e.date === todayStr);
      const todayReport = (db.reports || []).find(r => r.date === todayStr);

      // Condition: No expense logged AND no report generated for today
      if (todayExpenses.length === 0 && !todayReport) {
        console.log(`\n🔔 [Cron Alert] User has not updated spending for ${todayStr}. Firing reminder notifications...`);

        const currency = db.budget?.currency || '₹';
        const totalSpent = (db.expenses || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
        const remaining = (Number(db.budget?.initialAmount) || 0) - totalSpent;

        const subject = `⏰ Daily Reminder: Log your spending for today (${todayStr})`;
        const textMsg = `Friendly reminder: You have not updated your daily spending or closed today's report (${todayStr}). Remaining budget: ${currency}${remaining.toLocaleString()}. Open your app to log today's expenses.`;

        const htmlMsg = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #cbd5e1; border-radius: 12px; overflow: hidden;">
            <div style="background: #e11d48; color: white; padding: 20px; text-align: center;">
              <h2 style="margin: 0;">⏰ Daily Spending Reminder</h2>
              <p style="margin: 4px 0 0; font-size: 14px;">Today: ${todayStr}</p>
            </div>
            <div style="padding: 24px;">
              <p>Hello,</p>
              <p>You haven't logged any expenses or generated your daily spending report today.</p>
              <p><strong>Remaining Budget:</strong> ${currency}${remaining.toLocaleString()}</p>
              <p>Keep your budget accurate by taking 30 seconds to record any purchases.</p>
              <div style="margin: 24px 0; text-align: center;">
                <a href="http://localhost:${PORT}" style="background: #e11d48; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Log Today's Spending</a>
              </div>
            </div>
          </div>
        `;

        let emailRes = null;
        let smsRes = null;

        if (db.settings.notifyEmail && db.settings.recipientEmail) {
          emailRes = await sendEmailReminder(db.settings.recipientEmail, subject, textMsg, htmlMsg, db.settings.smtp);
        }

        if (db.settings.notifySms && db.settings.recipientPhone) {
          smsRes = await sendSmsNotification(db.settings.recipientPhone, textMsg, db.settings.twilio);
        }

        // Record reminder in DB
        db.settings.lastReminderSentDate = todayStr;
        db.settings.reminderHistory = db.settings.reminderHistory || [];
        db.settings.reminderHistory.push({
          id: `cron_${Date.now()}`,
          timestamp: new Date().toISOString(),
          type: 'CRON_AUTOMATIC',
          emailResult: emailRes,
          smsResult: smsRes
        });
        saveDb(db);
        console.log(`✅ [Cron Alert] Reminder sent successfully for ${todayStr}.`);
      }
    }
  } catch (err) {
    console.error('Error in cron task:', err);
  }
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`💰 SpendWise - Daily Budget & Expense Tracker Server`);
  console.log(`🌐 Dashboard URL: http://localhost:${PORT}`);
  console.log(`🔒 Authentication: Enabled (Default user: admin / pass: 1234)`);
  console.log(`📱 Instant SMS on Expense: Enabled`);
  console.log(`⏰ Daily Reminder Scheduler: Active`);
  console.log(`======================================================\n`);
});
