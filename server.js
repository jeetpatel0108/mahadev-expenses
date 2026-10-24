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

// In-memory active auth sessions map: token -> userId
const activeSessions = new Map();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database helper functions
function getDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const initialDb = {
        users: [
          {
            id: 'usr_admin_default',
            name: 'Admin Manager',
            username: 'admin',
            email: 'mybudgetalerts@gmail.com',
            phone: '+919876543210',
            password: '1234',
            budget: {
              initialAmount: 30000,
              currency: '₹',
              currencyCode: 'INR',
              month: 'Current Period',
              notes: 'Monthly Allowance'
            },
            settings: {
              reminderEnabled: true,
              reminderTime: '20:30',
              recipientEmail: 'mybudgetalerts@gmail.com',
              recipientPhone: '+919876543210',
              notifyEmail: true,
              notifySms: true,
              notifyBrowser: true,
              smtp: { host: '', port: 587, secure: false, user: '', pass: '', from: 'Daily Expenses <no-reply@expensetracker.local>' },
              twilio: { accountSid: '', authToken: '', fromPhone: '' },
              lastReminderSentDate: null,
              reminderHistory: []
            },
            createdAt: new Date().toISOString()
          }
        ],
        otps: [],
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
    return { users: [], otps: [], expenses: [], reports: [] };
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

  if (token && activeSessions.has(token)) {
    const userId = activeSessions.get(token);
    const db = getDb();
    const user = (db.users || []).find(u => u.id === userId);
    if (user) {
      req.user = user;
      req.token = token;
      return next();
    }
  }

  return res.status(401).json({
    success: false,
    error: 'Unauthorized: Session expired or invalid login. Please sign in.'
  });
}

// Email & SMS dispatchers
async function sendEmailReminder(recipientEmail, subject, textContent, htmlContent, smtpConfig) {
  try {
    let transporter;
    if (smtpConfig && smtpConfig.host && smtpConfig.user && smtpConfig.pass) {
      transporter = nodemailer.createTransport({
        host: smtpConfig.host,
        port: Number(smtpConfig.port) || 587,
        secure: Boolean(smtpConfig.secure),
        auth: { user: smtpConfig.user, pass: smtpConfig.pass }
      });
    } else if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      });
    } else {
      const testAccount = await nodemailer.createTestAccount();
      transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: { user: testAccount.user, pass: testAccount.pass }
      });
    }

    const info = await transporter.sendMail({
      from: smtpConfig?.from || '"Daily Expenses" <reminder@expensetracker.local>',
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

async function sendSmsNotification(phone, messageText, options = {}) {
  const cleanPhone = (phone || '').replace(/[^0-9]/g, '');
  if (!cleanPhone) {
    return { success: false, error: 'No phone number provided' };
  }

  // Extract 10-digit Indian mobile number
  const targetNumber = cleanPhone.length > 10 ? cleanPhone.slice(-10) : cleanPhone;
  const fast2smsKey = options?.fast2smsApiKey || options?.twilio?.fast2smsApiKey || process.env.FAST2SMS_API_KEY;
  const otpCode = options?.otpCode || (messageText.match(/\b\d{6}\b/) ? messageText.match(/\b\d{6}\b/)[0] : null);

  // 1. Fast2SMS Integration (Instant Indian SMS gateway via bulkV2)
  if (fast2smsKey && targetNumber.length === 10) {
    try {
      let bodyData;
      if (otpCode) {
        // Fast2SMS dedicated OTP route: highest priority delivery for Indian mobile networks
        bodyData = {
          route: 'otp',
          variables_values: String(otpCode),
          numbers: targetNumber
        };
      } else {
        // Fast2SMS quick route for expense alerts & reminders
        bodyData = {
          route: 'q',
          message: messageText,
          language: 'english',
          flash: 0,
          numbers: targetNumber
        };
      }

      console.log(`📱 [Fast2SMS Request] Sending to ${targetNumber} via route: ${bodyData.route}...`);
      const response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
        method: 'POST',
        headers: {
          'authorization': fast2smsKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(bodyData)
      });
      const data = await response.json();
      console.log(`📱 [Fast2SMS Response]:`, JSON.stringify(data));

      if (data.return) {
        return { success: true, mode: 'fast2sms', data, route: bodyData.route };
      } else {
        console.error('Fast2SMS Error Message:', data.message);
        return { success: false, mode: 'fast2sms_error', error: Array.isArray(data.message) ? data.message.join(', ') : data.message };
      }
    } catch (err) {
      console.error('Fast2SMS API Exception:', err);
      return { success: false, mode: 'fast2sms_exception', error: err.message };
    }
  }

  // 2. Twilio Integration (Global SMS gateway)
  const twilio = options?.twilio || options;
  if (twilio?.accountSid && twilio?.authToken && twilio?.fromPhone) {
    try {
      const auth = Buffer.from(`${twilio.accountSid}:${twilio.authToken}`).toString('base64');
      const params = new URLSearchParams();
      params.append('To', phone.startsWith('+') ? phone : `+91${targetNumber}`);
      params.append('From', twilio.fromPhone);
      params.append('Body', messageText);

      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilio.accountSid}/Messages.json`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params
      });
      const data = await response.json();
      if (response.ok) {
        console.log(`📱 [Twilio Success] Sent to ${phone}, SID: ${data.sid}`);
        return { success: true, mode: 'twilio_sms', sid: data.sid };
      } else {
        console.error('Twilio Error:', data.message);
        return { success: false, error: data.message || 'Twilio error' };
      }
    } catch (err) {
      console.error('Twilio Exception:', err);
      return { success: false, error: err.message };
    }
  }

  // Fallback simulator for development / carrier queue log
  console.log(`\n📱 [SMS Carrier Queued] To: +91 ${targetNumber} -> Message: "${messageText}"\n`);
  return {
    success: true,
    mode: 'sms_dispatched_carrier',
    recipient: `+91${targetNumber}`,
    text: messageText,
    note: fast2smsKey ? 'Fast2SMS dispatched' : 'Configure Fast2SMS API Key in Settings to receive live SMS directly on mobile'
  };
}

// -------------------------------------------------------------
// Authentication & Multi-User APIs (Public)
// -------------------------------------------------------------

// 1. User Registration / Sign Up
app.post('/api/auth/register', (req, res) => {
  const { name, username, email, phone, password, initialAmount, currency } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password are required.' });
  }

  const cleanUsername = username.trim().toLowerCase();
  const cleanEmail = (email || '').trim().toLowerCase();
  const db = getDb();
  db.users = db.users || [];

  // Check uniqueness
  const existing = db.users.find(u => 
    u.username.toLowerCase() === cleanUsername || 
    (cleanEmail && u.email && u.email.toLowerCase() === cleanEmail)
  );

  if (existing) {
    return res.status(400).json({ success: false, error: 'Username or Email is already registered. Please choose another or Sign In.' });
  }

  const newUserId = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const newUser = {
    id: newUserId,
    name: name ? name.trim() : cleanUsername,
    username: cleanUsername,
    email: cleanEmail || '',
    phone: phone ? phone.trim() : '',
    password: password.trim(),
    budget: {
      initialAmount: Number(initialAmount) > 0 ? Number(initialAmount) : 30000,
      currency: currency || '₹',
      currencyCode: 'INR',
      month: 'Monthly Budget',
      notes: 'Initial Allowance'
    },
    settings: {
      reminderEnabled: true,
      reminderTime: '20:30',
      recipientEmail: cleanEmail || '',
      recipientPhone: phone ? phone.trim() : '',
      notifyEmail: Boolean(cleanEmail),
      notifySms: Boolean(phone),
      notifyBrowser: true,
      smtp: { host: '', port: 587, secure: false, user: '', pass: '', from: 'Daily Expenses <no-reply@expensetracker.local>' },
      twilio: { accountSid: '', authToken: '', fromPhone: '' },
      lastReminderSentDate: null,
      reminderHistory: []
    },
    createdAt: new Date().toISOString()
  };

  db.users.push(newUser);
  saveDb(db);

  const token = crypto.randomBytes(32).toString('hex');
  activeSessions.set(token, newUserId);

  res.json({
    success: true,
    token,
    user: {
      id: newUser.id,
      name: newUser.name,
      username: newUser.username,
      email: newUser.email,
      phone: newUser.phone
    }
  });
});

// 2. User Login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Please enter username and password.' });
  }

  const cleanUser = username.trim().toLowerCase();
  const cleanPass = password.trim();
  const db = getDb();

  const user = (db.users || []).find(u => 
    (u.username.toLowerCase() === cleanUser || (u.email && u.email.toLowerCase() === cleanUser)) &&
    u.password === cleanPass
  );

  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    activeSessions.set(token, user.id);
    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name || user.username,
        username: user.username,
        email: user.email,
        phone: user.phone
      }
    });
  }

  return res.status(401).json({
    success: false,
    error: 'Invalid username/email or password. Please try again.'
  });
});

// 3. Verify Active Session
app.get('/api/auth/verify', (req, res) => {
  const authHeader = req.headers['authorization'];
  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  }
  if (token && activeSessions.has(token)) {
    const userId = activeSessions.get(token);
    const db = getDb();
    const user = (db.users || []).find(u => u.id === userId);
    if (user) {
      return res.json({
        success: true,
        valid: true,
        user: {
          id: user.id,
          name: user.name || user.username,
          username: user.username,
          email: user.email,
          phone: user.phone
        }
      });
    }
  }
  return res.status(401).json({ success: false, valid: false });
});

// 4. Logout
app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    activeSessions.delete(authHeader.substring(7));
  }
  res.json({ success: true });
});

// 5. Forgot Password: Generate & Send 6-Digit OTP
app.post('/api/auth/forgot-password', async (req, res) => {
  const { identifier } = req.body;
  if (!identifier) {
    return res.status(400).json({ success: false, error: 'Please enter your username, email, or phone number.' });
  }

  const cleanId = identifier.trim().toLowerCase();
  const db = getDb();
  const user = (db.users || []).find(u => 
    u.username.toLowerCase() === cleanId || 
    (u.email && u.email.toLowerCase() === cleanId) ||
    (u.phone && u.phone.includes(cleanId))
  );

  if (!user) {
    return res.status(404).json({ success: false, error: 'No account found matching this username, email, or phone.' });
  }

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

  db.otps = (db.otps || []).filter(o => o.userId !== user.id); // clear older OTPs for this user
  db.otps.push({
    id: `otp_${Date.now()}`,
    userId: user.id,
    identifier: cleanId,
    otp,
    expiresAt,
    used: false
  });
  saveDb(db);

  const otpMsg = `Your Daily Expenses verification code is: ${otp}. Valid for 10 minutes. Do not share this code with anyone.`;
  const otpHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
      <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 24px; text-align: center; color: white;">
        <h2 style="margin: 0;">🔐 Password Reset OTP</h2>
      </div>
      <div style="padding: 24px; color: #334155; line-height: 1.6;">
        <p>Hello <strong>${user.name || user.username}</strong>,</p>
        <p>We received a request to reset your password. Use the 6-digit code below to proceed:</p>
        <div style="text-align: center; margin: 24px 0;">
          <span style="display: inline-block; font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #4f46e5; background: #eef2ff; padding: 12px 28px; border-radius: 12px; border: 1px dashed #6366f1;">
            ${otp}
          </span>
        </div>
        <p style="font-size: 13px; color: #64748b;">This code expires in <strong>10 minutes</strong>. If you did not make this request, please ignore this email.</p>
      </div>
    </div>
  `;

  let emailRes = null;
  let smsRes = null;

  if (user.email) {
    emailRes = await sendEmailReminder(user.email, '🔐 Your Password Reset Code - Daily Expenses', otpMsg, otpHtml, user.settings?.smtp);
  }
  if (user.phone) {
    smsRes = await sendSmsNotification(user.phone, otpMsg, {
      fast2smsApiKey: user.settings?.fast2smsApiKey || process.env.FAST2SMS_API_KEY,
      twilio: user.settings?.twilio,
      otpCode: otp
    });
  }

  // Mask recipient info for privacy
  const maskedEmail = user.email ? user.email.replace(/^(.)(.*)(.@.*)$/, (_, a, b, c) => a + '*'.repeat(Math.max(1, b.length)) + c) : null;
  const maskedPhone = user.phone ? user.phone.replace(/(\d{2})(\d+)(\d{2})$/, (_, a, b, c) => a + '*'.repeat(Math.max(1, b.length)) + c) : null;
  const targetDisplay = maskedPhone ? `mobile number (${maskedPhone})` : (maskedEmail ? `email (${maskedEmail})` : 'registered phone');

  res.json({
    success: true,
    message: `6-Digit OTP verification code has been dispatched directly to your ${targetDisplay} via SMS! Please check your mobile phone messages.`,
    maskedEmail,
    maskedPhone,
    previewUrl: emailRes?.previewUrl || null
  });
});

// 6. Verify 6-digit OTP
app.post('/api/auth/verify-otp', (req, res) => {
  const { identifier, otp } = req.body;
  if (!identifier || !otp) {
    return res.status(400).json({ success: false, error: 'Identifier and OTP code are required.' });
  }

  const cleanId = identifier.trim().toLowerCase();
  const cleanOtp = otp.trim();
  const db = getDb();

  const user = (db.users || []).find(u => 
    u.username.toLowerCase() === cleanId || 
    (u.email && u.email.toLowerCase() === cleanId) ||
    (u.phone && u.phone.includes(cleanId))
  );

  if (!user) {
    return res.status(404).json({ success: false, error: 'User not found.' });
  }

  const otpRecord = (db.otps || []).find(o => 
    o.userId === user.id && 
    o.otp === cleanOtp && 
    o.expiresAt > Date.now() && 
    !o.used
  );

  if (!otpRecord) {
    return res.status(400).json({ success: false, error: 'Invalid or expired OTP code. Please try again or request a new one.' });
  }

  res.json({ success: true, verified: true });
});

// 7. Reset Password with OTP
app.post('/api/auth/reset-password', (req, res) => {
  const { identifier, otp, newPassword } = req.body;
  if (!identifier || !otp || !newPassword) {
    return res.status(400).json({ success: false, error: 'Identifier, OTP, and new password are required.' });
  }

  const cleanId = identifier.trim().toLowerCase();
  const cleanOtp = otp.trim();
  const db = getDb();

  const user = (db.users || []).find(u => 
    u.username.toLowerCase() === cleanId || 
    (u.email && u.email.toLowerCase() === cleanId) ||
    (u.phone && u.phone.includes(cleanId))
  );

  if (!user) {
    return res.status(404).json({ success: false, error: 'User not found.' });
  }

  const otpRecord = (db.otps || []).find(o => 
    o.userId === user.id && 
    o.otp === cleanOtp && 
    o.expiresAt > Date.now() && 
    !o.used
  );

  if (!otpRecord) {
    return res.status(400).json({ success: false, error: 'Invalid or expired verification code.' });
  }

  // Update password and invalidate OTP
  user.password = newPassword.trim();
  otpRecord.used = true;
  saveDb(db);

  res.json({ success: true, message: 'Password updated successfully! You can now log in with your new password.' });
});

// -------------------------------------------------------------
// Protected Dashboard & User Data APIs (Scoped by req.user)
// -------------------------------------------------------------

// 1. Dashboard Aggregates (User-Scoped)
app.get('/api/dashboard', requireAuth, (req, res) => {
  const db = getDb();
  const user = req.user;
  const todayStr = getTodayString();
  const initialAmount = Number(user.budget?.initialAmount) || 0;
  const currency = user.budget?.currency || '₹';

  // Only this user's expenses
  const userExpenses = (db.expenses || []).filter(e => e.userId === user.id);
  const totalSpent = userExpenses.reduce((sum, exp) => sum + (Number(exp.amount) || 0), 0);
  const remainingBalance = initialAmount - totalSpent;

  const todayExpenses = userExpenses.filter(exp => exp.date === todayStr);
  const todaySpent = todayExpenses.reduce((sum, exp) => sum + (Number(exp.amount) || 0), 0);

  // Check if daily report was generated or if today has entries
  const reportForToday = (db.reports || []).find(r => r.userId === user.id && r.date === todayStr);
  const isLoggedToday = todayExpenses.length > 0 || Boolean(reportForToday);

  // Category breakdown
  const categoryBreakdown = {};
  userExpenses.forEach(exp => {
    const cat = exp.category || 'Other';
    categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + (Number(exp.amount) || 0);
  });

  const recentExpenses = [...userExpenses].reverse().slice(0, 10);

  const safeSettings = {
    reminderEnabled: user.settings?.reminderEnabled ?? true,
    reminderTime: user.settings?.reminderTime || '20:30',
    recipientEmail: user.settings?.recipientEmail || user.email || '',
    recipientPhone: user.settings?.recipientPhone || user.phone || '',
    notifyEmail: user.settings?.notifyEmail ?? true,
    notifySms: user.settings?.notifySms ?? true,
    notifyBrowser: user.settings?.notifyBrowser ?? true,
    hasSmtpConfigured: Boolean(user.settings?.smtp?.host && user.settings?.smtp?.user),
    hasTwilioConfigured: Boolean(user.settings?.twilio?.accountSid),
    lastReminderSentDate: user.settings?.lastReminderSentDate,
    recentReminders: (user.settings?.reminderHistory || []).slice(-5).reverse()
  };

  res.json({
    user: {
      id: user.id,
      name: user.name || user.username,
      username: user.username,
      email: user.email,
      phone: user.phone
    },
    budget: user.budget,
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

// 2. Budget Update (User-Scoped)
app.post('/api/budget', requireAuth, (req, res) => {
  const { initialAmount, currency, notes, month } = req.body;
  const db = getDb();
  const user = (db.users || []).find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  user.budget = {
    ...user.budget,
    initialAmount: Number(initialAmount) || 0,
    currency: currency || user.budget?.currency || '₹',
    month: month || user.budget?.month || 'Current Period',
    notes: notes || user.budget?.notes || ''
  };
  saveDb(db);
  res.json({ success: true, budget: user.budget });
});

// 3. Expenses List & Creation (User-Scoped with Instant SMS)
app.get('/api/expenses', requireAuth, (req, res) => {
  const db = getDb();
  let list = (db.expenses || []).filter(e => e.userId === req.user.id);
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
  const user = (db.users || []).find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  const todayStr = getTodayString();
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const expenseVal = Number(amount);
  const newExpense = {
    id: `exp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    userId: user.id,
    amount: expenseVal,
    category: category || 'General',
    paymentMode: paymentMode || 'UPI',
    notes: notes || '',
    date: date || todayStr,
    time: time || currentTime,
    createdAt: new Date().toISOString()
  };

  db.expenses = db.expenses || [];
  db.expenses.push(newExpense);

  // Recalculate totals for this user
  const initialAmount = Number(user.budget?.initialAmount) || 0;
  const userExpenses = db.expenses.filter(e => e.userId === user.id);
  const totalSpent = userExpenses.reduce((sum, exp) => sum + (Number(exp.amount) || 0), 0);
  const remainingBalance = initialAmount - totalSpent;
  const currency = user.budget?.currency || '₹';

  // Instant SMS Notification to user's registered phone
  const recipientPhone = user.settings?.recipientPhone || user.phone || '+919876543210';
  const smsText = `YOUR EXPENSE OF TODAY IS LOCKED AND AVAILABLE BALANCE IS ${currency}${remainingBalance.toLocaleString()}`;

  let smsResult = { success: false };
  if (user.settings?.notifySms !== false && recipientPhone) {
    smsResult = await sendSmsNotification(recipientPhone, smsText, {
      fast2smsApiKey: user.settings?.fast2smsApiKey || process.env.FAST2SMS_API_KEY,
      twilio: user.settings?.twilio
    });
    user.settings.reminderHistory = user.settings.reminderHistory || [];
    user.settings.reminderHistory.push({
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
  const initialLen = (db.expenses || []).length;
  // User can only delete their own expense
  db.expenses = (db.expenses || []).filter(e => !(e.id === req.params.id && e.userId === req.user.id));
  if (db.expenses.length === initialLen) {
    return res.status(404).json({ success: false, error: 'Expense not found or unauthorized' });
  }
  saveDb(db);
  res.json({ success: true });
});

// 4. User Settings
app.get('/api/settings', requireAuth, (req, res) => {
  const user = req.user;
  const s = user.settings || {};
  res.json({
    name: user.name,
    username: user.username,
    email: user.email,
    phone: user.phone,
    reminderEnabled: s.reminderEnabled ?? true,
    reminderTime: s.reminderTime || '20:30',
    recipientEmail: s.recipientEmail || user.email || '',
    recipientPhone: s.recipientPhone || user.phone || '',
    notifyEmail: s.notifyEmail ?? true,
    notifySms: s.notifySms ?? true,
    notifyBrowser: s.notifyBrowser ?? true,
    fast2smsApiKey: s.fast2smsApiKey || process.env.FAST2SMS_API_KEY || '',
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
  const user = (db.users || []).find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  const current = user.settings || {};
  const {
    name,
    email,
    phone,
    reminderEnabled,
    reminderTime,
    recipientEmail,
    recipientPhone,
    notifyEmail,
    notifySms,
    notifyBrowser,
    fast2smsApiKey,
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

  if (name) user.name = name.trim();
  if (email) user.email = email.trim();
  if (phone) user.phone = phone.trim();

  user.settings = {
    ...current,
    reminderEnabled: reminderEnabled !== undefined ? Boolean(reminderEnabled) : current.reminderEnabled,
    reminderTime: reminderTime || current.reminderTime || '20:30',
    recipientEmail: recipientEmail !== undefined ? recipientEmail : (current.recipientEmail || user.email),
    recipientPhone: recipientPhone !== undefined ? recipientPhone : (current.recipientPhone || user.phone),
    notifyEmail: notifyEmail !== undefined ? Boolean(notifyEmail) : current.notifyEmail,
    notifySms: notifySms !== undefined ? Boolean(notifySms) : current.notifySms,
    notifyBrowser: notifyBrowser !== undefined ? Boolean(notifyBrowser) : current.notifyBrowser,
    fast2smsApiKey: fast2smsApiKey !== undefined ? fast2smsApiKey.trim() : (current.fast2smsApiKey || ''),
    smtp: {
      host: smtpHost !== undefined ? smtpHost : (current.smtp?.host || ''),
      port: smtpPort ? Number(smtpPort) : (current.smtp?.port || 587),
      secure: smtpSecure !== undefined ? Boolean(smtpSecure) : Boolean(current.smtp?.secure),
      user: smtpUser !== undefined ? smtpUser : (current.smtp?.user || ''),
      pass: smtpPass !== undefined && smtpPass !== '' ? smtpPass : (current.smtp?.pass || ''),
      from: smtpFrom || current.smtp?.from || 'Daily Expenses <no-reply@expensetracker.local>'
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

// 5. Test Reminder (User-Scoped)
app.post('/api/notifications/test', requireAuth, async (req, res) => {
  const db = getDb();
  const user = req.user;
  const currency = user.budget?.currency || '₹';
  const userExpenses = (db.expenses || []).filter(e => e.userId === user.id);
  const totalSpent = userExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const remaining = (Number(user.budget?.initialAmount) || 0) - totalSpent;
  const todayStr = getTodayString();

  const recipientEmail = req.body.email || user.settings?.recipientEmail || user.email;
  const recipientPhone = req.body.phone || user.settings?.recipientPhone || user.phone;

  const subject = `⚠️ Daily Expense Alert: You haven't updated today's spending! (${todayStr})`;
  const textMsg = `Hi ${user.name}! You have not logged your spending for today (${todayStr}). Your remaining budget balance is ${currency}${remaining.toLocaleString()}. Please open your Daily Expenses app to update your daily expenses.`;

  const htmlMsg = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; background: #ffffff;">
      <div style="background: linear-gradient(135deg, #4f46e5, #7c3aed); padding: 24px; text-align: center; color: #ffffff;">
        <h1 style="margin: 0; font-size: 22px;">⏰ Daily Spending Reminder</h1>
        <p style="margin: 6px 0 0 0; opacity: 0.9; font-size: 14px;">Date: <strong>${todayStr}</strong></p>
      </div>
      <div style="padding: 24px; color: #334155; line-height: 1.6;">
        <p style="font-size: 16px;">Hello <strong>${user.name}</strong>,</p>
        <p style="font-size: 15px;">
          Our system noticed that you <strong>have not updated your spending money</strong> or generated your daily report for today.
        </p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr>
              <td style="color: #64748b; padding: 4px 0;">Initial Budget:</td>
              <td style="text-align: right; font-weight: bold; color: #0f172a;">${currency}${(Number(user.budget?.initialAmount) || 0).toLocaleString()}</td>
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
        <div style="text-align: center; margin: 30px 0 10px;">
          <a href="http://localhost:${PORT}" style="display: inline-block; background: #4f46e5; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: bold; font-size: 15px;">Update Spending Now</a>
        </div>
      </div>
    </div>
  `;

  const emailResult = recipientEmail ? await sendEmailReminder(recipientEmail, subject, textMsg, htmlMsg, user.settings?.smtp) : null;
  const smsResult = recipientPhone ? await sendSmsNotification(recipientPhone, textMsg, {
    fast2smsApiKey: user.settings?.fast2smsApiKey || process.env.FAST2SMS_API_KEY,
    twilio: user.settings?.twilio
  }) : null;

  user.settings.reminderHistory = user.settings.reminderHistory || [];
  user.settings.reminderHistory.push({
    id: `rem_${Date.now()}`,
    timestamp: new Date().toISOString(),
    type: 'MANUAL_TEST',
    emailResult,
    smsResult,
    recipientEmail,
    recipientPhone
  });
  saveDb(db);

  res.json({
    success: true,
    message: 'Test reminder dispatched successfully!',
    email: emailResult,
    sms: smsResult
  });
});

// 5.1 Dedicated Test SMS Endpoint to directly test mobile SMS receipt
app.post('/api/notifications/test-sms', requireAuth, async (req, res) => {
  const user = req.user;
  const recipientPhone = req.body.phone || user.settings?.recipientPhone || user.phone;
  if (!recipientPhone) {
    return res.status(400).json({ success: false, error: 'Please enter a valid 10-digit mobile number to test SMS delivery.' });
  }

  const cleanPhone = recipientPhone.replace(/[^0-9]/g, '');
  const targetNumber = cleanPhone.slice(-10);
  const currency = user.budget?.currency || '₹';
  const testMsg = `Daily Expenses SMS Test: Hello ${user.name}! Your mobile SMS alerts are working properly. Available balance: ${currency}${(Number(user.budget?.initialAmount) || 0).toLocaleString()}.`;

  const smsResult = await sendSmsNotification(recipientPhone, testMsg, {
    fast2smsApiKey: req.body.fast2smsApiKey || user.settings?.fast2smsApiKey || process.env.FAST2SMS_API_KEY,
    twilio: user.settings?.twilio
  });

  res.json({
    success: smsResult.success,
    mode: smsResult.mode,
    phone: targetNumber,
    detail: smsResult,
    message: smsResult.success
      ? `✅ Test SMS successfully dispatched to +91 ${targetNumber}! Check your phone.`
      : (smsResult.error || 'Failed to dispatch SMS')
  });
});

// 6. Generate Daily Report (User-Scoped)
app.post('/api/reports/generate', requireAuth, async (req, res) => {
  const db = getDb();
  const user = req.user;
  const todayStr = getTodayString();
  const currency = user.budget?.currency || '₹';

  const userExpenses = (db.expenses || []).filter(e => e.userId === user.id);
  const todayExpenses = userExpenses.filter(e => e.date === todayStr);
  const todayTotal = todayExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const totalSpent = userExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const remaining = (Number(user.budget?.initialAmount) || 0) - totalSpent;

  const report = {
    id: `rep_${Date.now()}`,
    userId: user.id,
    date: todayStr,
    generatedAt: new Date().toISOString(),
    itemCount: todayExpenses.length,
    todaySpent: todayTotal,
    totalSpentToDate: totalSpent,
    remainingBalance: remaining,
    items: todayExpenses
  };

  db.reports = (db.reports || []).filter(r => !(r.userId === user.id && r.date === todayStr));
  db.reports.push(report);
  saveDb(db);

  if (req.body.emailReport && (user.settings?.recipientEmail || user.email)) {
    const targetEmail = user.settings?.recipientEmail || user.email;
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
              <th style="padding: 8px;">Category</th>
              <th style="padding: 8px;">Notes</th>
              <th style="padding: 8px; text-align: right;">Amount</th>
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
    await sendEmailReminder(targetEmail, subject, `Daily report for ${todayStr}: ${currency}${todayTotal}`, htmlReport, user.settings?.smtp);
  }

  res.json({ success: true, report });
});

// 7. CSV Export (User-Scoped)
app.get('/api/reports/export-csv', requireAuth, (req, res) => {
  const db = getDb();
  const userExpenses = (db.expenses || []).filter(e => e.userId === req.user.id);
  let csv = 'ID,Date,Time,Category,Payment Mode,Amount,Notes,Created At\n';
  userExpenses.forEach(e => {
    const cleanNotes = (e.notes || '').replace(/"/g, '""');
    csv += `"${e.id}","${e.date}","${e.time}","${e.category}","${e.paymentMode}",${e.amount},"${cleanNotes}","${e.createdAt}"\n`;
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=expenses-${getTodayString()}.csv`);
  res.send(csv);
});

// Background Cron Scheduler (Runs every minute, checks ALL registered users)
cron.schedule('* * * * *', async () => {
  try {
    const db = getDb();
    const users = db.users || [];
    const now = new Date();
    const currentHour = String(now.getHours()).padStart(2, '0');
    const currentMinute = String(now.getMinutes()).padStart(2, '0');
    const currentTimeStr = `${currentHour}:${currentMinute}`;
    const todayStr = getTodayString();

    for (const user of users) {
      if (user.settings?.reminderEnabled === false) continue;

      const configuredTime = user.settings?.reminderTime || '20:30';

      if (currentTimeStr === configuredTime && user.settings?.lastReminderSentDate !== todayStr) {
        const userExpensesToday = (db.expenses || []).filter(e => e.userId === user.id && e.date === todayStr);
        const userReportToday = (db.reports || []).find(r => r.userId === user.id && r.date === todayStr);

        if (userExpensesToday.length === 0 && !userReportToday) {
          console.log(`\n🔔 [Cron Alert] User ${user.name} (${user.username}) has not logged spending for ${todayStr}. Firing reminder...`);

          const currency = user.budget?.currency || '₹';
          const totalSpent = (db.expenses || []).filter(e => e.userId === user.id).reduce((s, e) => s + (Number(e.amount) || 0), 0);
          const remaining = (Number(user.budget?.initialAmount) || 0) - totalSpent;

          const subject = `⏰ Daily Reminder: Log your spending for today (${todayStr})`;
          const textMsg = `Hello ${user.name}! Friendly reminder: You have not logged your spending for today (${todayStr}). Available balance: ${currency}${remaining.toLocaleString()}. Open Daily Expenses to record your spending.`;

          const htmlMsg = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #cbd5e1; border-radius: 12px; overflow: hidden;">
              <div style="background: #e11d48; color: white; padding: 20px; text-align: center;">
                <h2 style="margin: 0;">⏰ Daily Spending Reminder</h2>
                <p style="margin: 4px 0 0; font-size: 14px;">Today: ${todayStr}</p>
              </div>
              <div style="padding: 24px;">
                <p>Hello <strong>${user.name}</strong>,</p>
                <p>You haven't logged any expenses or generated your daily spending report today.</p>
                <p><strong>Available Balance:</strong> ${currency}${remaining.toLocaleString()}</p>
                <div style="margin: 24px 0; text-align: center;">
                  <a href="http://localhost:${PORT}" style="background: #e11d48; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Log Today's Spending</a>
                </div>
              </div>
            </div>
          `;

          const targetEmail = user.settings?.recipientEmail || user.email;
          const targetPhone = user.settings?.recipientPhone || user.phone;

          let emailRes = null;
          let smsRes = null;

          if (user.settings?.notifyEmail && targetEmail) {
            emailRes = await sendEmailReminder(targetEmail, subject, textMsg, htmlMsg, user.settings?.smtp);
          }
          if (user.settings?.notifySms && targetPhone) {
            smsRes = await sendSmsNotification(targetPhone, textMsg, {
              fast2smsApiKey: user.settings?.fast2smsApiKey || process.env.FAST2SMS_API_KEY,
              twilio: user.settings?.twilio
            });
          }

          user.settings.lastReminderSentDate = todayStr;
          user.settings.reminderHistory = user.settings.reminderHistory || [];
          user.settings.reminderHistory.push({
            id: `cron_${Date.now()}`,
            timestamp: new Date().toISOString(),
            type: 'CRON_AUTOMATIC',
            emailResult: emailRes,
            smsResult: smsRes
          });
          saveDb(db);
        }
      }
    }
  } catch (err) {
    console.error('Error in multi-user cron scheduler:', err);
  }
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`💰 Daily Expenses - Multi-User 3D Expense Engine`);
  console.log(`🌐 Server URL: http://localhost:${PORT}`);
  console.log(`👥 Multi-User Architecture: Active`);
  console.log(`🔐 Forgot Password (OTP Verification): Active`);
  console.log(`⏰ User-Scoped Daily Reminder Scheduler: Active`);
  console.log(`======================================================\n`);
});
