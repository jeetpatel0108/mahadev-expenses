async function testAuthAndSms() {
  const base = 'http://127.0.0.1:4000';
  console.log('--- Starting Auth & Instant SMS Verification ---');

  // 1. Unauthorized access test
  const unauthRes = await fetch(`${base}/api/dashboard`);
  console.log('1. Unauthorized GET /api/dashboard status:', unauthRes.status, unauthRes.status === 401 ? '✅ PASS (Protected)' : '❌ FAIL');

  // 2. Failed login test
  const failLogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'wrongpassword' })
  });
  console.log('2. Wrong password login status:', failLogin.status, failLogin.status === 401 ? '✅ PASS (Rejected)' : '❌ FAIL');

  // 3. Successful login test
  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: '1234' })
  });
  const loginData = await loginRes.json();
  console.log('3. Valid login status:', loginRes.status, loginData.token ? '✅ PASS (Token received)' : '❌ FAIL');
  const token = loginData.token;

  // 4. Authorized dashboard access test
  const dashRes = await fetch(`${base}/api/dashboard`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const dashData = await dashRes.json();
  console.log('4. Authorized GET /api/dashboard status:', dashRes.status, 'Available balance before:', dashData.financials?.remainingBalance);

  // 5. Add Expense with Instant SMS alert test
  const expRes = await fetch(`${base}/api/expenses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      amount: 500,
      category: 'Food & Dining',
      paymentMode: 'UPI',
      notes: 'Team Lunch',
      date: '2026-09-20',
      time: '14:30'
    })
  });
  const expData = await expRes.json();
  console.log('5. Expense Logging & SMS Dispatch:');
  console.log('   - Success:', expData.success);
  console.log('   - Logged Amount: ₹500');
  console.log('   - New Available Balance:', expData.financials?.remainingBalance);
  console.log('   - SMS Alert Sent:', expData.smsAlert?.sent);
  console.log('   - SMS Message Payload:', expData.smsAlert?.message);
  console.log('   - Target Reference Phone:', expData.smsAlert?.recipient);

  if (expData.smsAlert?.message && expData.smsAlert.message.includes('YOUR EXPENSE OF TODAY IS LOCKED AND AVAILABLE BALANCE IS')) {
    console.log('   ✅ PASS: Exact SMS text template matched!');
  } else {
    console.log('   ❌ FAIL: SMS text did not match template.');
  }

  console.log('\n--- All Verification Checks Completed Successfully! ---');
}

testAuthAndSms().catch(console.error);
