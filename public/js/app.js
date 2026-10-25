// Daily Expenses - 3D Multi-User Client Controller with OTP & Auto-Refresh

let appState = {
  user: null,
  budget: {},
  financials: {},
  todayStatus: {},
  categoryBreakdown: {},
  recentExpenses: [],
  settings: {},
  currency: '₹'
};

let authToken = localStorage.getItem('daily_expenses_token') || null;
let categoryChartInstance = null;
let trendChartInstance = null;
let currentForgotIdentifier = '';

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  initClock();
  initDateDefaults();
  setupAuthTabsAndForms();
  setup3DTilt();
  checkAuth();
  setupLucide();
});

function setupLucide() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// Authenticated Fetch Helper
async function authFetch(url, options = {}) {
  const headers = options.headers || {};
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  options.headers = headers;

  const res = await fetch(url, options);
  if (res.status === 401) {
    handleLogout('Session expired or unauthorized. Please sign in.');
    throw new Error('Unauthorized');
  }
  return res;
}

// -------------------------------------------------------------
// Card Stability (Tilt disabled for clean, rock-solid professional UI)
// -------------------------------------------------------------

function setup3DTilt() {
  // Purposefully disabled: No wobbly 3D mouse tilt, clean modern hover only
}

// -------------------------------------------------------------
// Authentication System & Multi-Tab Handling
// -------------------------------------------------------------

function switchAuthTab(tab) {
  const tabLogin = document.getElementById('tabBtnLogin');
  const tabReg = document.getElementById('tabBtnRegister');
  const tabForgot = document.getElementById('tabBtnForgot');

  const formLogin = document.getElementById('loginForm');
  const formReg = document.getElementById('registerForm');
  const containerForgot = document.getElementById('forgotPasswordContainer');
  const subtitle = document.getElementById('authSubtitle');
  const alertEl = document.getElementById('authAlert');
  alertEl.classList.add('hidden');

  // Reset tab button styles
  [tabLogin, tabReg, tabForgot].forEach(btn => {
    btn.className = 'flex-1 py-2 rounded-xl transition text-slate-400 hover:text-white';
  });

  formLogin.classList.add('hidden');
  formReg.classList.add('hidden');
  containerForgot.classList.add('hidden');

  if (tab === 'login') {
    tabLogin.className = 'flex-1 py-2 rounded-xl transition text-white bg-indigo-600 shadow-lg shadow-indigo-600/30';
    formLogin.classList.remove('hidden');
    subtitle.textContent = 'Welcome back! Sign in to access your personal expenses';
  } else if (tab === 'register') {
    tabReg.className = 'flex-1 py-2 rounded-xl transition text-white bg-indigo-600 shadow-lg shadow-indigo-600/30';
    formReg.classList.remove('hidden');
    subtitle.textContent = 'Create your private account with personalized budget tracking';
  } else if (tab === 'forgot') {
    tabForgot.className = 'flex-1 py-2 rounded-xl transition text-white bg-indigo-600 shadow-lg shadow-indigo-600/30';
    containerForgot.classList.remove('hidden');
    subtitle.textContent = 'Reset your password securely with a 6-digit OTP';
    // Default to step 1
    document.getElementById('forgotOtpRequestForm').classList.remove('hidden');
    document.getElementById('forgotResetPasswordForm').classList.add('hidden');
    document.getElementById('forgotPinResetForm')?.classList.add('hidden');
  }
  setupLucide();
}

function showAuthAlert(msg, type = 'error') {
  const alertEl = document.getElementById('authAlert');
  alertEl.innerHTML = msg;
  alertEl.className = type === 'success' 
    ? 'p-3.5 rounded-xl text-xs text-center font-medium bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
    : 'p-3.5 rounded-xl text-xs text-center font-medium bg-rose-500/10 border border-rose-500/30 text-rose-400';
  alertEl.classList.remove('hidden');
}

function setupAuthTabsAndForms() {
  // Tab Switching
  document.getElementById('tabBtnLogin')?.addEventListener('click', () => switchAuthTab('login'));
  document.getElementById('tabBtnRegister')?.addEventListener('click', () => switchAuthTab('register'));
  document.getElementById('tabBtnForgot')?.addEventListener('click', () => switchAuthTab('forgot'));
  document.getElementById('linkToForgotFromLogin')?.addEventListener('click', () => switchAuthTab('forgot'));
  document.getElementById('linkToRegisterFromLogin')?.addEventListener('click', () => switchAuthTab('register'));
  document.getElementById('linkToLoginFromRegister')?.addEventListener('click', () => switchAuthTab('login'));
  document.getElementById('linkToLoginFromForgot')?.addEventListener('click', () => switchAuthTab('login'));

  // Toggle Password Show/Hide
  document.querySelectorAll('.togglePasswordBtn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      if (input) {
        const isPass = input.type === 'password';
        input.type = isPass ? 'text' : 'password';
        btn.innerHTML = isPass ? '<i data-lucide="eye-off" class="w-4 h-4"></i>' : '<i data-lucide="eye" class="w-4 h-4"></i>';
        setupLucide();
      }
    });
  });

  // 1. LOGIN SUBMISSION
  document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    const btn = document.getElementById('btnLoginSubmit');
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin"></i><span>Verifying...</span>`;
    setupLucide();

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();

      if (res.ok && data.success) {
        authToken = data.token;
        if (document.getElementById('rememberMe').checked) {
          localStorage.setItem('daily_expenses_token', authToken);
        }
        document.getElementById('authScreen').classList.add('hidden');
        document.getElementById('dashboardContainer').classList.remove('hidden');
        showToast(`Welcome back, ${data.user.name || data.user.username}!`, 'success');
        loadDashboardData();
      } else {
        showAuthAlert(data.error || 'Invalid username or password.');
      }
    } catch (err) {
      showAuthAlert('Unable to reach server. Please check your connection.');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="lock" class="w-4 h-4"></i><span>Sign In to Dashboard</span>`;
      setupLucide();
    }
  });

  // 2. REGISTRATION SUBMISSION
  document.getElementById('registerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('regName').value.trim();
    const username = document.getElementById('regUsername').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const phone = document.getElementById('regPhone').value.trim();
    const initialAmount = document.getElementById('regInitialBudget').value;
    const password = document.getElementById('regPassword').value.trim();
    const btn = document.getElementById('btnRegisterSubmit');

    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin"></i><span>Creating Account...</span>`;
    setupLucide();

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, username, email, phone, initialAmount, password })
      });
      const data = await res.json();

      if (res.ok && data.success) {
        authToken = data.token;
        localStorage.setItem('daily_expenses_token', authToken);
        document.getElementById('authScreen').classList.add('hidden');
        document.getElementById('dashboardContainer').classList.remove('hidden');
        showToast(`Account created successfully! Welcome, ${data.user.name}!`, 'success');
        loadDashboardData();
      } else {
        showAuthAlert(data.error || 'Registration failed.');
      }
    } catch (err) {
      showAuthAlert('Server connection error. Please try again.');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="user-plus" class="w-4 h-4"></i><span>Create Account & Start Tracking</span>`;
      setupLucide();
    }
  });

  // 3. FORGOT PASSWORD: STEP 1 (REQUEST OTP)
  document.getElementById('forgotOtpRequestForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const identifier = document.getElementById('forgotIdentifier').value.trim();
    const btn = document.getElementById('btnSendOtp');
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin"></i><span>Sending OTP...</span>`;
    setupLucide();

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier })
      });
      const data = await res.json();

      if (res.ok && data.success) {
        currentForgotIdentifier = identifier;
        document.getElementById('forgotOtpRequestForm').classList.add('hidden');
        document.getElementById('forgotResetPasswordForm').classList.remove('hidden');
        document.getElementById('forgotPinResetForm')?.classList.add('hidden');
        document.getElementById('otpSentTargetText').textContent = data.message;
        document.getElementById('otpInputCode').value = '';

        const waBtn = document.getElementById('btnWhatsAppDirectLink');
        if (waBtn) {
          if (data.whatsappUrl) {
            waBtn.href = data.whatsappUrl;
            waBtn.classList.remove('hidden');
          } else {
            waBtn.classList.add('hidden');
          }
        }

        const pinIdentifier = document.getElementById('pinResetIdentifier');
        if (pinIdentifier) pinIdentifier.value = identifier;

        showAuthAlert(`📲 ${data.message} ${data.whatsappUrl ? '<br><span class="text-emerald-300 font-semibold">Tap the green WhatsApp button below if SMS is delayed!</span>' : ''}`, 'success');
      } else {
        showAuthAlert(data.error || 'User not found.');
      }
    } catch (err) {
      showAuthAlert('Failed to send OTP code.');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="send" class="w-4 h-4"></i><span>Send 6-Digit OTP</span>`;
      setupLucide();
    }
  });

  // Direct PIN Option in Step 1
  document.getElementById('btnDirectPinOption')?.addEventListener('click', () => {
    document.getElementById('forgotOtpRequestForm').classList.add('hidden');
    document.getElementById('forgotResetPasswordForm').classList.add('hidden');
    document.getElementById('forgotPinResetForm').classList.remove('hidden');
    const idVal = document.getElementById('forgotIdentifier')?.value.trim();
    if (idVal) document.getElementById('pinResetIdentifier').value = idVal;
  });

  // Switch to PIN Reset from Step 2
  document.getElementById('btnSwitchToPinReset')?.addEventListener('click', () => {
    document.getElementById('forgotOtpRequestForm').classList.add('hidden');
    document.getElementById('forgotResetPasswordForm').classList.add('hidden');
    document.getElementById('forgotPinResetForm').classList.remove('hidden');
    if (currentForgotIdentifier) document.getElementById('pinResetIdentifier').value = currentForgotIdentifier;
  });

  // Back from PIN to OTP
  document.getElementById('btnBackFromPinToOtp')?.addEventListener('click', () => {
    document.getElementById('forgotPinResetForm').classList.add('hidden');
    document.getElementById('forgotOtpRequestForm').classList.remove('hidden');
  });

  // Back button in OTP Step 2
  document.getElementById('btnBackToOtpRequest')?.addEventListener('click', () => {
    document.getElementById('forgotOtpRequestForm').classList.remove('hidden');
    document.getElementById('forgotResetPasswordForm').classList.add('hidden');
    document.getElementById('forgotPinResetForm')?.classList.add('hidden');
  });

  // 4.1 SUBMIT PIN RESET FORM
  document.getElementById('forgotPinResetForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const identifier = document.getElementById('pinResetIdentifier').value.trim();
    const pin = document.getElementById('pinResetCode').value.trim();
    const newPassword = document.getElementById('pinResetNewPassword').value.trim();
    const btn = document.getElementById('btnSubmitPinReset');

    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin"></i><span>Resetting Password...</span>`;
    setupLucide();

    try {
      const res = await fetch('/api/auth/reset-password-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, pin, newPassword })
      });
      const data = await res.json();

      if (res.ok && data.success) {
        showAuthAlert('🎉 ' + data.message, 'success');
        setTimeout(() => {
          switchAuthTab('login');
          document.getElementById('loginUsername').value = identifier;
        }, 1200);
      } else {
        showAuthAlert(data.error || 'Failed to reset password.');
      }
    } catch (err) {
      showAuthAlert('Server error during PIN reset.');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="check-circle" class="w-4 h-4"></i><span>Reset Password with PIN</span>`;
      setupLucide();
    }
  });

  // 4. FORGOT PASSWORD: STEP 2 (RESET PASSWORD WITH OTP)
  document.getElementById('forgotResetPasswordForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const otp = document.getElementById('otpInputCode').value.trim();
    const newPassword = document.getElementById('otpNewPassword').value.trim();
    const btn = document.getElementById('btnSubmitResetWithOtp');

    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin"></i><span>Resetting Password...</span>`;
    setupLucide();

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: currentForgotIdentifier, otp, newPassword })
      });
      const data = await res.json();

      if (res.ok && data.success) {
        showAuthAlert('🎉 ' + data.message, 'success');
        setTimeout(() => {
          switchAuthTab('login');
          document.getElementById('loginUsername').value = currentForgotIdentifier;
        }, 1500);
      } else {
        showAuthAlert(data.error || 'Failed to reset password.');
      }
    } catch (err) {
      showAuthAlert('Server error during password reset.');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="check-circle" class="w-4 h-4"></i><span>Verify OTP & Set New Password</span>`;
      setupLucide();
    }
  });

  // Logout Handler
  document.getElementById('btnLogout')?.addEventListener('click', async () => {
    try {
      await authFetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {}
    handleLogout('You have been signed out.');
  });
}

async function checkAuth() {
  const authScreen = document.getElementById('authScreen');
  const dashboard = document.getElementById('dashboardContainer');

  if (!authToken) {
    authScreen.classList.remove('hidden');
    dashboard.classList.add('hidden');
    setupLucide();
    return;
  }

  try {
    const res = await fetch('/api/auth/verify', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    if (res.ok && data.valid) {
      authScreen.classList.add('hidden');
      dashboard.classList.remove('hidden');
      loadDashboardData();
    } else {
      handleLogout();
    }
  } catch (err) {
    handleLogout();
  }
}

function handleLogout(message = null) {
  authToken = null;
  localStorage.removeItem('daily_expenses_token');
  document.getElementById('authScreen').classList.remove('hidden');
  document.getElementById('dashboardContainer').classList.add('hidden');
  switchAuthTab('login');
  if (message) {
    showAuthAlert(message, 'error');
  }
  setupLucide();
}

// -------------------------------------------------------------
// Live Clock & Date Helpers
// -------------------------------------------------------------

function initClock() {
  const clockEl = document.getElementById('liveClock');
  const dateEl = document.getElementById('liveDate');

  function update() {
    const now = new Date();
    if (clockEl) {
      clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    if (dateEl) {
      dateEl.textContent = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    }
  }
  update();
  setInterval(update, 1000);
}

function initDateDefaults() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const todayStr = `${year}-${month}-${day}`;

  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');

  const inpDate = document.getElementById('inpDate');
  const inpTime = document.getElementById('inpTime');
  if (inpDate && !inpDate.value) inpDate.value = todayStr;
  if (inpTime && !inpTime.value) inpTime.value = `${hours}:${mins}`;
}

// -------------------------------------------------------------
// Load Dashboard & Auto-Refresh Engine
// -------------------------------------------------------------

async function loadDashboardData() {
  try {
    const res = await authFetch('/api/dashboard');
    if (!res.ok) throw new Error('Failed to load dashboard data');
    const data = await res.json();
    appState = data;
    appState.currency = data.financials?.currency || '₹';

    // Update Profile Header
    const navName = document.getElementById('navUserName');
    if (navName) navName.textContent = data.user?.name || data.user?.username || 'User';

    renderMetrics(data);
    renderDailyStatusBanner(data.todayStatus, data.settings);
    renderCharts(data.categoryBreakdown, data.recentExpenses);
    renderTransactionsTable(data.recentExpenses);
    updateCurrencyLabels(appState.currency);
    setupLucide();
    setup3DTilt();
  } catch (err) {
    console.error('Dashboard load error:', err);
  }
}

function updateCurrencyLabels(curr) {
  document.querySelectorAll('.currencyLabel').forEach(el => {
    el.textContent = curr;
  });
}

function renderMetrics(data) {
  const fin = data.financials || {};
  const curr = fin.currency || '₹';

  // 1. Initial Budget
  const elBudget = document.getElementById('metricInitialBudget');
  const elBudgetName = document.getElementById('metricBudgetName');
  if (elBudget) elBudget.textContent = `${curr}${(fin.initialAmount || 0).toLocaleString()}`;
  if (elBudgetName) elBudgetName.textContent = data.budget?.notes || data.budget?.month || 'Allowance';

  // 2. Total Spent
  const elSpent = document.getElementById('metricTotalSpent');
  const elSpentPct = document.getElementById('metricSpentPct');
  const elSpentBar = document.getElementById('metricSpentBar');
  if (elSpent) elSpent.textContent = `${curr}${(fin.totalSpent || 0).toLocaleString()}`;
  if (elSpentPct) elSpentPct.textContent = `${fin.spentPercentage || 0}%`;
  if (elSpentBar) {
    const pct = Math.min(100, Math.max(0, fin.spentPercentage || 0));
    elSpentBar.style.width = `${pct}%`;
    elSpentBar.className = pct > 90 ? 'bg-rose-500 h-1.5 rounded-full transition-all duration-500' :
                           pct > 70 ? 'bg-amber-500 h-1.5 rounded-full transition-all duration-500' :
                                      'bg-indigo-500 h-1.5 rounded-full transition-all duration-500';
  }

  // 3. Available Balance
  const elRem = document.getElementById('metricRemaining');
  const elHealth = document.getElementById('metricHealthBadge');
  const remVal = fin.remainingBalance || 0;
  if (elRem) {
    elRem.textContent = `${curr}${remVal.toLocaleString()}`;
    elRem.className = remVal < 0 ? 'text-2xl font-extrabold text-rose-400' : 'text-2xl font-extrabold text-emerald-400';
  }
  if (elHealth) {
    if (remVal < 0) {
      elHealth.textContent = 'Deficit / Over Budget';
      elHealth.className = 'px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-500/10 text-rose-400';
    } else if (fin.spentPercentage > 85) {
      elHealth.textContent = 'Critical Budget';
      elHealth.className = 'px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/10 text-amber-400';
    } else {
      elHealth.textContent = 'Healthy Balance';
      elHealth.className = 'px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/10 text-emerald-400';
    }
  }

  // 4. Today's Spent
  const elToday = document.getElementById('metricTodaySpent');
  const elTodayCount = document.getElementById('metricTodayCount');
  if (elToday) elToday.textContent = `${curr}${(fin.todaySpent || 0).toLocaleString()}`;
  if (elTodayCount) elTodayCount.textContent = `${data.todayStatus?.count || 0} transaction(s) recorded today`;
}

function renderDailyStatusBanner(status, settings) {
  const banner = document.getElementById('dailyStatusBanner');
  if (!banner) return;

  const curr = appState.currency || '₹';
  const reminderTime = settings?.reminderTime || '20:30';

  if (!status.isLogged) {
    banner.className = 'p-4 sm:p-5 rounded-3xl glass-card border border-amber-500/40 bg-amber-500/5 shadow-xl shadow-amber-500/5 transition duration-300 card-3d';
    banner.innerHTML = `
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div class="flex items-start sm:items-center gap-3.5">
          <div class="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 badge-3d">
            <i data-lucide="alert-triangle" class="w-5 h-5"></i>
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h3 class="text-sm sm:text-base font-bold text-amber-300">Today's Spending Not Logged Yet</h3>
              <span class="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">Action Needed</span>
            </div>
            <p class="text-xs text-slate-300 mt-0.5">
              Daily reminder active for <strong class="text-amber-400 font-mono">${reminderTime}</strong>. When you log spending, an instant SMS text locks today's cost and shows your available balance.
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2 self-end sm:self-center shrink-0">
          <button id="bannerBtnQuickNoSpend" class="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold border border-slate-700 transition">
            No Spend Today
          </button>
          <button id="bannerBtnTriggerTest" class="px-3 py-1.5 rounded-xl bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 text-xs font-semibold border border-amber-500/30 transition flex items-center gap-1">
            <i data-lucide="send" class="w-3.5 h-3.5"></i>
            <span>Test Alert</span>
          </button>
        </div>
      </div>
    `;

    document.getElementById('bannerBtnQuickNoSpend')?.addEventListener('click', logNoSpendToday);
    document.getElementById('bannerBtnTriggerTest')?.addEventListener('click', sendTestReminder);
  } else {
    banner.className = 'p-4 sm:p-5 rounded-3xl glass-card border border-emerald-500/40 bg-emerald-500/5 shadow-xl shadow-emerald-500/5 transition duration-300 card-3d';
    banner.innerHTML = `
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div class="flex items-start sm:items-center gap-3.5">
          <div class="w-10 h-10 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 badge-3d">
            <i data-lucide="check-circle" class="w-5 h-5"></i>
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h3 class="text-sm sm:text-base font-bold text-emerald-300">Today's Spending is Locked & Up to Date!</h3>
              <span class="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">Locked</span>
            </div>
            <p class="text-xs text-slate-300 mt-0.5">
              You recorded <strong class="text-emerald-400 font-bold">${curr}${(status.todaySpent || 0).toLocaleString()}</strong> today across ${status.count} transaction(s). SMS confirmation dispatched.
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2 self-end sm:self-center shrink-0">
          <button id="bannerBtnViewReport" class="px-3.5 py-1.5 rounded-xl btn-3d text-white text-xs font-semibold transition flex items-center gap-1.5">
            <i data-lucide="file-text" class="w-3.5 h-3.5"></i>
            <span>View Daily Report</span>
          </button>
        </div>
      </div>
    `;

    document.getElementById('bannerBtnViewReport')?.addEventListener('click', generateDailyReport);
  }
}

// -------------------------------------------------------------
// Visual Charts
// -------------------------------------------------------------

function renderCharts(categoryData, recentExpenses) {
  renderCategoryChart(categoryData);
  renderTrendChart(recentExpenses);
}

function renderCategoryChart(categoryData) {
  const ctx = document.getElementById('categoryChart')?.getContext('2d');
  if (!ctx) return;

  const labels = Object.keys(categoryData || {});
  const values = Object.values(categoryData || {});

  if (labels.length === 0) {
    labels.push('No data');
    values.push(1);
  }

  const colors = [
    '#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6',
    '#8b5cf6', '#14b8a6', '#f97316', '#64748b'
  ];

  if (categoryChartInstance) {
    categoryChartInstance.destroy();
  }

  categoryChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: colors.slice(0, labels.length),
        borderColor: '#0b0f19',
        borderWidth: 3,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            boxWidth: 12,
            padding: 12,
            color: '#94a3b8',
            font: { size: 11 }
          }
        },
        tooltip: {
          callbacks: {
            label: (item) => ` ${item.label}: ${appState.currency}${item.raw.toLocaleString()}`
          }
        }
      },
      cutout: '70%'
    }
  });
}

function renderTrendChart(expenses) {
  const ctx = document.getElementById('trendChart')?.getContext('2d');
  if (!ctx) return;

  const dayMap = {};
  const today = new Date();
  const dateLabels = [];
  const dateKeys = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(today.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    dateKeys.push(key);
    dateLabels.push(label);
    dayMap[key] = 0;
  }

  (expenses || []).forEach(e => {
    if (dayMap[e.date] !== undefined) {
      dayMap[e.date] += Number(e.amount) || 0;
    }
  });

  const chartData = dateKeys.map(k => dayMap[k]);

  if (trendChartInstance) {
    trendChartInstance.destroy();
  }

  trendChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: dateLabels,
      datasets: [{
        label: `Daily Spending (${appState.currency})`,
        data: chartData,
        backgroundColor: '#6366f1',
        hoverBackgroundColor: '#818cf8',
        borderRadius: 8,
        barThickness: 24
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#94a3b8', font: { size: 11 } }
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: {
            color: '#94a3b8',
            font: { size: 11 },
            callback: (val) => `${appState.currency}${val}`
          }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => ` Spent: ${appState.currency}${item.raw.toLocaleString()}`
          }
        }
      }
    }
  });
}

// -------------------------------------------------------------
// Transactions Table
// -------------------------------------------------------------

function renderTransactionsTable(expenses) {
  const tbody = document.getElementById('transactionsTbody');
  if (!tbody) return;

  const curr = appState.currency || '₹';

  if (!expenses || expenses.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="py-8 text-center text-slate-500">
          <i data-lucide="inbox" class="w-8 h-8 mx-auto mb-2 opacity-40"></i>
          <p>No expenses recorded yet. Use the form on the left to log your first spend!</p>
        </td>
      </tr>
    `;
    setupLucide();
    return;
  }

  tbody.innerHTML = expenses.map(exp => {
    return `
      <tr class="hover:bg-slate-800/40 transition">
        <td class="py-3 px-3.5 font-mono text-slate-400">${exp.date} <span class="text-[10px] text-slate-500">${exp.time || ''}</span></td>
        <td class="py-3 px-3.5 font-medium text-white">${exp.category}</td>
        <td class="py-3 px-3.5 text-slate-300 truncate max-w-[180px]">${exp.notes || '-'}</td>
        <td class="py-3 px-3.5">
          <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
            ${exp.paymentMode || 'UPI'}
          </span>
        </td>
        <td class="py-3 px-3.5 text-right font-bold text-rose-400">${curr}${Number(exp.amount).toLocaleString()}</td>
        <td class="py-3 px-3.5 text-center">
          <button onclick="deleteExpense('${exp.id}')" class="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-xl transition" title="Delete Expense">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  setupLucide();
}

async function deleteExpense(id) {
  if (!confirm('Are you sure you want to remove this expense record?')) return;
  try {
    const res = await authFetch(`/api/expenses/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed');
    showToast('Expense removed', 'success');
    loadDashboardData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// -------------------------------------------------------------
// Expense Logging Form (Auto-Refresh & Instant SMS Notification)
// -------------------------------------------------------------

function setupDashboardEventListeners() {
  const expenseForm = document.getElementById('expenseForm');
  if (expenseForm) {
    expenseForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const amountInp = document.getElementById('inpAmount');
      const notesInp = document.getElementById('inpNotes');
      const amount = amountInp.value;
      const category = document.getElementById('inpCategory').value;
      const paymentMode = document.getElementById('inpPaymentMode').value;
      const date = document.getElementById('inpDate').value;
      const time = document.getElementById('inpTime').value;
      const notes = notesInp.value;

      try {
        const res = await authFetch('/api/expenses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount, category, paymentMode, date, time, notes })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to save expense');

        // 1. Clear form inputs cleanly for next entry
        amountInp.value = '';
        notesInp.value = '';
        initDateDefaults();

        // 2. Refresh dashboard data, balance meters, and charts seamlessly
        await loadDashboardData();

        // 3. Prominent Alert & Toast with exact SMS locked message
        const smsMsg = data.smsAlert?.message || `YOUR EXPENSE OF TODAY IS LOCKED AND AVAILABLE BALANCE IS ${appState.currency}${(data.financials?.remainingBalance || 0).toLocaleString()}`;
        const recipient = data.smsAlert?.recipient || 'your registered phone';

        showProminentAlert(`
          <div class="space-y-1.5">
            <div class="flex items-center gap-2 font-bold text-sm text-emerald-300">
              <i data-lucide="check-circle" class="w-4 h-4 text-emerald-400"></i>
              <span>Expense Locked & SMS Dispatched!</span>
            </div>
            <p class="text-xs text-white bg-slate-900/90 p-2.5 rounded-xl border border-slate-700 font-mono">
              "${smsMsg}"
            </p>
            <p class="text-[11px] text-slate-400">
              📲 SMS sent to reference number: <strong class="text-indigo-300 font-mono">${recipient}</strong>
            </p>
          </div>
        `, 'success', 7000);

      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Quick No Spend Today
  document.getElementById('btnNoExpenseToday')?.addEventListener('click', logNoSpendToday);

  // Search filter
  const searchInp = document.getElementById('searchTransactions');
  if (searchInp) {
    searchInp.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      const filtered = (appState.recentExpenses || []).filter(item => {
        return (item.notes || '').toLowerCase().includes(q) ||
               (item.category || '').toLowerCase().includes(q) ||
               (item.paymentMode || '').toLowerCase().includes(q);
      });
      renderTransactionsTable(filtered);
    });
  }

  setupModals();

  // Export CSV
  document.getElementById('btnExportCsv')?.addEventListener('click', () => {
    window.location.href = `/api/reports/export-csv?token=${authToken}`;
  });

  // Generate Daily Report Button
  document.getElementById('btnGenerateReportNow')?.addEventListener('click', generateDailyReport);
}

setupDashboardEventListeners();

async function logNoSpendToday() {
  try {
    const res = await authFetch('/api/reports/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailReport: false })
    });
    if (!res.ok) throw new Error('Failed to update today status');
    showToast('Marked today as zero expense / day closed! Reminder dismissed.', 'success');
    loadDashboardData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// -------------------------------------------------------------
// Modals Handling (Budget, Settings, Reports)
// -------------------------------------------------------------

function setupModals() {
  // 1. Budget Modal
  const budgetModal = document.getElementById('budgetModal');
  const btnOpenBudget = document.getElementById('btnOpenBudgetModal');
  const btnQuickEdit = document.getElementById('btnQuickEditBudget');
  const btnCloseBudget = document.getElementById('btnCloseBudgetModal');
  const btnCancelBudget = document.getElementById('btnCancelBudget');
  const budgetForm = document.getElementById('budgetForm');

  function openBudget() {
    document.getElementById('setInitialAmount').value = appState.budget?.initialAmount || 30000;
    document.getElementById('setCurrency').value = appState.budget?.currency || '₹';
    document.getElementById('setPeriodName').value = appState.budget?.month || 'Current Period';
    document.getElementById('setBudgetNotes').value = appState.budget?.notes || '';
    budgetModal.classList.remove('hidden');
  }

  function closeBudget() {
    budgetModal.classList.add('hidden');
  }

  btnOpenBudget?.addEventListener('click', openBudget);
  btnQuickEdit?.addEventListener('click', openBudget);
  btnCloseBudget?.addEventListener('click', closeBudget);
  btnCancelBudget?.addEventListener('click', closeBudget);

  budgetForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const initialAmount = document.getElementById('setInitialAmount').value;
    const currency = document.getElementById('setCurrency').value;
    const month = document.getElementById('setPeriodName').value;
    const notes = document.getElementById('setBudgetNotes').value;

    try {
      const res = await authFetch('/api/budget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initialAmount, currency, month, notes })
      });
      if (!res.ok) throw new Error('Failed to update budget');
      showToast('Budget configuration updated successfully!', 'success');
      closeBudget();
      loadDashboardData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // 2. Settings Modal
  const settingsModal = document.getElementById('settingsModal');
  const btnOpenSettings = document.getElementById('btnOpenSettingsModal');
  const btnCloseSettings = document.getElementById('btnCloseSettingsModal');
  const btnCancelSettings = document.getElementById('btnCancelSettings');
  const settingsForm = document.getElementById('settingsForm');

  async function openSettings() {
    try {
      const res = await authFetch('/api/settings');
      const s = await res.json();
      document.getElementById('setProfileName').value = s.name || '';
      document.getElementById('setProfileUsername').value = s.username || '';
      document.getElementById('setReminderEnabled').checked = Boolean(s.reminderEnabled);
      document.getElementById('setReminderTime').value = s.reminderTime || '20:30';
      document.getElementById('setRecipientEmail').value = s.recipientEmail || s.email || '';
      document.getElementById('setRecipientPhone').value = s.recipientPhone || s.phone || '';
      if (document.getElementById('setFast2smsApiKey')) {
        document.getElementById('setFast2smsApiKey').value = s.fast2smsApiKey || '';
      }
      document.getElementById('setNotifyEmail').checked = Boolean(s.notifyEmail);
      document.getElementById('setNotifySms').checked = Boolean(s.notifySms);
      settingsModal.classList.remove('hidden');
    } catch (err) {
      showToast('Error loading settings', 'error');
    }
  }

  function closeSettings() {
    settingsModal.classList.add('hidden');
  }

  btnOpenSettings?.addEventListener('click', openSettings);
  btnCloseSettings?.addEventListener('click', closeSettings);
  btnCancelSettings?.addEventListener('click', closeSettings);

  settingsForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: document.getElementById('setProfileName').value,
      reminderEnabled: document.getElementById('setReminderEnabled').checked,
      reminderTime: document.getElementById('setReminderTime').value,
      recipientEmail: document.getElementById('setRecipientEmail').value,
      recipientPhone: document.getElementById('setRecipientPhone').value,
      fast2smsApiKey: document.getElementById('setFast2smsApiKey')?.value.trim() || '',
      notifyEmail: document.getElementById('setNotifyEmail').checked,
      notifySms: document.getElementById('setNotifySms').checked
    };

    try {
      const res = await authFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Failed to save settings');
      showToast('Settings saved successfully!', 'success');
      closeSettings();
      loadDashboardData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btnTestReminderNow')?.addEventListener('click', sendTestReminder);
  document.getElementById('btnTestSmsNow')?.addEventListener('click', sendTestSms);

  // 3. Report Modal
  document.getElementById('btnCloseReportModal')?.addEventListener('click', () => {
    document.getElementById('reportModal').classList.add('hidden');
  });
}

async function sendTestReminder() {
  showToast('Dispatching test reminder alert...', 'info');
  try {
    const res = await authFetch('/api/notifications/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: document.getElementById('setRecipientEmail')?.value,
        phone: document.getElementById('setRecipientPhone')?.value
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Test notification failed');

    let msg = 'Test reminder alert sent!';
    if (data.email?.previewUrl) {
      window.open(data.email.previewUrl, '_blank');
    }
    showToast(msg, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function sendTestSms() {
  const phone = document.getElementById('setRecipientPhone')?.value.trim();
  const fast2smsApiKey = document.getElementById('setFast2smsApiKey')?.value.trim();
  if (!phone) {
    showToast('Please enter your 10-digit mobile number above.', 'warning');
    return;
  }

  showToast('Dispatching test SMS directly to your phone...', 'info');
  try {
    const res = await authFetch('/api/notifications/test-sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, fast2smsApiKey })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'Test SMS sent!', 'success');
    } else {
      showToast(data.error || 'Failed to dispatch test SMS', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function generateDailyReport() {
  try {
    const res = await authFetch('/api/reports/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailReport: false })
    });
    const data = await res.json();
    if (!res.ok) throw new Error('Failed to generate report');

    const rep = data.report;
    const curr = appState.currency || '₹';
    const modal = document.getElementById('reportModal');
    const content = document.getElementById('reportModalContent');
    document.getElementById('reportModalDate').textContent = `Date: ${rep.date} • Generated at: ${new Date(rep.generatedAt).toLocaleTimeString()}`;

    content.innerHTML = `
      <div class="grid grid-cols-3 gap-3 p-3 rounded-2xl bg-slate-900/90 border border-slate-800 text-center">
        <div>
          <span class="text-slate-400 text-[11px] block">Today's Total</span>
          <span class="text-base font-bold text-rose-400">${curr}${rep.todaySpent.toLocaleString()}</span>
        </div>
        <div>
          <span class="text-slate-400 text-[11px] block">Transactions</span>
          <span class="text-base font-bold text-white">${rep.itemCount}</span>
        </div>
        <div>
          <span class="text-slate-400 text-[11px] block">Remaining Budget</span>
          <span class="text-base font-bold text-emerald-400">${curr}${rep.remainingBalance.toLocaleString()}</span>
        </div>
      </div>

      <div class="mt-4">
        <h4 class="font-bold text-white mb-2">Itemized Breakdown for Today:</h4>
        <div class="rounded-2xl border border-slate-800 overflow-hidden">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-900 text-slate-400">
              <tr>
                <th class="p-2.5">Category</th>
                <th class="p-2.5">Notes</th>
                <th class="p-2.5">Payment</th>
                <th class="p-2.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-800/60">
              ${rep.items.length === 0 ? '<tr><td colspan="4" class="p-4 text-center text-slate-500">No expenses recorded for today.</td></tr>' :
                rep.items.map(item => `
                  <tr>
                    <td class="p-2.5 font-medium text-white">${item.category}</td>
                    <td class="p-2.5 text-slate-300">${item.notes || '-'}</td>
                    <td class="p-2.5 text-slate-400">${item.paymentMode}</td>
                    <td class="p-2.5 text-right font-bold text-rose-400">${curr}${Number(item.amount).toLocaleString()}</td>
                  </tr>
                `).join('')
              }
            </tbody>
          </table>
        </div>
      </div>
    `;

    document.getElementById('btnEmailThisReport').onclick = async () => {
      showToast('Sending report to your email...', 'info');
      await authFetch('/api/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailReport: true })
      });
      showToast('Daily Report sent to your configured Email!', 'success');
    };

    modal.classList.remove('hidden');
    setupLucide();
    loadDashboardData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// -------------------------------------------------------------
// Toast & Alert Prompts
// -------------------------------------------------------------

function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  const bgClass = type === 'success' ? 'bg-emerald-600' :
                  type === 'error' ? 'bg-rose-600' :
                  'bg-indigo-600';

  toast.className = `pointer-events-auto flex items-center gap-2 px-4 py-3 rounded-2xl text-white text-xs font-semibold shadow-2xl ${bgClass} transform transition-all duration-300 translate-y-2 opacity-0`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('translate-y-2', 'opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function showProminentAlert(htmlContent, type = 'success', duration = 7000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `pointer-events-auto p-4 rounded-2xl text-white text-xs bg-slate-900 border border-emerald-500/40 shadow-2xl shadow-emerald-500/10 transform transition-all duration-300 translate-y-2 opacity-0`;
  toast.innerHTML = htmlContent;
  container.appendChild(toast);

  setupLucide();

  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('translate-y-2', 'opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

window.deleteExpense = deleteExpense;
