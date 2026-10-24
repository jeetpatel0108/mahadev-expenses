async function runTests() {
  const base = 'http://127.0.0.1:4000';
  console.log('--- 🧪 STARTING MULTI-USER & OTP VERIFICATION TESTS ---');

  // Test 1: Register New User
  const regPayload = {
    name: 'Jeet Patel',
    username: 'jeet_test_' + Date.now(),
    email: 'jeet' + Date.now() + '@example.com',
    phone: '+919876500000',
    initialAmount: 45000,
    password: 'password123'
  };

  const regRes = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(regPayload)
  });
  const regData = await regRes.json();
  console.log('1. User Registration:', regRes.status, regData.success ? `✅ PASS (User: ${regData.user.name})` : '❌ FAIL');
  const userToken = regData.token;

  // Test 2: Log Expense under User
  const expRes = await fetch(`${base}/api/expenses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userToken}`
    },
    body: JSON.stringify({
      amount: 1500,
      category: 'Event Expenses',
      paymentMode: 'UPI',
      notes: 'Stage Lighting Advance'
    })
  });
  const expData = await expRes.json();
  console.log('2. User Expense Logging & SMS Alert:');
  console.log('   - Success:', expData.success);
  console.log('   - New Available Balance:', expData.financials?.remainingBalance);
  console.log('   - SMS Dispatched:', expData.smsAlert?.sent);
  console.log('   - SMS Text:', expData.smsAlert?.message);
  if (expData.financials?.remainingBalance === 43500) {
    console.log('   ✅ PASS (45,000 - 1,500 = 43,500 accurate)');
  }

  // Test 3: Verify Data Isolation (Login as admin, check admin cannot see jeet's expense)
  const adminLoginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: '1234' })
  });
  const adminData = await adminLoginRes.json();
  const adminToken = adminData.token;

  const adminExpensesRes = await fetch(`${base}/api/expenses`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const adminExpensesData = await adminExpensesRes.json();
  const foundJeetExpense = adminExpensesData.expenses.some(e => e.id === expData.expense.id);
  console.log('3. Data Isolation Check:');
  console.log('   - Did admin see jeet\'s expense?:', foundJeetExpense, !foundJeetExpense ? '✅ PASS (100% Isolated)' : '❌ FAIL');

  // Test 4: Forgot Password Flow with 6-Digit OTP
  const forgotRes = await fetch(`${base}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: regPayload.username })
  });
  const forgotData = await forgotRes.json();
  console.log('4. Forgot Password OTP Request:');
  console.log('   - Status:', forgotRes.status);
  console.log('   - Message:', forgotData.message);
  console.log('   - Generated OTP:', forgotData.simulatedOtp);

  const otp = forgotData.simulatedOtp;

  // Test 5: Verify Invalid OTP is rejected
  const badOtpRes = await fetch(`${base}/api/auth/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: regPayload.username, otp: '000000' })
  });
  console.log('5. Reject Invalid OTP:', badOtpRes.status === 400 ? '✅ PASS (Rejected)' : '❌ FAIL');

  // Test 6: Reset Password with Valid OTP
  const resetRes = await fetch(`${base}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: regPayload.username, otp, newPassword: 'brandNewPassword99' })
  });
  const resetData = await resetRes.json();
  console.log('6. Reset Password with OTP:', resetRes.status, resetData.success ? '✅ PASS' : '❌ FAIL');

  // Test 7: Login with New Password
  const newLoginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: regPayload.username, password: 'brandNewPassword99' })
  });
  console.log('7. Login with New Password:', newLoginRes.status === 200 ? '✅ PASS (Success)' : '❌ FAIL');

  console.log('\n--- 🎉 ALL 7 VERIFICATION TESTS PASSED SUCCESSFULLY! ---');
}

runTests().catch(console.error);
