async function testAll() {
  const base = 'http://localhost:4000';
  console.log('Testing APIs on', base);

  // 1. Post expense
  const expRes = await fetch(`${base}/api/expenses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: 250,
      category: 'Food & Dining',
      paymentMode: 'UPI',
      notes: 'Morning Coffee & Breakfast',
      date: '2026-09-20',
      time: '10:00'
    })
  });
  const expData = await expRes.json();
  console.log('1. Add Expense Response:', expData);

  // 2. Check dashboard (todayStatus should now be isLogged: true, todaySpent: 250)
  const dashRes = await fetch(`${base}/api/dashboard`);
  const dashData = await dashRes.json();
  console.log('2. Dashboard status after expense:');
  console.log('   - Remaining balance:', dashData.financials.remainingBalance);
  console.log('   - Today spent:', dashData.financials.todaySpent);
  console.log('   - Today isLogged:', dashData.todayStatus.isLogged);

  // 3. Test reminder notification dispatcher
  const testNotifRes = await fetch(`${base}/api/notifications/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'testuser@example.com',
      phone: '+919876543210'
    })
  });
  const notifData = await testNotifRes.json();
  console.log('3. Notification Test Response:');
  console.log('   - Email Result:', notifData.email);
  console.log('   - SMS Result:', notifData.sms);

  // 4. Generate daily report
  const repRes = await fetch(`${base}/api/reports/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emailReport: false })
  });
  const repData = await repRes.json();
  console.log('4. Daily Report Generated:', repData.report ? `Success (Items: ${repData.report.itemCount}, Today Total: ${repData.report.todaySpent})` : 'Failed');

  console.log('\nAll API tests completed successfully!');
}

testAll().catch(console.error);
